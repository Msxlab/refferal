import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { LedgerStatus, LedgerType, PayoutStatus, Prisma, Role, SaleStatus } from '@prisma/client';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { defaultPermissionsForTier, SYSTEM_ROLES } from '../src/common/permissions';
import { EngineService, payoutActiveKey } from '../src/engine/engine.service';
import { monthKey } from '../src/engine/month';
import { foldSyntheticPayoutEvents, mapLegacyPayoutPresentation } from '../src/payouts/payout-presentation';
import {
  evaluatePayoutReadiness,
  type PayoutReadinessInput,
  type ReadinessCheckKey,
} from '../src/payouts/payout-readiness';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createChain,
  createPlan,
  createSale,
  createTenant,
  seedReadyPayoutCompliance,
  summaryTotals,
  truncateAll,
} from './helpers';

describe('payout presentation (pure contract)', () => {
  const createdAt = new Date('2026-06-01T10:00:00.000Z');
  const processingAt = new Date('2026-06-02T10:00:00.000Z');
  const paidAt = new Date('2026-06-03T10:00:00.000Z');
  const settledAt = new Date('2026-06-04T10:00:00.000Z');
  const base = (overrides: Record<string, unknown> = {}) => ({
    status: 'requested', batchId: null, totalCents: 12500n, currency: 'USD', period: '2026-06', createdAt,
    processingStartedAt: null, paidAt: null, settledAt: null, rejectedAt: null, failedAt: null,
    settlementReference: null, settlementEvidence: null, rejectionReason: null, failureReason: null, ...overrides,
  });

  it('maps the five fully evidenced legacy states with no raw reason, settlement, rail, or attempt leak', () => {
    const cases = [
      [base(), 'requested'],
      [base({ status: 'processing', batchId: 'batch-1', processingStartedAt: processingAt }), 'processing'],
      [base({ status: 'paid', batchId: 'batch-1', processingStartedAt: processingAt, paidAt, settledAt, settlementReference: 'raw-reference', settlementEvidence: 'raw-evidence' }), 'settled'],
      [base({ status: 'rejected', rejectedAt: processingAt, rejectionReason: 'raw-rejection' }), 'rejected'],
      [base({ status: 'failed', batchId: 'batch-1', processingStartedAt: processingAt, failedAt: paidAt, failureReason: 'raw-failure' }), 'failed'],
    ] as const;
    for (const [snapshot, state] of cases) {
      const result = mapLegacyPayoutPresentation(snapshot);
      expect(result).toMatchObject({ state, baseState: state, authority: 'legacy-snapshot', method: null, attemptId: null, amount: { amountCents: '12500', currency: 'USD' }, actions: { mutations: 'not-evaluated' } });
      expect(JSON.stringify(result)).not.toMatch(/raw-reference|raw-evidence|raw-rejection|raw-failure/);
    }
  });

  it('fails closed for missing paid evidence, invalid dates, contradiction, or chronological inversion and never infers a rail', () => {
    const invalid = [
      base({ status: 'paid', batchId: 'batch-1', processingStartedAt: processingAt, paidAt, settledAt, settlementReference: 'ref' }),
      base({ status: 'paid', batchId: 'batch-1', processingStartedAt: processingAt, paidAt, settledAt, settlementEvidence: 'evidence' }),
      base({ status: 'processing', batchId: 'batch-1', processingStartedAt: new Date('invalid') }),
      base({ status: 'requested', processingStartedAt: processingAt }),
      base({ status: 'failed', batchId: 'batch-1', processingStartedAt: paidAt, failedAt: processingAt, failureReason: 'raw' }),
    ];
    for (const snapshot of invalid) {
      expect(mapLegacyPayoutPresentation(snapshot)).toMatchObject({ state: 'status-unavailable', baseState: null, authority: 'unavailable', method: null, attemptId: null, actions: { mutations: 'disabled', support: { kind: 'support', reasonCode: 'payout_status_unavailable' } } });
    }
    for (const method of ['manual', 'csv', 'stripe']) expect(mapLegacyPayoutPresentation({ ...base(), method } as never).method).toBeNull();
  });

  it('fails closed instead of projecting legacy authority for missing or malformed financial context and invalid calendar timestamps', () => {
    const invalid = [
      base({ totalCents: undefined }),
      base({ totalCents: '12500.50' }),
      base({ currency: 'usd' }),
      base({ period: '2026-13' }),
      base({ createdAt: '2026-02-30T10:00:00.000Z' }),
    ];
    for (const snapshot of invalid) {
      expect(mapLegacyPayoutPresentation(snapshot)).toMatchObject({
        state: 'status-unavailable',
        authority: 'unavailable',
        actions: { mutations: 'disabled' },
      });
    }
  });

  it('keeps unavailable financial fields empty unless every legacy financial value is valid', () => {
    const invalidFinancialSnapshots = [
      base({ totalCents: undefined }),
      base({ totalCents: '12500.50' }),
      base({ currency: undefined }),
      base({ currency: 'usd' }),
      base({ period: undefined }),
      base({ period: '2026-13' }),
    ];
    for (const snapshot of invalidFinancialSnapshots) {
      expect(mapLegacyPayoutPresentation(snapshot)).toMatchObject({
        state: 'status-unavailable',
        authority: 'unavailable',
        amount: { amountCents: '', currency: '' },
        period: '',
        actions: { mutations: 'disabled' },
      });
    }

    expect(mapLegacyPayoutPresentation(base({ processingStartedAt: processingAt }))).toMatchObject({
      state: 'status-unavailable',
      authority: 'unavailable',
      amount: { amountCents: '12500', currency: 'USD' },
      period: '2026-06',
      actions: { mutations: 'disabled' },
    });
  });

  it('folds future events by authoritative version and idempotently ignores an exact duplicate', () => {
    const seed = { amountCents: '12500', currency: 'USD', period: '2026-06', createdAt: '2026-06-01T10:00:00.000Z' };
    const requested = { id: 'r', authoritativeVersion: 1, type: 'requested' as const, occurredAt: '2026-06-01T10:00:00.000Z' };
    const processing = { id: 'p', authoritativeVersion: 2, type: 'processing' as const, occurredAt: '2026-06-02T10:00:00.000Z', attemptId: 'attempt-1', method: 'ach' as const };
    const settled = { id: 's', authoritativeVersion: 3, type: 'settled' as const, occurredAt: '2026-06-03T10:00:00.000Z', attemptId: 'attempt-1', method: 'ach' as const };
    const canonical = foldSyntheticPayoutEvents([settled, requested, processing], seed);
    expect(foldSyntheticPayoutEvents([requested, processing, settled, requested], seed)).toEqual(canonical);
    expect(canonical).toMatchObject({ state: 'settled', authority: 'event-log', method: 'ach', attemptId: 'attempt-1' });
  });

  it('fails closed future folds for ID/version conflicts, gaps, illegal transitions, changed attempts or methods, and malformed hold evidence', () => {
    const seed = { amountCents: '12500', currency: 'USD', period: '2026-06', createdAt: '2026-06-01T10:00:00.000Z' };
    const invalid = [
      [{ id: 'same', authoritativeVersion: 1, type: 'requested' as const, occurredAt: '2026-06-01T10:00:00.000Z' }, { id: 'same', authoritativeVersion: 1, type: 'processing' as const, occurredAt: '2026-06-02T10:00:00.000Z', attemptId: 'a', method: 'ach' as const }],
      [{ id: 'gap', authoritativeVersion: 2, type: 'requested' as const, occurredAt: '2026-06-01T10:00:00.000Z' }],
      [{ id: 'illegal', authoritativeVersion: 1, type: 'settled' as const, occurredAt: '2026-06-01T10:00:00.000Z', attemptId: 'a', method: 'ach' as const }],
      [{ id: 'r', authoritativeVersion: 1, type: 'requested' as const, occurredAt: '2026-06-01T10:00:00.000Z' }, { id: 'p', authoritativeVersion: 2, type: 'processing' as const, occurredAt: '2026-06-02T10:00:00.000Z', attemptId: 'a', method: 'ach' as const }, { id: 's', authoritativeVersion: 3, type: 'settled' as const, occurredAt: '2026-06-03T10:00:00.000Z', attemptId: 'b', method: 'check' as const }],
      [{ id: 'r', authoritativeVersion: 1, type: 'requested' as const, occurredAt: '2026-06-01T10:00:00.000Z' }, { id: 'h', authoritativeVersion: 2, type: 'hold' as const, occurredAt: '2026-06-02T10:00:00.000Z' }],
    ];
    for (const events of invalid) expect(foldSyntheticPayoutEvents(events, seed)).toMatchObject({ state: 'status-unavailable', authority: 'unavailable', actions: { mutations: 'disabled' } });
  });

  it('fails closed a malformed reversal audit independently', () => {
    const seed = { amountCents: '12500', currency: 'USD', period: '2026-06', createdAt: '2026-06-01T10:00:00.000Z' };
    const events = [
      { id: 'r', authoritativeVersion: 1, type: 'requested' as const, occurredAt: '2026-06-01T10:00:00.000Z' },
      { id: 'p', authoritativeVersion: 2, type: 'processing' as const, occurredAt: '2026-06-02T10:00:00.000Z', attemptId: 'a', method: 'ach' as const },
      { id: 's', authoritativeVersion: 3, type: 'settled' as const, occurredAt: '2026-06-03T10:00:00.000Z', attemptId: 'a', method: 'ach' as const },
      { id: 'x', authoritativeVersion: 4, type: 'reversed' as const, occurredAt: '2026-06-04T10:00:00.000Z', auditReference: '' },
    ];
    expect(foldSyntheticPayoutEvents(events, seed)).toMatchObject({ state: 'status-unavailable', authority: 'unavailable', actions: { mutations: 'disabled' } });
  });

  it('fails closed an otherwise valid audited reversal until a canonical reversed state exists', () => {
    const seed = { amountCents: '12500', currency: 'USD', period: '2026-06', createdAt: '2026-06-01T10:00:00.000Z' };
    const events = [
      { id: 'r', authoritativeVersion: 1, type: 'requested' as const, occurredAt: '2026-06-01T10:00:00.000Z' },
      { id: 'p', authoritativeVersion: 2, type: 'processing' as const, occurredAt: '2026-06-02T10:00:00.000Z', attemptId: 'a', method: 'ach' as const },
      { id: 's', authoritativeVersion: 3, type: 'settled' as const, occurredAt: '2026-06-03T10:00:00.000Z', attemptId: 'a', method: 'ach' as const },
      { id: 'x', authoritativeVersion: 4, type: 'reversed' as const, occurredAt: '2026-06-04T10:00:00.000Z', attemptId: 'a', method: 'ach' as const, auditReference: 'audit-1' },
    ];
    expect(foldSyntheticPayoutEvents(events, seed)).toMatchObject({ state: 'status-unavailable', authority: 'unavailable', actions: { mutations: 'disabled' } });
  });

  it('fails closed repeated audited reversal events independently', () => {
    const seed = { amountCents: '12500', currency: 'USD', period: '2026-06', createdAt: '2026-06-01T10:00:00.000Z' };
    const events = [
      { id: 'r', authoritativeVersion: 1, type: 'requested' as const, occurredAt: '2026-06-01T10:00:00.000Z' },
      { id: 'p', authoritativeVersion: 2, type: 'processing' as const, occurredAt: '2026-06-02T10:00:00.000Z', attemptId: 'a', method: 'ach' as const },
      { id: 's', authoritativeVersion: 3, type: 'settled' as const, occurredAt: '2026-06-03T10:00:00.000Z', attemptId: 'a', method: 'ach' as const },
      { id: 'x1', authoritativeVersion: 4, type: 'reversed' as const, occurredAt: '2026-06-04T10:00:00.000Z', attemptId: 'a', method: 'ach' as const, auditReference: 'audit-1' },
      { id: 'x2', authoritativeVersion: 5, type: 'reversed' as const, occurredAt: '2026-06-05T10:00:00.000Z', attemptId: 'a', method: 'ach' as const, auditReference: 'audit-2' },
    ];
    expect(foldSyntheticPayoutEvents(events, seed)).toMatchObject({ state: 'status-unavailable', authority: 'unavailable', actions: { mutations: 'disabled' } });
  });
});

/**
 * Payout flow (SPEC 8/9) plus the MVP money loop:
 * sale -> approval -> balance -> CSV payout -> void -> offset.
 */
describe('payouts (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let engine: EngineService;
  let complianceRoleSeq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    engine = moduleRef.get(EngineService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  function token(opts: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const payload: AccessTokenPayload = {
      sub: opts.userId,
      mid: opts.membershipId,
      tid: opts.tenantId,
      role: opts.role,
      perms: defaultPermissionsForTier(opts.role),
      authGeneration: 1,
    };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  /** Tenant (on_approval, min $1000) + plan + owner role + 5-upline chain; seller is at the bottom. */
  async function scenario() {
    const tenant = await createTenant(prisma); // on_approval -> payable, payoutMin 100000.
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    await prisma.membership.update({ where: { id: chain[0].id }, data: { role: Role.tenant_owner } });
    return { tenant, chain, seller: chain[5], owner: chain[0] };
  }

  async function complianceActor(
    tenantId: string,
    membership: { id: string; userId: string },
    permissions: string[],
  ): Promise<string> {
    const role = await prisma.tenantRole.create({
      data: {
        tenantId,
        key: `compliance_${++complianceRoleSeq}`,
        name: `Compliance ${complianceRoleSeq}`,
        permissions,
      },
    });
    await prisma.membership.update({
      where: { id: membership.id },
      data: { role: Role.tenant_admin, roleId: role.id },
    });
    return token({
      userId: membership.userId,
      membershipId: membership.id,
      tenantId,
      role: Role.tenant_admin,
    });
  }

  it('lets an owner read deterministic missing payout compliance controls without a destination', async () => {
    const { tenant, chain, seller, owner } = await scenario();
    const ownerToken = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const response = await request(app.getHttpServer())
      .get(`/v1/admin/payouts/members/${seller.id}/readiness`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(response.body).toEqual({
      membershipId: seller.id,
      controls: ['address', 'kyc', 'fraud', 'sanctions', 'payment_method'].map((key) => ({
        key,
        status: 'pending',
        reasonCode: 'review_required',
        reviewedAt: null,
        expiresAt: null,
        version: 0,
      })),
      activeDestination: null,
    });

    for (const key of ['finance', 'support', 'analyst']) {
      const role = SYSTEM_ROLES.find((candidate) => candidate.key === key)!;
      expect(role.permissions).not.toContain('compliance.view');
      expect(role.permissions).not.toContain('compliance.review');
    }

    const deniedActors = await Promise.all(
      ['finance', 'support', 'analyst'].map((key, index) =>
        complianceActor(
          tenant.id,
          chain[index + 1],
          SYSTEM_ROLES.find((candidate) => candidate.key === key)!.permissions,
        ),
      ),
    );
    deniedActors.push(token({ userId: chain[4].userId, membershipId: chain[4].id, tenantId: tenant.id, role: Role.member }));
    for (const deniedToken of deniedActors) {
      await request(app.getHttpServer())
        .get(`/v1/admin/payouts/members/${seller.id}/readiness`)
        .set('Authorization', `Bearer ${deniedToken}`)
        .expect(403);
    }
  });

  it('enforces compliance view/review permissions, tenant scope, self-review, versions, and safe decision audit metadata', async () => {
    const { tenant, chain, seller, owner } = await scenario();
    const viewToken = await complianceActor(tenant.id, chain[1], ['compliance.view']);
    const reviewToken = await complianceActor(tenant.id, chain[2], ['compliance.review']);
    const ownerToken = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    await request(app.getHttpServer())
      .get(`/v1/admin/payouts/members/${seller.id}/readiness`)
      .set('Authorization', `Bearer ${viewToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .put(`/v1/admin/payouts/members/${seller.id}/readiness/kyc`)
      .set('Authorization', `Bearer ${viewToken}`)
      .send({ status: 'ready', reasonCode: 'provider_verified', expectedVersion: 0 })
      .expect(403);

    const first = await request(app.getHttpServer())
      .put(`/v1/admin/payouts/members/${seller.id}/readiness/kyc`)
      .set('Authorization', `Bearer ${reviewToken}`)
      .send({ status: 'ready', reasonCode: 'provider_verified', expiresAt: '2027-01-01T00:00:00.000Z', expectedVersion: 0 })
      .expect(200);
    expect(first.body).toMatchObject({
      membershipId: seller.id,
      key: 'kyc',
      status: 'ready',
      reasonCode: 'provider_verified',
      expiresAt: '2027-01-01T00:00:00.000Z',
      version: 1,
    });
    expect(typeof first.body.reviewedAt).toBe('string');

    const second = await request(app.getHttpServer())
      .put(`/v1/admin/payouts/members/${seller.id}/readiness/kyc`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'blocked', reasonCode: 'manual_hold', expiresAt: null, expectedVersion: 1 })
      .expect(200);
    expect(second.body).toMatchObject({
      membershipId: seller.id,
      key: 'kyc',
      status: 'blocked',
      reasonCode: 'manual_hold',
      expiresAt: null,
      version: 2,
    });

    await request(app.getHttpServer())
      .put(`/v1/admin/payouts/members/${seller.id}/readiness/kyc`)
      .set('Authorization', `Bearer ${reviewToken}`)
      .send({ status: 'ready', reasonCode: 'stale_attempt', expectedVersion: 1 })
      .expect(409);
    expect(await prisma.payoutReadinessCheck.findFirstOrThrow({ where: { tenantId: tenant.id, membershipId: seller.id } }))
      .toMatchObject({ status: 'blocked', reasonCode: 'manual_hold', version: 2 });

    await request(app.getHttpServer())
      .put(`/v1/admin/payouts/members/${chain[2].id}/readiness/address`)
      .set('Authorization', `Bearer ${reviewToken}`)
      .send({ status: 'ready', reasonCode: 'address_verified', expectedVersion: 0 })
      .expect(403);

    const foreignTenant = await createTenant(prisma);
    const foreignTarget = (await createChain(prisma, foreignTenant.id, 1))[0];
    await request(app.getHttpServer())
      .put(`/v1/admin/payouts/members/${foreignTarget.id}/readiness/address`)
      .set('Authorization', `Bearer ${reviewToken}`)
      .send({ status: 'ready', reasonCode: 'address_verified', expectedVersion: 0 })
      .expect(404);

    const audits = await prisma.auditLog.findMany({
      where: { tenantId: tenant.id, entityId: seller.id, action: 'payout_compliance.readiness_decided' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits).toHaveLength(2);
    expect(audits[1].after).toEqual({
      membershipId: seller.id,
      key: 'kyc',
      status: 'blocked',
      reasonCode: 'manual_hold',
      version: 2,
      expiresAt: null,
    });
    expect(JSON.stringify(audits)).not.toMatch(/providerReference|stale_attempt/);
  });

  it('derives safe labels and makes parallel destination first writes and replacements atomic and secret-free', async () => {
    const { tenant, chain, seller, owner } = await scenario();
    const reviewToken = await complianceActor(tenant.id, chain[1], ['compliance.review']);
    const ownerToken = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const destinationUrl = `/v1/admin/payouts/members/${seller.id}/destination`;
    const displayLabel = (body: { currency: string; last4?: string | null }) =>
      body.last4 ? `${body.currency} payout destination •••• ${body.last4}` : `${body.currency} payout destination`;
    const firstCandidates = [
      {
        providerReference: 'provider-first-secret-a',
        maskedLabel: 'provider-first-secret-a raw bank account and routing text',
        last4: '1111',
        country: 'US',
        currency: 'USD',
        verifiedAt: '2026-07-17T12:00:00.000Z',
        expectedVersion: 0,
      },
      {
        providerReference: 'provider-first-secret-b',
        maskedLabel: 'provider-first-secret-b raw bank account and routing text',
        last4: '2222',
        country: 'CA',
        currency: 'CAD',
        verifiedAt: '2026-07-17T12:01:00.000Z',
        expectedVersion: 0,
      },
    ];
    const firstResponses = await Promise.all(
      firstCandidates.map((body) =>
        request(app.getHttpServer()).put(destinationUrl).set('Authorization', `Bearer ${reviewToken}`).send(body),
      ),
    );
    expect(firstResponses.map((response) => response.status).sort()).toEqual([200, 409]);
    for (const [index, response] of firstResponses.entries()) {
      expect(JSON.stringify(response.body)).not.toContain(firstCandidates[index].providerReference);
      expect(JSON.stringify(response.body)).not.toContain(firstCandidates[index].maskedLabel);
    }
    const firstWinnerIndex = firstResponses.findIndex((response) => response.status === 200);
    const firstWinner = firstCandidates[firstWinnerIndex];
    expect(firstResponses[firstWinnerIndex].body).toMatchObject({
      maskedLabel: displayLabel(firstWinner),
      last4: firstWinner.last4,
      country: firstWinner.country,
      currency: firstWinner.currency,
      version: 1,
    });
    expect(await prisma.payoutDestination.findMany({ where: { tenantId: tenant.id, membershipId: seller.id } }))
      .toMatchObject([{ providerReference: firstWinner.providerReference, maskedLabel: displayLabel(firstWinner), active: true, version: 1 }]);

    const replacementCandidates = [
      {
        providerReference: 'provider-replacement-secret-a',
        maskedLabel: 'provider-replacement-secret-a raw bank account and routing text',
        last4: null,
        country: 'GB',
        currency: 'GBP',
        verifiedAt: '2026-07-17T13:00:00.000Z',
        expectedVersion: 1,
      },
      {
        providerReference: 'provider-replacement-secret-b',
        maskedLabel: 'provider-replacement-secret-b raw bank account and routing text',
        last4: '4444',
        country: 'AU',
        currency: 'AUD',
        verifiedAt: '2026-07-17T13:01:00.000Z',
        expectedVersion: 1,
      },
    ];
    const replacementResponses = await Promise.all(
      replacementCandidates.map((body) =>
        request(app.getHttpServer()).put(destinationUrl).set('Authorization', `Bearer ${reviewToken}`).send(body),
      ),
    );
    expect(replacementResponses.map((response) => response.status).sort()).toEqual([200, 409]);
    for (const [index, response] of replacementResponses.entries()) {
      expect(JSON.stringify(response.body)).not.toContain(replacementCandidates[index].providerReference);
      expect(JSON.stringify(response.body)).not.toContain(replacementCandidates[index].maskedLabel);
    }
    const replacementWinnerIndex = replacementResponses.findIndex((response) => response.status === 200);
    const replacementWinner = replacementCandidates[replacementWinnerIndex];
    expect(replacementResponses[replacementWinnerIndex].body).toMatchObject({
      maskedLabel: displayLabel(replacementWinner),
      last4: replacementWinner.last4,
      country: replacementWinner.country,
      currency: replacementWinner.currency,
      version: 2,
    });

    const rows = await prisma.payoutDestination.findMany({
      where: { tenantId: tenant.id, membershipId: seller.id },
      orderBy: { version: 'asc' },
    });
    expect(rows.map(({ active, version }) => ({ active, version }))).toEqual([
      { active: false, version: 1 },
      { active: true, version: 2 },
    ]);
    expect(rows.map((row) => row.providerReference)).toEqual([firstWinner.providerReference, replacementWinner.providerReference]);
    expect(rows.map((row) => row.maskedLabel)).toEqual([displayLabel(firstWinner), displayLabel(replacementWinner)]);

    const read = await request(app.getHttpServer())
      .get(`/v1/admin/payouts/members/${seller.id}/readiness`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(read.body.activeDestination).toMatchObject({ maskedLabel: displayLabel(replacementWinner), version: 2 });
    expect(JSON.stringify(read.body)).not.toMatch(/provider-(first|replacement)-secret|raw bank account|routing text/);

    const audits = await prisma.auditLog.findMany({
      where: { tenantId: tenant.id, entityId: seller.id, action: 'payout_compliance.destination_replaced' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits).toHaveLength(2);
    expect(audits[1].after).toEqual({
      membershipId: seller.id,
      maskedLabel: displayLabel(replacementWinner),
      last4: replacementWinner.last4,
      country: replacementWinner.country,
      currency: replacementWinner.currency,
      verifiedAt: replacementWinner.verifiedAt,
      version: 2,
    });
    expect(JSON.stringify(audits)).not.toMatch(/providerReference|provider-(first|replacement)-secret|raw bank account|routing text/);
  });

  it('rejects invalid payout compliance fields and accepts current fixed ISO currency codes', async () => {
    const { tenant, chain, seller } = await scenario();
    const reviewToken = await complianceActor(tenant.id, chain[1], ['compliance.review']);
    const decisionUrl = `/v1/admin/payouts/members/${seller.id}/readiness/kyc`;
    const destinationUrl = `/v1/admin/payouts/members/${seller.id}/destination`;

    for (const body of [
      { status: 'ready', reasonCode: 'free form text', expectedVersion: 0 },
      { status: 'ready', reasonCode: 'x', expectedVersion: 0 },
      { status: 'ready', reasonCode: 'valid_reason', expectedVersion: -1 },
      { status: 'ready', reasonCode: 'valid_reason', expectedVersion: 1.5 },
      { status: 'ready', reasonCode: 'valid_reason', expectedVersion: 2_147_483_647 },
    ]) {
      await request(app.getHttpServer()).put(decisionUrl).set('Authorization', `Bearer ${reviewToken}`).send(body).expect(400);
    }
    await request(app.getHttpServer())
      .put(`/v1/admin/payouts/members/${seller.id}/readiness/not_a_key`)
      .set('Authorization', `Bearer ${reviewToken}`)
      .send({ status: 'ready', reasonCode: 'valid_reason', expectedVersion: 0 })
      .expect(400);

    const validDestination = {
      providerReference: 'validation-secret',
      maskedLabel: 'validation-secret raw bank account and routing text',
      last4: '4242',
      country: 'US',
      currency: 'USD',
      verifiedAt: '2026-07-17T12:00:00.000Z',
      expectedVersion: 0,
    };
    for (const override of [
      { country: 'USA' },
      { country: 'us' },
      { country: 'EU' },
      { country: 'ZZ' },
      { currency: 'US' },
      { currency: 'usd' },
      { currency: 'ZZZ' },
      { currency: 'ANG' },
      { currency: 'BGN' },
      { currency: 'CUC' },
      { currency: 'SLL' },
      { currency: 'ZWL' },
      { last4: '42x2' },
      { last4: '12345' },
      { expectedVersion: -1 },
      { expectedVersion: 0.5 },
      { expectedVersion: 2_147_483_647 },
      { verifiedAt: 'not-a-date' },
    ]) {
      const response = await request(app.getHttpServer())
        .put(destinationUrl)
        .set('Authorization', `Bearer ${reviewToken}`)
        .send({ ...validDestination, ...override })
        .expect(400);
      expect(JSON.stringify(response.body)).not.toContain(validDestination.providerReference);
    }

    await request(app.getHttpServer())
      .put(destinationUrl)
      .set('Authorization', `Bearer ${reviewToken}`)
      .send({ ...validDestination, providerReference: 'current-xcg-secret', currency: 'XCG' })
      .expect(200);
    await request(app.getHttpServer())
      .put(destinationUrl)
      .set('Authorization', `Bearer ${reviewToken}`)
      .send({ ...validDestination, providerReference: 'current-xad-secret', currency: 'XAD', expectedVersion: 1 })
      .expect(200);
  });

  async function createRequestedPayout(tenantId: string, membershipId: string, totalCents: bigint) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } });
    const period = monthKey(new Date(), tenant.timezone);
    return prisma.payout.create({
      data: {
        tenantId,
        membershipId,
        totalCents,
        status: PayoutStatus.requested,
        period,
        activeKey: payoutActiveKey(tenantId, membershipId, period),
      },
    });
  }

  type TestPayoutScope =
    | { mode: 'selected'; membershipIds: string[] }
    | { mode: 'all_eligible'; filters: { period?: string; method: 'manual' | 'csv' } };

  async function requestPreview(authToken: string, scope: TestPayoutScope) {
    return request(app.getHttpServer())
      .post('/v1/admin/payouts/batches/preview')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ scope })
      .expect(200);
  }

  async function confirmPreview(
    authToken: string,
    scope: TestPayoutScope,
    previewToken: string,
    endpoint: 'batches' | 'run' = 'batches',
  ) {
    return request(app.getHttpServer())
      .post(`/v1/admin/payouts/${endpoint}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ scope, previewToken })
      .expect(200);
  }

  async function startReviewedBatch(
    authToken: string,
    scope: TestPayoutScope,
    endpoint: 'batches' | 'run' = 'batches',
  ) {
    const preview = await requestPreview(authToken, scope);
    return confirmPreview(authToken, preview.body.normalizedScope, preview.body.previewToken, endpoint);
  }

  function decodePreviewPayload(previewToken: string): Record<string, unknown> {
    const [encodedPayload] = previewToken.split('.');
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<string, unknown>;
  }

  function signEncodedPreviewPayload(encodedPayload: string): string {
    const derivedKey = createHmac('sha256', authConfig.accessSecret())
      .update('payout-batch-preview:v1')
      .digest();
    return createHmac('sha256', derivedKey).update(encodedPayload).digest('base64url');
  }

  it('fails closed when payout batch preview or confirmation lacks an explicit valid scope', async () => {
    const { tenant, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const invalidBodies = [
      {},
      { membershipIds: [owner.id] },
      { scope: { mode: 'selected', membershipIds: [] } },
      { scope: { mode: 'all_eligible', filters: { method: 'wire' } } },
    ];

    for (const body of invalidBodies) {
      await request(app.getHttpServer())
        .post('/v1/admin/payouts/batches/preview')
        .set('Authorization', `Bearer ${ownerTok}`)
        .send(body)
        .expect(400);
      await request(app.getHttpServer())
        .post('/v1/admin/payouts/batches')
        .set('Authorization', `Bearer ${ownerTok}`)
        .send({ ...body, previewToken: 'x'.repeat(32) })
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/v1/admin/payouts/run')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({})
      .expect(400);

    expect(await prisma.payoutBatch.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.payout.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { tenantId: tenant.id, status: LedgerStatus.processing } })).toBe(0);
  });

  it('previews a selected payout scope without mutation and confirms only the reviewed scope', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);
    const scope = { mode: 'selected' as const, membershipIds: [seller.id] };

    const preview = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches/preview')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope })
      .expect(200);

    expect(preview.body).toMatchObject({
      previewToken: expect.any(String),
      expiresAt: expect.any(String),
      eligibleCount: 1,
      excludedCount: 0,
      totals: [{ currency: tenant.currency, amountCents: '500000' }],
      normalizedScope: scope,
    });
    expect(Number.isNaN(Date.parse(preview.body.expiresAt))).toBe(false);
    expect(await prisma.payoutBatch.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { tenantId: tenant.id, status: LedgerStatus.payable } })).toBeGreaterThan(0);

    const confirmed = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(200);
    expect(confirmed.body).toMatchObject({ status: 'processing', processingCount: 1 });
    expect(await prisma.payoutBatch.count({ where: { tenantId: tenant.id } })).toBe(1);
  });

  it('normalizes selected IDs and binds the actor, tenant, snapshot, totals, expiry, and domain into the token', async () => {
    const { tenant, seller, owner } = await scenario();
    const [ineligible] = await createChain(prisma, tenant.id, 1);
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 200_000_000_000_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);
    const requestedIds = [seller.id, ineligible.id, seller.id];

    const preview = await requestPreview(ownerTok, { mode: 'selected', membershipIds: requestedIds });
    const normalizedIds = [...new Set(requestedIds)].sort();
    expect(preview.body).toMatchObject({
      eligibleCount: 1,
      excludedCount: 1,
      totals: [{ currency: 'USD', amountCents: '10000000000000000' }],
      normalizedScope: { mode: 'selected', membershipIds: normalizedIds },
    });
    expect(preview.body.previewToken.length).toBeGreaterThanOrEqual(32);
    expect(decodePreviewPayload(preview.body.previewToken)).toMatchObject({
      domain: 'payout-batch-preview:v1',
      actorUserId: owner.userId,
      tenantId: tenant.id,
      scopeFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      period: expect.stringMatching(/^\d{4}-\d{2}$/),
      method: 'manual',
      eligibleCount: 1,
      excludedCount: 1,
      totals: [{ currency: 'USD', amountCents: '10000000000000000' }],
      selectionFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      expiresAt: preview.body.expiresAt,
    });
    expect(await prisma.payoutBatch.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.payout.count({ where: { tenantId: tenant.id } })).toBe(0);
  });

  it('returns 404 for a selected membership outside the actor tenant without mutation', async () => {
    const first = await scenario();
    const second = await scenario();
    const ownerTok = token({
      userId: first.owner.userId,
      membershipId: first.owner.id,
      tenantId: first.tenant.id,
      role: Role.tenant_owner,
    });

    await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches/preview')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope: { mode: 'selected', membershipIds: [second.seller.id] } })
      .expect(404);
    expect(await prisma.payoutBatch.count()).toBe(0);
    expect(await prisma.payout.count()).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { status: LedgerStatus.processing } })).toBe(0);
  });

  it('rejects tampered, expired, wrong-actor, and wrong-tenant preview tokens without mutation', async () => {
    const first = await scenario();
    const ownerTok = token({
      userId: first.owner.userId,
      membershipId: first.owner.id,
      tenantId: first.tenant.id,
      role: Role.tenant_owner,
    });
    const sale = await createSale(prisma, first.tenant.id, first.seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    const scope = { mode: 'selected' as const, membershipIds: [first.seller.id] };
    const preview = await requestPreview(ownerTok, scope);
    const [sameTenantOwner] = await createChain(prisma, first.tenant.id, 1);
    await prisma.membership.update({ where: { id: sameTenantOwner.id }, data: { role: Role.tenant_owner } });
    const wrongActorTok = token({
      userId: sameTenantOwner.userId,
      membershipId: sameTenantOwner.id,
      tenantId: first.tenant.id,
      role: Role.tenant_owner,
    });
    const second = await scenario();
    const wrongTenantTok = token({
      userId: second.owner.userId,
      membershipId: second.owner.id,
      tenantId: second.tenant.id,
      role: Role.tenant_owner,
    });
    const [encoded, signature] = (preview.body.previewToken as string).split('.');
    const tamperedSignature = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;

    await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope, previewToken: `${encoded}.${tamperedSignature}` })
      .expect(400);
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(preview.body.expiresAt) + 1);
    try {
      await request(app.getHttpServer())
        .post('/v1/admin/payouts/batches')
        .set('Authorization', `Bearer ${ownerTok}`)
        .send({ scope, previewToken: preview.body.previewToken })
        .expect(400);
    } finally {
      dateNow.mockRestore();
    }
    await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${wrongActorTok}`)
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(400);
    await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${wrongTenantTok}`)
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(400);

    expect(await prisma.payoutBatch.count()).toBe(0);
    expect(await prisma.payout.count()).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { status: LedgerStatus.processing } })).toBe(0);
  });

  it('rejects noncanonical and overlong preview-token encodings with a generic error and no mutation', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    const scope = { mode: 'selected' as const, membershipIds: [seller.id] };
    const preview = await requestPreview(ownerTok, scope);
    const [encodedPayload, signature] = (preview.body.previewToken as string).split('.');
    const ignoredPayload = `${encodedPayload}!!`;
    const paddedPayload = `${encodedPayload}=`;
    const invalidTokens = [
      `${encodedPayload}.${signature}!!`,
      `${encodedPayload}.${signature}=`,
      `${ignoredPayload}.${signEncodedPreviewPayload(ignoredPayload)}`,
      `${paddedPayload}.${signEncodedPreviewPayload(paddedPayload)}`,
      `${encodedPayload}.${signature}${'!'.repeat(4096)}`,
    ];

    for (const previewToken of invalidTokens) {
      const response = await request(app.getHttpServer())
        .post('/v1/admin/payouts/batches')
        .set('Authorization', `Bearer ${ownerTok}`)
        .send({ scope, previewToken })
        .expect(400);
      expect(response.body.message).toBe('invalid payout batch preview token');
    }

    expect(await prisma.payoutBatch.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.payout.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.payoutBatchItem.count()).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { tenantId: tenant.id, status: LedgerStatus.processing } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id, action: { startsWith: 'payout' } } })).toBe(0);
  });

  it('returns review_required with a fresh preview for scope mismatch or transaction-time total drift', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);
    const selectedScope = { mode: 'selected' as const, membershipIds: [seller.id] };
    const selectedPreview = await requestPreview(ownerTok, selectedScope);
    const mismatchedScope = { mode: 'all_eligible' as const, filters: { method: 'manual' as const } };

    const mismatch = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope: mismatchedScope, previewToken: selectedPreview.body.previewToken })
      .expect(409);
    expect(mismatch.body).toMatchObject({
      code: 'review_required',
      preview: {
        previewToken: expect.any(String),
        normalizedScope: { mode: 'all_eligible', filters: { method: 'manual', period: expect.any(String) } },
      },
    });
    expect(await prisma.payoutBatch.count({ where: { tenantId: tenant.id } })).toBe(0);

    const driftPreview = await requestPreview(ownerTok, selectedScope);
    const adjustmentSale = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 1n,
        status: SaleStatus.approved,
        saleDate: new Date(),
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        tenantId: tenant.id,
        saleId: adjustmentSale.id,
        beneficiaryMembershipId: seller.id,
        level: 0,
        rateBpsUsed: 0,
        amountCents: 1n,
        type: LedgerType.adjustment,
        status: LedgerStatus.payable,
      },
    });
    const drift = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope: selectedScope, previewToken: driftPreview.body.previewToken })
      .expect(409);
    expect(drift.body).toMatchObject({
      code: 'review_required',
      preview: { eligibleCount: 1, totals: [{ currency: 'USD', amountCents: '500001' }] },
    });
    expect(await prisma.payoutBatch.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.payout.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { tenantId: tenant.id, status: LedgerStatus.processing } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id, action: { startsWith: 'payout' } } })).toBe(0);
  });

  it('returns exact non-confirmable review evidence for an over-cap scope mismatch without mutation', async () => {
    const { tenant, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const selectedScope = { mode: 'selected' as const, membershipIds: [owner.id] };
    const selectedPreview = await requestPreview(ownerTok, selectedScope);
    const members: Array<typeof owner> = [];
    for (let index = 0; index < 101; index++) {
      const [member] = await createChain(prisma, tenant.id, 1);
      members.push(member);
    }
    await prisma.$transaction(async (tx) => {
      for (const member of members) {
        const sale = await tx.sale.create({
          data: {
            tenantId: tenant.id,
            sellerMembershipId: member.id,
            amountCents: 100_000n,
            status: SaleStatus.approved,
            saleDate: new Date(),
          },
        });
        await tx.ledgerEntry.create({
          data: {
            tenantId: tenant.id,
            saleId: sale.id,
            beneficiaryMembershipId: member.id,
            level: 0,
            rateBpsUsed: 10_000,
            amountCents: 100_000n,
            type: LedgerType.commission,
            status: LedgerStatus.payable,
          },
        });
      }
    });
    const before = {
      batches: await prisma.payoutBatch.count({ where: { tenantId: tenant.id } }),
      payouts: await prisma.payout.count({ where: { tenantId: tenant.id } }),
      items: await prisma.payoutBatchItem.count(),
      processing: await prisma.ledgerEntry.count({ where: { tenantId: tenant.id, status: LedgerStatus.processing } }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenant.id, action: { startsWith: 'payout' } } }),
    };
    const allEligibleScope = { mode: 'all_eligible' as const, filters: { method: 'manual' as const } };

    const mismatch = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope: allEligibleScope, previewToken: selectedPreview.body.previewToken })
      .expect(409);
    expect(mismatch.body).toMatchObject({
      code: 'review_required',
      preview: {
        eligibleCount: 101,
        excludedCount: 0,
        totals: [{ currency: tenant.currency, amountCents: '10100000' }],
        normalizedScope: {
          mode: 'all_eligible',
          filters: { method: 'manual', period: expect.stringMatching(/^\d{4}-\d{2}$/) },
        },
      },
    });
    await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({
        scope: mismatch.body.preview.normalizedScope,
        previewToken: mismatch.body.preview.previewToken,
      })
      .expect(400);
    expect({
      batches: await prisma.payoutBatch.count({ where: { tenantId: tenant.id } }),
      payouts: await prisma.payout.count({ where: { tenantId: tenant.id } }),
      items: await prisma.payoutBatchItem.count(),
      processing: await prisma.ledgerEntry.count({ where: { tenantId: tenant.id, status: LedgerStatus.processing } }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenant.id, action: { startsWith: 'payout' } } }),
    }).toEqual(before);
  });

  it('returns review_required when the eligible count or currency grouping drifts before confirmation', async () => {
    const { tenant, chain, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    for (const member of chain) {
      await seedReadyPayoutCompliance(prisma, tenant.id, member.id, owner.userId);
    }
    const scope = { mode: 'all_eligible' as const, filters: { method: 'manual' as const } };
    const initialPreview = await requestPreview(ownerTok, scope);
    for (let index = initialPreview.body.eligibleCount; index < 100; index++) {
      const [member] = await createChain(prisma, tenant.id, 1);
      const additionalSale = await prisma.sale.create({
        data: {
          tenantId: tenant.id,
          sellerMembershipId: member.id,
          amountCents: 100_000n,
          status: SaleStatus.approved,
          saleDate: new Date(),
        },
      });
      await prisma.ledgerEntry.create({
        data: {
          tenantId: tenant.id,
          saleId: additionalSale.id,
          beneficiaryMembershipId: member.id,
          level: 0,
          rateBpsUsed: 10_000,
          amountCents: 100_000n,
          type: LedgerType.commission,
          status: LedgerStatus.payable,
        },
      });
      await seedReadyPayoutCompliance(prisma, tenant.id, member.id, owner.userId);
    }
    const countPreview = await requestPreview(ownerTok, scope);
    expect(countPreview.body.eligibleCount).toBe(100);
    for (let index = 0; index < 3; index++) {
      const [newMember] = await createChain(prisma, tenant.id, 1);
      const directSale = await prisma.sale.create({
        data: {
          tenantId: tenant.id,
          sellerMembershipId: newMember.id,
          amountCents: 100_000n,
          status: SaleStatus.approved,
          saleDate: new Date(),
        },
      });
      await prisma.ledgerEntry.create({
        data: {
          tenantId: tenant.id,
          saleId: directSale.id,
          beneficiaryMembershipId: newMember.id,
          level: 0,
          rateBpsUsed: 10_000,
          amountCents: 100_000n,
          type: LedgerType.commission,
          status: LedgerStatus.payable,
        },
      });
      await seedReadyPayoutCompliance(prisma, tenant.id, newMember.id, owner.userId);
      if (index === 0) {
        await startReviewedBatch(ownerTok, { mode: 'selected', membershipIds: [newMember.id] });
        const newlyAccruedSale = await prisma.sale.create({
          data: {
            tenantId: tenant.id,
            sellerMembershipId: newMember.id,
            amountCents: 100_000n,
            status: SaleStatus.approved,
            saleDate: new Date(),
          },
        });
        await prisma.ledgerEntry.create({
          data: {
            tenantId: tenant.id,
            saleId: newlyAccruedSale.id,
            beneficiaryMembershipId: newMember.id,
            level: 0,
            rateBpsUsed: 10_000,
            amountCents: 100_000n,
            type: LedgerType.commission,
            status: LedgerStatus.payable,
          },
        });
      }
    }
    const beforeDrift = {
      batches: await prisma.payoutBatch.count({ where: { tenantId: tenant.id } }),
      payouts: await prisma.payout.count({ where: { tenantId: tenant.id } }),
      items: await prisma.payoutBatchItem.count(),
      processing: await prisma.ledgerEntry.count({
        where: { tenantId: tenant.id, status: LedgerStatus.processing },
      }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenant.id } }),
    };

    const countDrift = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope, previewToken: countPreview.body.previewToken })
      .expect(409);
    expect(countDrift.body.code).toBe('review_required');
    expect(countDrift.body.preview.eligibleCount).toBe(countPreview.body.eligibleCount + 2);
    expect(countDrift.body.preview.excludedCount).toBe(1);
    expect(countDrift.body.preview.totals[0].amountCents).toBe(
      (BigInt(countPreview.body.totals[0].amountCents) + 200_000n).toString(),
    );
    await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({
        scope: countDrift.body.preview.normalizedScope,
        previewToken: countDrift.body.preview.previewToken,
      })
      .expect(400);

    const currencyScope = { mode: 'selected' as const, membershipIds: [seller.id] };
    const currencyPreview = await requestPreview(ownerTok, currencyScope);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { currency: 'EUR' } });
    const currencyDrift = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope: currencyScope, previewToken: currencyPreview.body.previewToken })
      .expect(409);
    expect(currencyDrift.body).toMatchObject({
      code: 'review_required',
      preview: { totals: [expect.objectContaining({ currency: 'EUR' })] },
    });
    expect({
      batches: await prisma.payoutBatch.count({ where: { tenantId: tenant.id } }),
      payouts: await prisma.payout.count({ where: { tenantId: tenant.id } }),
      items: await prisma.payoutBatchItem.count(),
      processing: await prisma.ledgerEntry.count({
        where: { tenantId: tenant.id, status: LedgerStatus.processing },
      }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenant.id } }),
    }).toEqual(beforeDrift);
  });

  it('detects a same-count same-total all-eligible membership swap without mutation', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    const allScope = { mode: 'all_eligible' as const, filters: { method: 'manual' as const } };
    const originalPreview = await requestPreview(ownerTok, allScope);

    await startReviewedBatch(ownerTok, { mode: 'selected', membershipIds: [seller.id] });
    const [replacement] = await createChain(prisma, tenant.id, 1);
    const replacementSale = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: replacement.id,
        amountCents: 500_000n,
        status: SaleStatus.approved,
        saleDate: new Date(),
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        tenantId: tenant.id,
        saleId: replacementSale.id,
        beneficiaryMembershipId: replacement.id,
        level: 0,
        rateBpsUsed: 10_000,
        amountCents: 500_000n,
        type: LedgerType.commission,
        status: LedgerStatus.payable,
      },
    });
    const before = {
      batches: await prisma.payoutBatch.count({ where: { tenantId: tenant.id } }),
      payouts: await prisma.payout.count({ where: { tenantId: tenant.id } }),
      items: await prisma.payoutBatchItem.count(),
      processing: await prisma.ledgerEntry.count({
        where: { tenantId: tenant.id, status: LedgerStatus.processing },
      }),
      payable: await prisma.ledgerEntry.count({ where: { tenantId: tenant.id, status: LedgerStatus.payable } }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenant.id } }),
    };

    const drift = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope: allScope, previewToken: originalPreview.body.previewToken })
      .expect(409);
    expect(drift.body).toMatchObject({
      code: 'review_required',
      preview: {
        eligibleCount: originalPreview.body.eligibleCount,
        totals: originalPreview.body.totals,
      },
    });
    expect({
      batches: await prisma.payoutBatch.count({ where: { tenantId: tenant.id } }),
      payouts: await prisma.payout.count({ where: { tenantId: tenant.id } }),
      items: await prisma.payoutBatchItem.count(),
      processing: await prisma.ledgerEntry.count({
        where: { tenantId: tenant.id, status: LedgerStatus.processing },
      }),
      payable: await prisma.ledgerEntry.count({ where: { tenantId: tenant.id, status: LedgerStatus.payable } }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenant.id } }),
    }).toEqual(before);
  });

  it('keeps settle, fail, and batch export tenant-bound after reviewed confirmation', async () => {
    const first = await scenario();
    const firstOwnerTok = token({
      userId: first.owner.userId,
      membershipId: first.owner.id,
      tenantId: first.tenant.id,
      role: Role.tenant_owner,
    });
    const sale = await createSale(prisma, first.tenant.id, first.seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, first.tenant.id, first.seller.id, first.owner.userId);
    const started = await startReviewedBatch(firstOwnerTok, {
      mode: 'selected',
      membershipIds: [first.seller.id],
    });
    const second = await scenario();
    const secondOwnerTok = token({
      userId: second.owner.userId,
      membershipId: second.owner.id,
      tenantId: second.tenant.id,
      role: Role.tenant_owner,
    });

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${started.body.id}/settle`)
      .set('Authorization', `Bearer ${secondOwnerTok}`)
      .send({ settlementReference: 'cross-tenant', settlementEvidence: 'must-not-settle' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${started.body.id}/fail`)
      .set('Authorization', `Bearer ${secondOwnerTok}`)
      .send({ reason: 'must-not-fail' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/v1/admin/payouts/batches/${started.body.id}/export.csv`)
      .set('Authorization', `Bearer ${secondOwnerTok}`)
      .expect(404);

    expect(await prisma.payoutBatch.findUniqueOrThrow({ where: { id: started.body.id } })).toMatchObject({
      tenantId: first.tenant.id,
      status: 'processing',
    });
    expect(await prisma.payout.count({ where: { batchId: started.body.id, status: PayoutStatus.processing } })).toBe(1);
    expect(
      await prisma.ledgerEntry.count({
        where: { tenantId: first.tenant.id, payoutBatchId: started.body.id, status: LedgerStatus.processing },
      }),
    ).toBe(1);
  });

  it('reserves a bounded payout batch into processing and settles it only with evidence', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);

    const started = await startReviewedBatch(ownerTok, { mode: 'selected', membershipIds: [seller.id] });
    expect(started.body).toMatchObject({ status: 'processing', processingCount: 1 });
    expect(started.body.id).toEqual(expect.any(String));

    const processingRows = await prisma.$queryRaw<
      Array<{ status: string; payoutId: string | null; batchId: string | null }>
    >`
      SELECT status::text AS "status", payout_id AS "payoutId", payout_batch_id AS "batchId"
      FROM ledger_entries
      WHERE beneficiary_membership_id = ${seller.id}::uuid`;
    expect(processingRows).toEqual([
      expect.objectContaining({ status: 'processing', payoutId: expect.any(String), batchId: started.body.id }),
    ]);

    const processingSummary = await prisma.$queryRaw<
      Array<{ payable: bigint; processing: bigint; paid: bigint }>
    >`
      SELECT payable_cents AS "payable", processing_cents AS "processing", paid_cents AS "paid"
      FROM monthly_summaries
      WHERE membership_id = ${seller.id}::uuid`;
    expect(processingSummary).toEqual([{ payable: 0n, processing: 500_000n, paid: 0n }]);

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${started.body.id}/settle`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({})
      .expect(400);
    expect(
      await prisma.$queryRaw<Array<{ status: string }>>`
        SELECT status::text AS "status" FROM ledger_entries WHERE beneficiary_membership_id = ${seller.id}::uuid`,
    ).toEqual([{ status: 'processing' }]);

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${started.body.id}/settle`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ settlementReference: 'bank-transfer-42', settlementEvidence: 'provider-confirmation-42' })
      .expect(200);

    const settledSummary = await prisma.$queryRaw<
      Array<{ payable: bigint; processing: bigint; paid: bigint }>
    >`
      SELECT payable_cents AS "payable", processing_cents AS "processing", paid_cents AS "paid"
      FROM monthly_summaries
      WHERE membership_id = ${seller.id}::uuid`;
    expect(settledSummary).toEqual([{ payable: 0n, processing: 0n, paid: 500_000n }]);
    expect(
      await prisma.$queryRaw<Array<{ status: string }>>`
        SELECT status::text AS "status" FROM ledger_entries WHERE beneficiary_membership_id = ${seller.id}::uuid`,
    ).toEqual([{ status: 'paid' }]);
    expect(await prisma.notification.count({ where: { recipientMembershipId: seller.id, template: 'payout_sent' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'payout_batch.settled', entityId: started.body.id } })).toBe(1);
  });

  it('fails a processing batch only with a reason, restores its exact rows, and permits a fresh retry', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);

    const started = await startReviewedBatch(ownerTok, { mode: 'selected', membershipIds: [seller.id] });

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${started.body.id}/fail`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ reason: '  ' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${started.body.id}/fail`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ reason: 'bank file rejected' })
      .expect(200);

    const released = await prisma.ledgerEntry.findMany({ where: { beneficiaryMembershipId: seller.id } });
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({ status: LedgerStatus.payable, payoutId: null, payoutBatchId: null });
    const restored = await summaryTotals(prisma, seller.id);
    expect(restored).toMatchObject({ payable: 500_000n, processing: 0n, paid: 0n });
    expect(await prisma.payout.findFirstOrThrow({ where: { id: started.body.processing[0].payoutId } })).toMatchObject({
      status: PayoutStatus.failed,
      failureReason: 'bank file rejected',
    });

    await request(app.getHttpServer())
      .get(`/v1/admin/payouts/batches/${started.body.id}/export.csv`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(409);

    const retried = await startReviewedBatch(ownerTok, { mode: 'selected', membershipIds: [seller.id] });
    expect(retried.body.id).not.toBe(started.body.id);
    expect(retried.body.processing[0].payoutId).not.toBe(started.body.processing[0].payoutId);
  });

  it('makes repeated processing and concurrent settlement idempotent', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);

    const first = await startReviewedBatch(ownerTok, { mode: 'selected', membershipIds: [seller.id] });
    const second = await startReviewedBatch(ownerTok, { mode: 'selected', membershipIds: [seller.id] });
    expect(second.body).toMatchObject({ id: null, processingCount: 0, skippedCount: 1 });
    expect(second.body.skipped[0].reason).toBe('already_processing');

    const settles = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post(`/v1/admin/payouts/batches/${first.body.id}/settle`)
          .set('Authorization', `Bearer ${ownerTok}`)
          .send({ settlementReference: 'provider-77', settlementEvidence: 'provider-77-confirmed' }),
      ),
    );
    expect(settles.map((response) => response.status)).toEqual([200, 200]);
    expect(settles.filter((response) => response.body.settled === true)).toHaveLength(1);
    expect(settles.filter((response) => response.body.alreadySettled === true)).toHaveLength(1);
    expect(await prisma.notification.count({ where: { recipientMembershipId: seller.id, template: 'payout_sent' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'payout_batch.settled', entityId: first.body.id } })).toBe(1);
    expect(await prisma.payout.count({ where: { batchId: first.body.id, status: PayoutStatus.paid } })).toBe(1);
    expect(await summaryTotals(prisma, seller.id)).toMatchObject({ payable: 0n, processing: 0n, paid: 500_000n });
  });

  it('blocks sale void while a linked ledger row is processing', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);

    const started = await startReviewedBatch(ownerTok, { mode: 'selected', membershipIds: [seller.id] });
    expect(started.body.processingCount).toBe(1);

    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${sale.id}/void`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(409);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe('approved');
    expect(await prisma.ledgerEntry.count({ where: { saleId: sale.id, status: LedgerStatus.processing } })).toBe(1);
    expect(await prisma.payoutBatchItem.count({ where: { batchId: started.body.id } })).toBe(1);
  });

  it('MVP loop: approval -> payable -> processing batch -> settle -> CSV; void -> offset', async () => {
    const { tenant, chain, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    // Two sales: one will be paid, one will be voided.
    const s1 = await createSale(prisma, tenant.id, seller.id, 10_000_000n); // L0 = 500.000
    const s2 = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    const engine = new EngineService(prisma);
    await engine.approveSale(s1.id);
    await engine.approveSale(s2.id);
    for (const member of chain) {
      await seedReadyPayoutCompliance(prisma, tenant.id, member.id, owner.userId);
    }

    // Seller payable = 1,000,000 from L0 on two sales.
    let s = await summaryTotals(prisma, seller.id);
    expect(s.payable).toBe(1_000_000n);

    // Payable list: seller appears above the threshold.
    const payable = await request(app.getHttpServer())
      .get('/v1/admin/payouts/payable')
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    const sellerRow = payable.body.members.find((m: { membershipId: string }) => m.membershipId === seller.id);
    expect(sellerRow.netCents).toBe('1000000');

    await prisma.user.update({
      where: { id: seller.userId },
      data: { fullName: '\t=cmd', email: '+payee@example.test' },
    });

    // Legacy run is compatibility-only: it starts processing and cannot mark paid.
    const run = await startReviewedBatch(
      ownerTok,
      { mode: 'all_eligible', filters: { method: 'csv' } },
      'run',
    );
    expect(run.body.processingCount).toBeGreaterThanOrEqual(1);
    expect(run.body.id).toEqual(expect.any(String));
    const sellerProcessing = run.body.processing.find((p: { membershipId: string }) => p.membershipId === seller.id);
    expect(sellerProcessing.totalCents).toBe('1000000');

    // Seller summary: payable->processing; paid remains untouched until settlement evidence arrives.
    s = await summaryTotals(prisma, seller.id);
    expect(s.payable).toBe(0n);
    expect(s.processing).toBe(1_000_000n);
    expect(s.paid).toBe(0n);

    // Ledger rows are reserved, not paid, and remain linked to the processing payout.
    const processingEntries = await prisma.ledgerEntry.findMany({
      where: { beneficiaryMembershipId: seller.id, status: LedgerStatus.processing },
    });
    expect(processingEntries).toHaveLength(2);
    expect(processingEntries.every((e) => e.payoutId === sellerProcessing.payoutId)).toBe(true);

    // Batch CSV is scoped to its immutable processing set and neutralizes spreadsheet formula injection.
    const csv = await request(app.getHttpServer())
      .get(`/v1/admin/payouts/batches/${run.body.id}/export.csv`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(seller.referralCode);
    expect(csv.text).toContain('1000000');
    expect(csv.text).toContain(",'\t=cmd,'+payee@example.test,");

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${run.body.id}/settle`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ settlementReference: 'bank-run-1', settlementEvidence: 'bank-confirmation-1' })
      .expect(200);

    s = await summaryTotals(prisma, seller.id);
    expect(s.payable).toBe(0n);
    expect(s.processing).toBe(0n);
    expect(s.paid).toBe(1_000_000n);
    const paidEntries = await prisma.ledgerEntry.findMany({
      where: { beneficiaryMembershipId: seller.id, status: LedgerStatus.paid },
    });
    expect(paidEntries).toHaveLength(2);
    expect(paidEntries.every((e) => e.payoutId === sellerProcessing.payoutId)).toBe(true);

    // Historical paid export requires a bounded period.
    const paidCsv = await request(app.getHttpServer())
      .get(`/v1/admin/payouts/export.csv?period=${run.body.period}`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    expect(paidCsv.text).toContain('bank-run-1');

    // VOID: paid sale s2 is voided -> negative payable reversal for offset.
    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${s2.id}/void`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);

    s = await summaryTotals(prisma, seller.id);
    expect(s.payable).toBe(-500_000n); // Offset against future earnings.
    expect(s.paid).toBe(1_000_000n); // Actual paid amount does not change.

    // Seller wallet shows negative payable.
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(wallet.body.balance.payableCents).toBe('-500000');
    expect(wallet.body.balance.processingCents).toBe('0');
    expect(wallet.body.balance.paidCents).toBe('1000000');

    // A payout linked to a paid ledger row cannot be deleted (B3) - side verification.
    const someEntry = paidEntries[0];
    await expect(
      prisma.payout.delete({ where: { id: someEntry.payoutId as string } }),
    ).rejects.toThrow();

    void chain;
  });

  it('below-threshold balance is not paid (skipped: below_min)', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    // Small sale: L0 = $5, below the $1000 threshold.
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    // Payable list is empty below the threshold.
    const payable = await request(app.getHttpServer())
      .get('/v1/admin/payouts/payable')
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    expect(payable.body.members).toHaveLength(0);

    // Explicit all-eligible scope only considers threshold-eligible members, so dust
    // balances cannot consume the 100-member batch cap.
    const allEligible = await startReviewedBatch(ownerTok, {
      mode: 'all_eligible',
      filters: { method: 'manual' },
    });
    expect(allEligible.body).toMatchObject({ processingCount: 0, skippedCount: 0 });

    // Even when a specific member is requested, it is skipped.
    const run = await startReviewedBatch(
      ownerTok,
      { mode: 'selected', membershipIds: [seller.id] },
      'run',
    );
    expect(run.body.processingCount).toBe(0);
    expect(run.body.skipped[0].reason).toBe('below_min');
  });

  it('never creates a fake failed payout for below-minimum or negative payable balances', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);

    const started = await startReviewedBatch(ownerTok, { mode: 'selected', membershipIds: [seller.id] });
    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${started.body.id}/settle`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ settlementReference: 'paid-before-void', settlementEvidence: 'confirmed-before-void' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${sale.id}/void`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);

    expect(await summaryTotals(prisma, seller.id)).toMatchObject({ payable: -500_000n, processing: 0n, paid: 500_000n });
    await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(400);
    const skipped = await startReviewedBatch(ownerTok, { mode: 'selected', membershipIds: [seller.id] });
    expect(skipped.body).toMatchObject({ processingCount: 0, skippedCount: 1 });
    expect(skipped.body.skipped[0]).toMatchObject({ reason: 'below_min', netCents: '-500000' });
    expect(await prisma.payout.count({ where: { membershipId: seller.id, status: PayoutStatus.failed } })).toBe(0);
  });

  it('keeps duplicate member requests idempotent and batch CSV cents exact beyond Number precision', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const sale = await createSale(prisma, tenant.id, seller.id, 200_000_000_000_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);
    const seededRequest = await createRequestedPayout(tenant.id, seller.id, 10_000_000_000_000_000n);

    const requests = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post('/v1/app/payout-requests')
          .set('Authorization', `Bearer ${sellerTok}`)
          .send({}),
      ),
    );
    expect(requests.map((response) => response.status)).toEqual([200, 200]);
    expect(requests[0].body.id).toBe(requests[1].body.id);
    expect(requests[0].body.id).toBe(seededRequest.id);
    expect(requests[0].body.requestedCents).toBe('10000000000000000');
    expect(requests[0].body.payoutReadiness).toEqual(requests[1].body.payoutReadiness);
    expect(requests[0].body.payoutReadiness.checks.find((check: { key: string }) => check.key === 'open_request')).toMatchObject({
      status: 'blocked',
      reasonCode: 'payout_requested',
    });
    expect(await prisma.payout.count({ where: { membershipId: seller.id, status: PayoutStatus.requested } })).toBe(1);

    await prisma.user.update({
      where: { id: seller.userId },
      data: { fullName: '=huge', email: '+huge@example.test' },
    });

    const started = await startReviewedBatch(ownerTok, { mode: 'selected', membershipIds: [seller.id] });
    expect(started.body.processing[0].totalCents).toBe('10000000000000000');

    const csv = await request(app.getHttpServer())
      .get(`/v1/admin/payouts/batches/${started.body.id}/export.csv`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    await prisma.user.update({
      where: { id: seller.userId },
      data: { fullName: 'changed-after-processing', email: 'changed-after-processing@example.test' },
    });
    const repeatedCsv = await request(app.getHttpServer())
      .get(`/v1/admin/payouts/batches/${started.body.id}/export.csv`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    expect(csv.text).toBe(repeatedCsv.text);
    expect(csv.text).toContain('10000000000000000');
    expect(csv.text).toContain(",'=huge,'+huge@example.test,");
    expect((await prisma.payoutBatch.findUniqueOrThrow({ where: { id: started.body.id } })).csvChecksum).toEqual(expect.any(String));
  });

  it('bounds one processing batch to at most 100 memberships', async () => {
    const { tenant, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const membershipIds = Array.from(
      { length: 101 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );

    await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches/preview')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope: { mode: 'selected', membershipIds } })
      .expect(400);
  });

  it('refuses a batch CSV when recipient values lack a reservation-time snapshot marker', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);
    const started = await startReviewedBatch(ownerTok, { mode: 'selected', membershipIds: [seller.id] });

    await prisma.payoutBatchItem.updateMany({
      where: { batchId: started.body.id },
      data: { recipientSnapshotAt: null },
    });
    await request(app.getHttpServer())
      .get(`/v1/admin/payouts/batches/${started.body.id}/export.csv`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(409);
  });

  it('rejects an explicit all-eligible preview when more than 100 members are eligible', async () => {
    const { tenant, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const members: Array<typeof owner> = [];
    for (let index = 0; index < 101; index++) {
      const [member] = await createChain(prisma, tenant.id, 1);
      members.push(member);
    }
    await prisma.$transaction(async (tx) => {
      for (const member of members) {
        const sale = await tx.sale.create({
          data: {
            tenantId: tenant.id,
            sellerMembershipId: member.id,
            amountCents: 100_000n,
            status: SaleStatus.approved,
            saleDate: new Date(),
          },
        });
        await tx.ledgerEntry.create({
          data: {
            tenantId: tenant.id,
            saleId: sale.id,
            beneficiaryMembershipId: member.id,
            level: 0,
            rateBpsUsed: 10_000,
            amountCents: 100_000n,
            type: LedgerType.commission,
            status: LedgerStatus.payable,
          },
        });
      }
    });

    await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches/preview')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope: { mode: 'all_eligible', filters: { method: 'manual' } } })
      .expect(400);
    expect(await prisma.payoutBatch.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { tenantId: tenant.id, status: LedgerStatus.processing } })).toBe(0);
  });

  it('does not let zero-net payable members consume the explicit all-eligible cap when the minimum is zero', async () => {
    const { tenant, owner } = await scenario();
    await prisma.tenant.update({ where: { id: tenant.id }, data: { payoutMinCents: 0n } });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const members: Array<typeof owner> = [];
    for (let index = 0; index < 101; index++) {
      const [member] = await createChain(prisma, tenant.id, 1);
      members.push(member);
    }
    await prisma.$transaction(async (tx) => {
      for (const member of members) {
        const sale = await tx.sale.create({
          data: {
            tenantId: tenant.id,
            sellerMembershipId: member.id,
            amountCents: 1n,
            status: SaleStatus.approved,
            saleDate: new Date(),
          },
        });
        await tx.ledgerEntry.create({
          data: {
            tenantId: tenant.id,
            saleId: sale.id,
            beneficiaryMembershipId: member.id,
            level: 0,
            rateBpsUsed: 0,
            amountCents: 0n,
            type: LedgerType.commission,
            status: LedgerStatus.payable,
          },
        });
      }
    });

    const result = await startReviewedBatch(ownerTok, {
      mode: 'all_eligible',
      filters: { method: 'manual' },
    });
    expect(result.body).toMatchObject({ processingCount: 0, skippedCount: 0 });
  });

  it('evaluates email, balance, threshold, and open-request authorities at their boundaries', () => {
    const base: PayoutReadinessInput = {
      emailVerified: true,
      payableCents: 100n,
      threshold: { amountCents: 100n, currency: 'USD' },
      activePayout: null,
      mfa: { requirement: 'unknown' },
    };
    const check = (input: PayoutReadinessInput, key: ReadinessCheckKey) =>
      evaluatePayoutReadiness(input).checks.find((candidate) => candidate.key === key);

    expect(check({ ...base, emailVerified: false }, 'email')).toMatchObject({
      status: 'blocked',
      reasonCode: 'email_unverified',
      authority: 'user',
      remediation: null,
    });
    expect(check(base, 'email')).toMatchObject({ status: 'ready', reasonCode: 'email_verified' });

    for (const payableCents of [-1n, 0n]) {
      expect(check({ ...base, payableCents }, 'payable_balance')).toMatchObject({
        status: 'blocked',
        reasonCode: 'no_payable',
        authority: 'ledger',
      });
    }
    expect(check({ ...base, payableCents: 1n }, 'payable_balance')).toMatchObject({
      status: 'ready',
      reasonCode: 'payable_balance_available',
    });

    expect(check({ ...base, payableCents: 99n }, 'threshold')).toMatchObject({
      status: 'blocked',
      reasonCode: 'below_threshold',
    });
    for (const payableCents of [100n, 101n]) {
      expect(check({ ...base, payableCents }, 'threshold')).toMatchObject({ status: 'ready', reasonCode: 'threshold_met' });
    }

    expect(check({ ...base, activePayout: { id: 'requested-id', status: 'requested' } }, 'open_request')).toMatchObject({
      status: 'blocked',
      reasonCode: 'payout_requested',
      authority: 'payout',
    });
    expect(check({ ...base, activePayout: { id: 'processing-id', status: 'processing' } }, 'open_request')).toMatchObject({
      status: 'blocked',
      reasonCode: 'payout_processing',
      authority: 'payout',
    });
    expect(check(base, 'open_request')).toMatchObject({ status: 'ready', reasonCode: 'no_open_request' });
  });

  it('fails closed all missing manual payout reviews with deterministic compliance checks', () => {
    const readiness = evaluatePayoutReadiness({
      emailVerified: true,
      payableCents: 100n,
      threshold: { amountCents: 100n, currency: 'USD' },
      activePayout: null,
      mfa: { requirement: 'not-required' },
    });

    expect(readiness.checks.filter((check) => ['address', 'kyc', 'fraud', 'sanctions', 'payment_method'].includes(check.key))).toEqual([
      { key: 'address', status: 'blocked', reasonCode: 'review_required', owner: 'workspace-admin', remediation: null, recheck: { mode: 'manual' }, authority: 'compliance' },
      { key: 'kyc', status: 'blocked', reasonCode: 'review_required', owner: 'workspace-admin', remediation: null, recheck: { mode: 'manual' }, authority: 'compliance' },
      { key: 'fraud', status: 'blocked', reasonCode: 'review_required', owner: 'workspace-admin', remediation: null, recheck: { mode: 'manual' }, authority: 'compliance' },
      { key: 'sanctions', status: 'blocked', reasonCode: 'review_required', owner: 'workspace-admin', remediation: null, recheck: { mode: 'manual' }, authority: 'compliance' },
      { key: 'payment_method', status: 'blocked', reasonCode: 'review_required', owner: 'workspace-admin', remediation: null, recheck: { mode: 'manual' }, authority: 'compliance' },
    ]);
    expect(readiness.requestable).toBe(false);
  });

  it('makes fully approved manual reviews requestable while preserving core and MFA gates', () => {
    const keys = ['address', 'kyc', 'fraud', 'sanctions', 'payment_method'] as const;
    const manualChecks = keys.map((key) => ({
      key,
      status: 'ready' as const,
      reasonCode: `${key}_approved`,
      expiresAt: new Date('2100-01-01T00:00:00.000Z'),
      version: 1,
    }));
    const base = {
      emailVerified: true,
      payableCents: 100n,
      threshold: { amountCents: 100n, currency: 'USD' },
      activePayout: null,
      mfa: { requirement: 'not-required' as const },
      manualChecks,
      destination: { verifiedAt: new Date('2026-01-01T00:00:00.000Z'), version: 1 },
    };

    const ready = evaluatePayoutReadiness(base as PayoutReadinessInput);
    expect(ready.checks.filter((check) => keys.includes(check.key as (typeof keys)[number]))).toEqual(
      keys.map((key) => ({
        key,
        status: 'ready',
        reasonCode: `${key}_approved`,
        owner: 'workspace-admin',
        remediation: null,
        recheck: { mode: 'manual' },
        authority: 'compliance',
      })),
    );
    expect(ready.requestable).toBe(true);

    const blockedInputs = [
      { emailVerified: false },
      { payableCents: 0n },
      { threshold: { amountCents: 101n, currency: 'USD' } },
      { activePayout: { id: 'requested-id', status: 'requested' as const } },
      { mfa: { requirement: 'required' as const, assurance: 'missing' as const } },
    ];
    for (const override of blockedInputs) {
      expect(evaluatePayoutReadiness({ ...base, ...override } as PayoutReadinessInput).requestable).toBe(false);
    }
  });

  it('fails closed a ready manual control with a non-positive persisted version', () => {
    const keys = ['address', 'kyc', 'fraud', 'sanctions', 'payment_method'] as const;
    const readiness = evaluatePayoutReadiness({
      emailVerified: true,
      payableCents: 100n,
      threshold: { amountCents: 100n, currency: 'USD' },
      activePayout: null,
      mfa: { requirement: 'not-required' },
      manualChecks: keys.map((key) => ({
        key,
        status: 'ready',
        reasonCode: `${key}_approved`,
        expiresAt: new Date('2100-01-01T00:00:00.000Z'),
        version: key === 'address' ? 0 : 1,
      })),
      destination: { verifiedAt: new Date('2026-01-01T00:00:00.000Z'), version: 1 },
    });

    expect(readiness.requestable).toBe(false);
    expect(readiness.checks.find((check) => check.key === 'address')).toMatchObject({
      status: 'blocked',
      reasonCode: 'review_invalid',
    });
  });

  it('maps manual review status, expiry, controlled reasons, and payment destination fail-closed', () => {
    const base = {
      emailVerified: true,
      payableCents: 100n,
      threshold: { amountCents: 100n, currency: 'USD' },
      activePayout: null,
      mfa: { requirement: 'not-required' as const },
      destination: { verifiedAt: new Date('2026-01-01T00:00:00.000Z'), version: 1 },
    };
    const decision = (overrides: Record<string, unknown>) => ({
      key: 'address' as const,
      status: 'ready' as const,
      reasonCode: 'address_approved',
      expiresAt: new Date('2100-01-01T00:00:00.000Z'),
      version: 1,
      ...overrides,
    });
    const address = (manualChecks: readonly Record<string, unknown>[], overrides: Record<string, unknown> = {}) =>
      evaluatePayoutReadiness({ ...base, manualChecks, ...overrides } as PayoutReadinessInput).checks.find(
        (check) => check.key === 'address',
      );

    expect(address([decision({ status: 'ready', expiresAt: new Date('2000-01-01T00:00:00.000Z') })])).toMatchObject({
      status: 'blocked',
      reasonCode: 'review_expired',
    });
    expect(address([decision({ status: 'pending' })])).toMatchObject({ status: 'blocked', reasonCode: 'review_pending' });
    expect(address([decision({ status: 'blocked', reasonCode: 'document_mismatch' })])).toMatchObject({
      status: 'blocked',
      reasonCode: 'document_mismatch',
    });
    expect(address([decision({ status: 'blocked', reasonCode: '   ' })])).toMatchObject({
      status: 'blocked',
      reasonCode: 'review_blocked',
    });
    expect(address([decision({ reasonCode: '   ' })])).toMatchObject({ status: 'ready', reasonCode: 'review_approved' });

    const paymentDecision = decision({ key: 'payment_method' });
    const withoutDestination = evaluatePayoutReadiness({
      ...base,
      manualChecks: [paymentDecision],
      destination: null,
    } as PayoutReadinessInput);
    expect(withoutDestination.checks.find((check) => check.key === 'payment_method')).toMatchObject({
      status: 'blocked',
      reasonCode: 'payment_destination_required',
    });
  });

  it('fails closed duplicate manual decisions independent of input order', () => {
    const base = {
      emailVerified: true,
      payableCents: 100n,
      threshold: { amountCents: 100n, currency: 'USD' },
      activePayout: null,
      mfa: { requirement: 'not-required' as const },
    };
    const ready = {
      key: 'address' as const,
      status: 'ready' as const,
      reasonCode: 'address_approved',
      expiresAt: null,
      version: 1,
    };
    const blocked = { ...ready, status: 'blocked' as const, reasonCode: 'document_mismatch' };

    for (const manualChecks of [[ready, blocked], [blocked, ready]]) {
      expect(
        evaluatePayoutReadiness({ ...base, manualChecks } as PayoutReadinessInput).checks.find(
          (check) => check.key === 'address',
        ),
      ).toMatchObject({ status: 'blocked', reasonCode: 'review_conflict', authority: 'compliance' });
    }
  });

  it('captures one evaluation timestamp and treats expiry at that timestamp as expired', () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now.getTime());
    const keys = ['address', 'kyc', 'fraud', 'sanctions', 'payment_method'] as const;

    try {
      const readiness = evaluatePayoutReadiness({
        emailVerified: true,
        payableCents: 100n,
        threshold: { amountCents: 100n, currency: 'USD' },
        activePayout: null,
        mfa: { requirement: 'not-required' },
        manualChecks: keys.map((key) => ({
          key,
          status: 'ready',
          reasonCode: `${key}_approved`,
          expiresAt: now,
          version: 1,
        })),
        destination: { verifiedAt: now, version: 1 },
      });

      expect(readiness.checks.filter((check) => keys.includes(check.key as (typeof keys)[number]))).toEqual(
        keys.map((key) => expect.objectContaining({ key, status: 'blocked', reasonCode: 'review_expired' })),
      );
      expect(nowSpy).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('enforces unique manual readiness decisions and one active payout destination per member', async () => {
    const { tenant, seller, owner } = await scenario();
    const readinessPrisma = prisma as unknown as {
      payoutReadinessCheck: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
      payoutDestination: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
    };

    const readinessData = {
      tenantId: tenant.id,
      membershipId: seller.id,
      key: 'address',
      status: 'ready',
      reasonCode: 'address_approved',
      reviewedByUserId: owner.userId,
      reviewedAt: new Date(),
    };
    await readinessPrisma.payoutReadinessCheck.create({ data: readinessData });
    await expect(readinessPrisma.payoutReadinessCheck.create({ data: readinessData })).rejects.toMatchObject({ code: 'P2002' });

    const destinationData = {
      tenantId: tenant.id,
      membershipId: seller.id,
      providerReference: 'provider-destination-1',
      maskedLabel: 'Bank account ending 1234',
      last4: '1234',
      country: 'US',
      currency: 'USD',
      verifiedByUserId: owner.userId,
      verifiedAt: new Date(),
    };
    await readinessPrisma.payoutDestination.create({ data: destinationData });
    await expect(
      readinessPrisma.payoutDestination.create({
        data: { ...destinationData, providerReference: 'provider-destination-2', last4: '5678' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      readinessPrisma.payoutDestination.create({
        data: { ...destinationData, providerReference: 'provider-destination-history', active: false },
      }),
    ).resolves.toBeDefined();
  });

  it('rejects cross-tenant membership pairing for readiness decisions and payout destinations', async () => {
    const first = await scenario();
    const second = await scenario();

    const results = await Promise.allSettled([
      prisma.payoutReadinessCheck.create({
        data: {
          tenantId: first.tenant.id,
          membershipId: second.seller.id,
          key: 'address',
          status: 'ready',
          reasonCode: 'address_approved',
        },
      }),
      prisma.payoutDestination.create({
        data: {
          tenantId: first.tenant.id,
          membershipId: second.seller.id,
          providerReference: 'cross-tenant-destination',
          maskedLabel: 'Bank account ending 9999',
          last4: '9999',
          country: 'US',
          currency: 'USD',
        },
      }),
    ]);

    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'P2003' });
    }
  });

  it('keeps MFA policy and assurance states explicit without emitting client assurance timing', () => {
    const base: Omit<PayoutReadinessInput, 'mfa'> = {
      emailVerified: true,
      payableCents: 100n,
      threshold: { amountCents: 100n, currency: 'USD' },
      activePayout: null,
    };
    const cases: Array<{
      mfa: PayoutReadinessInput['mfa'];
      status: 'ready' | 'blocked' | 'unknown';
      reasonCode: string;
      owner: 'member' | 'system-policy';
    }> = [
      { mfa: { requirement: 'unknown' }, status: 'unknown', reasonCode: 'requirement_unknown', owner: 'system-policy' },
      { mfa: { requirement: 'not-required' }, status: 'ready', reasonCode: 'not_required', owner: 'system-policy' },
      { mfa: { requirement: 'required', assurance: 'current' }, status: 'ready', reasonCode: 'assurance_current', owner: 'member' },
      { mfa: { requirement: 'required', assurance: 'missing' }, status: 'blocked', reasonCode: 'assurance_missing', owner: 'member' },
      { mfa: { requirement: 'required', assurance: 'expired' }, status: 'blocked', reasonCode: 'assurance_expired', owner: 'member' },
      { mfa: { requirement: 'required', assurance: 'unknown' }, status: 'unknown', reasonCode: 'assurance_unknown', owner: 'system-policy' },
    ];

    for (const expected of cases) {
      const readiness = evaluatePayoutReadiness({ ...base, mfa: expected.mfa });
      expect(readiness.checks.find((check) => check.key === 'mfa')).toMatchObject({
        status: expected.status,
        reasonCode: expected.reasonCode,
        owner: expected.owner,
        authority: 'auth',
        remediation: null,
      });
      expect(JSON.stringify(readiness)).not.toMatch(/"(?:route|url|sessionUrl|expiresAt|assuranceTtl|ttl)"/i);
    }
  });

  it('returns isolated readiness values that cannot mutate a later evaluation', () => {
    const input: PayoutReadinessInput = {
      emailVerified: true,
      payableCents: 100n,
      threshold: { amountCents: 100n, currency: 'USD' },
      activePayout: null,
      mfa: { requirement: 'unknown' },
    };
    const first = evaluatePayoutReadiness(input);
    first.checks[0].recheck.mode = 'manual';

    const second = evaluatePayoutReadiness(input);
    expect(second.checks[0].recheck).toEqual({ mode: 'after-action' });
  });

  it('uses one fail-closed readiness contract for a core-ready wallet and member payout request', async () => {
    const { tenant, seller } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);

    expect(wallet.body.payoutReadiness).toEqual({
      requestable: false,
      checks: [
        { key: 'email', status: 'ready', reasonCode: 'email_verified', owner: 'member', remediation: null, recheck: { mode: 'after-action' }, authority: 'user' },
        { key: 'payable_balance', status: 'ready', reasonCode: 'payable_balance_available', owner: 'member', remediation: null, recheck: { mode: 'manual' }, authority: 'ledger' },
        { key: 'threshold', status: 'ready', reasonCode: 'threshold_met', owner: 'system-policy', remediation: null, recheck: { mode: 'manual' }, authority: 'ledger' },
        { key: 'open_request', status: 'ready', reasonCode: 'no_open_request', owner: 'member', remediation: null, recheck: { mode: 'manual' }, authority: 'payout' },
        { key: 'address', status: 'blocked', reasonCode: 'review_required', owner: 'workspace-admin', remediation: null, recheck: { mode: 'manual' }, authority: 'compliance' },
        { key: 'kyc', status: 'blocked', reasonCode: 'review_required', owner: 'workspace-admin', remediation: null, recheck: { mode: 'manual' }, authority: 'compliance' },
        { key: 'fraud', status: 'blocked', reasonCode: 'review_required', owner: 'workspace-admin', remediation: null, recheck: { mode: 'manual' }, authority: 'compliance' },
        { key: 'sanctions', status: 'blocked', reasonCode: 'review_required', owner: 'workspace-admin', remediation: null, recheck: { mode: 'manual' }, authority: 'compliance' },
        { key: 'payment_method', status: 'blocked', reasonCode: 'review_required', owner: 'workspace-admin', remediation: null, recheck: { mode: 'manual' }, authority: 'compliance' },
        { key: 'mfa', status: 'unknown', reasonCode: 'requirement_unknown', owner: 'system-policy', remediation: null, recheck: { mode: 'manual' }, authority: 'auth' },
      ],
      threshold: { amountCents: '100000', currency: 'USD' },
    });
    expect(wallet.body.payoutReadiness.checks.map((check: { key: string }) => check.key)).toEqual([
      'email',
      'payable_balance',
      'threshold',
      'open_request',
      'address',
      'kyc',
      'fraud',
      'sanctions',
      'payment_method',
      'mfa',
    ]);
    expect(new Set(wallet.body.payoutReadiness.checks.map((check: { key: string }) => check.key)).size).toBe(10);
    expect(wallet.body.payoutReadiness.checks.every((check: { remediation: unknown }) => check.remediation === null)).toBe(true);
    expect(JSON.stringify(wallet.body.payoutReadiness)).not.toMatch(/"(?:route|url|sessionUrl|expiresAt|assuranceTtl|ttl)"/i);

    const blocked = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(400);
    expect(blocked.body).toMatchObject({ message: 'payout_not_ready', code: 'payout_not_ready' });
    expect(blocked.body.payoutReadiness).toEqual(wallet.body.payoutReadiness);
    expect(await prisma.payout.count({ where: { tenantId: tenant.id, membershipId: seller.id } })).toBe(0);
  });

  it('uses the same persisted ready controls for wallet readiness and one member payout request', async () => {
    const { tenant, seller, owner } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);

    const wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(wallet.body.payoutReadiness.requestable).toBe(true);

    const payout = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(payout.body.payoutReadiness).toEqual(wallet.body.payoutReadiness);
    expect(await prisma.payout.count({ where: { tenantId: tenant.id, membershipId: seller.id } })).toBe(1);
  });

  it('enforces compliance for preview, legacy run, approve-request, and stores only a redacted snapshot', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await new EngineService(prisma).approveSale(sale.id);
    const scope = { mode: 'selected' as const, membershipIds: [seller.id] };

    const blockedPreview = await requestPreview(ownerTok, scope);
    expect(blockedPreview.body).toMatchObject({ eligibleCount: 0, excludedCount: 1, totals: [] });
    expect(await prisma.payoutBatch.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { beneficiaryMembershipId: seller.id, status: LedgerStatus.processing } })).toBe(0);

    const requested = await createRequestedPayout(tenant.id, seller.id, 500_000n);
    const blockedApproval = await request(app.getHttpServer())
      .post(`/v1/admin/payouts/${requested.id}/approve`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ method: 'manual' })
      .expect(200);
    expect(blockedApproval.body).toEqual({ processing: false, reason: 'payout_not_ready', netCents: '500000' });
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: requested.id } })).status).toBe(PayoutStatus.requested);

    const providerReference = 'provider-sentinel-must-never-persist-in-snapshot';
    const maskedLabel = 'bank-sentinel-must-never-persist-in-snapshot •••• 9876';
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId, {
      providerReference,
      maskedLabel,
      last4: '9876',
    });
    const started = await startReviewedBatch(ownerTok, scope, 'run');
    expect(started.body).toMatchObject({ status: 'processing', processingCount: 1 });
    const [stored] = await prisma.$queryRaw<Array<{ complianceSnapshot: unknown }>>`
      SELECT compliance_snapshot AS "complianceSnapshot"
      FROM payouts
      WHERE id = ${requested.id}::uuid`;
    expect(stored.complianceSnapshot).toEqual({
      format: 1,
      controls: ['address', 'kyc', 'fraud', 'sanctions', 'payment_method'].map((key) => ({
        key,
        status: 'ready',
        reasonCode: `${key}_approved`,
        expiresAt: '2100-01-01T00:00:00.000Z',
        version: 1,
      })),
      destination: {
        id: expect.any(String),
        verifiedAt: expect.any(String),
        version: 1,
      },
    });
    const forbidden = [providerReference, maskedLabel, '9876', seller.userId];
    const publicAndStored = JSON.stringify({ response: started.body, snapshot: stored.complianceSnapshot });
    for (const sentinel of forbidden) expect(publicAndStored).not.toContain(sentinel);
    expect(publicAndStored).not.toContain('providerReference');
    expect(publicAndStored).not.toContain('maskedLabel');
    expect(publicAndStored).not.toContain('last4');
    const audits = await prisma.auditLog.findMany({ where: { tenantId: tenant.id } });
    expect(JSON.stringify(audits)).not.toContain(providerReference);
  });

  it.each([
    ['ready control version changes', async (tenantId: string, membershipId: string) => {
      await prisma.payoutReadinessCheck.updateMany({
        where: { tenantId, membershipId, key: 'address' },
        data: { version: { increment: 1 } },
      });
    }],
    ['a control becomes blocked', async (tenantId: string, membershipId: string) => {
      await prisma.payoutReadinessCheck.updateMany({
        where: { tenantId, membershipId, key: 'kyc' },
        data: { status: 'blocked', reasonCode: 'kyc_blocked', version: { increment: 1 } },
      });
    }],
    ['a control expires', async (tenantId: string, membershipId: string) => {
      await prisma.payoutReadinessCheck.updateMany({
        where: { tenantId, membershipId, key: 'fraud' },
        data: { expiresAt: new Date('2000-01-01T00:00:00.000Z'), version: { increment: 1 } },
      });
    }],
    ['the destination is replaced', async (tenantId: string, membershipId: string) => {
      const current = await prisma.payoutDestination.findFirstOrThrow({ where: { tenantId, membershipId, active: true } });
      await prisma.payoutDestination.update({ where: { id: current.id }, data: { active: false } });
      await prisma.payoutDestination.create({
        data: {
          tenantId,
          membershipId,
          providerReference: 'replacement-provider-secret',
          maskedLabel: 'replacement masked secret',
          last4: '1111',
          country: 'US',
          currency: 'USD',
          verifiedAt: new Date(),
          version: current.version + 1,
          active: true,
        },
      });
    }],
  ])('settlement fails closed with no money/audit mutation when %s', async (_label, mutate) => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);
    const started = await startReviewedBatch(ownerTok, { mode: 'selected', membershipIds: [seller.id] });
    const payoutId = started.body.processing[0].payoutId as string;
    const beforeAuditCount = await prisma.auditLog.count({ where: { tenantId: tenant.id } });
    await mutate(tenant.id, seller.id);

    const response = await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${started.body.id}/settle`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ settlementReference: 'must-not-write', settlementEvidence: 'must-not-write' })
      .expect(409);
    expect(response.body).toMatchObject({
      message: 'payout_compliance_changed',
      code: 'payout_compliance_changed',
    });
    expect(await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } })).toMatchObject({
      status: PayoutStatus.processing,
      settlementReference: null,
      settlementEvidence: null,
    });
    expect(await prisma.payoutBatch.findUniqueOrThrow({ where: { id: started.body.id } })).toMatchObject({
      status: 'processing',
      settlementReference: null,
      settlementEvidence: null,
    });
    expect(await prisma.ledgerEntry.count({ where: { payoutId, status: LedgerStatus.processing } })).toBe(1);
    expect(await prisma.notification.count({ where: { recipientMembershipId: seller.id, template: 'payout_sent' } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id } })).toBe(beforeAuditCount);
  });

  it.each([
    ['missing', null],
    ['malformed', { format: 1, controls: [{ key: 'address' }], destination: { providerReference: 'secret' } }],
    ['empty controls', {
      format: 1,
      controls: [],
      destination: {
        id: '00000000-0000-4000-8000-000000000001',
        verifiedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
      },
    }],
    ['short controls', {
      format: 1,
      controls: [{
        key: 'address',
        status: 'ready',
        reasonCode: 'address_approved',
        expiresAt: '2100-01-01T00:00:00.000Z',
        version: 1,
      }],
      destination: {
        id: '00000000-0000-4000-8000-000000000001',
        verifiedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
      },
    }],
    ['null destination', {
      format: 1,
      controls: ['address', 'kyc', 'fraud', 'sanctions', 'payment_method'].map((key) => ({
        key,
        status: 'ready',
        reasonCode: `${key}_approved`,
        expiresAt: '2100-01-01T00:00:00.000Z',
        version: 1,
      })),
      destination: null,
    }],
  ])('legacy processing payout with %s snapshot requires controlled recheck without money mutation', async (_label, snapshot) => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);
    const started = await startReviewedBatch(ownerTok, { mode: 'selected', membershipIds: [seller.id] });
    const payoutId = started.body.processing[0].payoutId as string;
    await prisma.payout.update({
      where: { id: payoutId },
      data: { complianceSnapshot: snapshot === null ? Prisma.DbNull : snapshot },
    });

    const response = await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${started.body.id}/settle`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ settlementReference: 'must-not-write', settlementEvidence: 'must-not-write' })
      .expect(409);
    expect(response.body).toMatchObject({
      message: 'payout_compliance_recheck_required',
      code: 'payout_compliance_recheck_required',
    });
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } })).status).toBe(PayoutStatus.processing);
    expect((await prisma.payoutBatch.findUniqueOrThrow({ where: { id: started.body.id } })).status).toBe('processing');
    expect(await prisma.ledgerEntry.count({ where: { payoutId, status: LedgerStatus.processing } })).toBe(1);
  });

  it('fails closed direct engine reserve and settle calls without the compliance dependency', async () => {
    const { tenant, seller, owner } = await scenario();
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const direct = new EngineService(prisma);
    await direct.approveSale(sale.id);
    const period = monthKey(new Date(), tenant.timezone);
    await expect(
      direct.reservePayoutBatch({
        tenantId: tenant.id,
        scope: { mode: 'selected', membershipIds: [seller.id] },
        period,
        method: 'manual',
      }),
    ).rejects.toMatchObject({ status: 500 });
    expect(await prisma.payoutBatch.count({ where: { tenantId: tenant.id } })).toBe(0);

    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);
    const started = await engine.reservePayoutBatch({
      tenantId: tenant.id,
      scope: { mode: 'selected', membershipIds: [seller.id] },
      period,
      method: 'manual',
    });
    await expect(
      direct.settlePayoutBatch({
        tenantId: tenant.id,
        batchId: started.batchId!,
        settlementReference: 'direct-ref',
        settlementEvidence: 'direct-evidence',
      }),
    ).rejects.toMatchObject({ status: 500 });
    expect((await prisma.payoutBatch.findUniqueOrThrow({ where: { id: started.batchId! } })).status).toBe('processing');
  });

  it('reserve excludes malformed ready controls with version zero without processing money', async () => {
    const { tenant, seller } = await scenario();
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await new EngineService(prisma).approveSale(sale.id);
    const keys = ['address', 'kyc', 'fraud', 'sanctions', 'payment_method'] as const;
    const complianceInput = {
      manualChecks: keys.map((key) => ({
        key,
        status: 'ready' as const,
        reasonCode: `${key}_approved`,
        reviewedAt: new Date(),
        expiresAt: new Date('2100-01-01T00:00:00.000Z'),
        version: key === 'address' ? 0 : 1,
      })),
      destination: {
        id: '00000000-0000-4000-8000-000000000001',
        verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        version: 1,
      },
    };
    const malformedCompliance = {
      readInput: async () => complianceInput,
      buildSnapshot: () => ({ format: 1, controls: [], destination: null }),
    };
    const malformedEngine = new EngineService(prisma, malformedCompliance as never);

    const result = await malformedEngine.reservePayoutBatch({
      tenantId: tenant.id,
      scope: { mode: 'selected', membershipIds: [seller.id] },
      period: monthKey(new Date(), tenant.timezone),
      method: 'manual',
    });

    expect(result.processing).toEqual([]);
    expect(result.skipped).toEqual([{ membershipId: seller.id, reason: 'payout_not_ready', netCents: 500_000n }]);
    expect(await prisma.payoutBatch.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({
      where: { beneficiaryMembershipId: seller.id, status: LedgerStatus.payable },
    })).toBe(1);
  });

  it('serializes a compliance writer behind the shared engine membership critical-section lock', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);
    let locked!: () => void;
    let release!: () => void;
    const lockAcquired = new Promise<void>((resolve) => { locked = resolve; });
    const releaseLock = new Promise<void>((resolve) => { release = resolve; });
    const engineCriticalSection = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM memberships
        WHERE id = ${seller.id}::uuid
          AND tenant_id = ${tenant.id}::uuid
        FOR UPDATE`;
      locked();
      await releaseLock;
    });
    await lockAcquired;

    let writerSettled = false;
    const writer = request(app.getHttpServer())
      .put(`/v1/admin/payouts/members/${seller.id}/readiness/address`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ status: 'ready', reasonCode: 'address_reapproved', expectedVersion: 1 })
      .then((response) => {
        writerSettled = true;
        return response;
      });
    const waitDeadline = Date.now() + 5_000;
    let blockedWriterPid: number | null = null;
    while (blockedWriterPid === null && Date.now() < waitDeadline) {
      const blockedWriters = await prisma.$queryRaw<Array<{ pid: number }>>`
        SELECT pid
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND query ILIKE '%FROM memberships%'
          AND query ILIKE '%FOR UPDATE%'`;
      blockedWriterPid = blockedWriters[0]?.pid ?? null;
      if (blockedWriterPid === null) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(blockedWriterPid).not.toBeNull();
    expect(writerSettled).toBe(false);

    release();
    await engineCriticalSection;
    const response = await writer;
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ key: 'address', version: 2, reasonCode: 'address_reapproved' });
  });

  it('blocks new member requests for both core-ineligible and missing manual readiness', async () => {
    const { tenant, seller } = await scenario();
    await prisma.tenant.update({ where: { id: tenant.id }, data: { currency: 'EUR' } });
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });

    const belowWallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    const below = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(400);
    expect(below.body).toMatchObject({ message: 'payout_not_ready', code: 'payout_not_ready' });
    expect(below.body.payoutReadiness).toEqual(belowWallet.body.payoutReadiness);
    expect(below.body.payoutReadiness.threshold).toEqual({ amountCents: '100000', currency: 'EUR' });
    expect(below.body.payoutReadiness.checks.find((check: { key: string }) => check.key === 'payable_balance')).toMatchObject({
      status: 'blocked',
      reasonCode: 'no_payable',
    });

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const coreReadyWallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    const complianceBlocked = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(400);
    expect(complianceBlocked.body).toMatchObject({ message: 'payout_not_ready', code: 'payout_not_ready' });
    expect(complianceBlocked.body.payoutReadiness).toEqual(coreReadyWallet.body.payoutReadiness);
    expect(coreReadyWallet.body.payoutEligibility).toEqual({
      requestable: false,
      reason: 'readiness_unavailable',
      message: 'Additional payout readiness checks are unavailable.',
      activePayout: null,
    });
    expect(await prisma.payout.count({ where: { tenantId: tenant.id, membershipId: seller.id } })).toBe(0);

    const mine = await request(app.getHttpServer())
      .get('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(mine.body).toEqual([]);
  });

  it('admin approval only moves a requested payout into processing', async () => {
    const { tenant, seller, owner } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);

    const req1 = await createRequestedPayout(tenant.id, seller.id, 500_000n);

    const approved = await request(app.getHttpServer())
      .post(`/v1/admin/payouts/${req1.id}/approve`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ method: 'csv' })
      .expect(200);

    expect(approved.body).toMatchObject({ processing: true, payoutId: req1.id, totalCents: '500000' });
    expect(approved.body.batchId).toEqual(expect.any(String));
    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: req1.id } });
    expect(payout.status).toBe(PayoutStatus.processing);
    expect(payout.method).toBe('csv');
    expect(payout.paidAt).toBeNull();
    expect(await prisma.ledgerEntry.count({ where: { payoutId: req1.id, status: LedgerStatus.processing } })).toBe(1);

    // Idempotent member retry returns the active processing payout even though
    // there is no longer a payable ledger balance to recalculate.
    const retry = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(retry.body).toMatchObject({ id: req1.id, status: PayoutStatus.processing, requestedCents: '500000' });
    expect(retry.body.payoutReadiness.checks.find((check: { key: string }) => check.key === 'open_request')).toMatchObject({
      status: 'blocked',
      reasonCode: 'payout_processing',
    });
    expect(await prisma.payout.count({ where: { tenantId: tenant.id, membershipId: seller.id } })).toBe(1);
  });

  it('approve-request does not ignore a different processing payout for the same member and period', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);
    const requested = await createRequestedPayout(tenant.id, seller.id, 500_000n);
    const legacyProcessing = await prisma.payout.create({
      data: {
        tenantId: tenant.id,
        membershipId: seller.id,
        totalCents: 1n,
        method: 'manual',
        status: PayoutStatus.processing,
        period: requested.period,
        activeKey: null,
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/v1/admin/payouts/${requested.id}/approve`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ method: 'manual' })
      .expect(200);

    expect(response.body).toEqual({ processing: false, reason: 'already_processing', netCents: '0' });
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: requested.id } })).status).toBe(PayoutStatus.requested);
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: legacyProcessing.id } })).status).toBe(PayoutStatus.processing);
    expect(await prisma.payout.count({
      where: { tenantId: tenant.id, membershipId: seller.id, period: requested.period, status: PayoutStatus.processing },
    })).toBe(1);
    expect(await prisma.payoutBatch.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({
      where: { beneficiaryMembershipId: seller.id, status: LedgerStatus.payable },
    })).toBe(1);
  });

  it('wallet reports no-payable eligibility with the tenant payout minimum', async () => {
    const { tenant, seller } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });

    const wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);

    expect(wallet.body).toMatchObject({
      payoutMinCents: '100000',
      payoutEligibility: {
        requestable: false,
        reason: 'no_payable',
        message: 'No payable balance is available.',
        activePayout: null,
      },
    });
  });

  it('wallet reports below-threshold eligibility without creating a payout', async () => {
    const { tenant, seller } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);

    expect(wallet.body).toMatchObject({
      payoutMinCents: '100000',
      balance: { payableCents: '500' },
      payoutEligibility: {
        requestable: false,
        reason: 'below_threshold',
        message: 'Payable balance is below the payout minimum.',
        activePayout: null,
      },
    });
  });

  it('wallet preserves compatibility with readiness_unavailable when core financial checks are ready', async () => {
    const { tenant, seller } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);

    expect(wallet.body).toMatchObject({
      payoutMinCents: '100000',
      payoutEligibility: {
        requestable: false,
        reason: 'readiness_unavailable',
        message: 'Additional payout readiness checks are unavailable.',
        activePayout: null,
      },
    });
    expect(wallet.body.payoutReadiness).toMatchObject({
      requestable: false,
      threshold: { amountCents: '100000', currency: 'USD' },
    });
  });

  it('wallet reports unverified members as non-requestable even with an eligible balance', async () => {
    const { tenant, seller } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await prisma.user.update({ where: { id: seller.userId }, data: { emailVerifiedAt: null } });

    const wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);

    expect(wallet.body.payoutEligibility).toEqual({
      requestable: false,
      reason: 'email_unverified',
      message: 'Verify your email address before requesting a payout.',
      activePayout: null,
    });
  });

  it('wallet reports requested and processing payouts as non-requestable active states', async () => {
    const { tenant, seller, owner } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);

    const payoutRequest = await createRequestedPayout(tenant.id, seller.id, 500_000n);

    const requestedWallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(requestedWallet.body.payoutEligibility).toEqual({
      requestable: false,
      reason: 'requested',
      message: 'A payout request is already open.',
      activePayout: { id: payoutRequest.id, status: 'requested' },
    });
    const requestedReplay = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(requestedReplay.body.id).toBe(payoutRequest.id);
    expect(requestedReplay.body.payoutReadiness).toEqual(requestedWallet.body.payoutReadiness);

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/${payoutRequest.id}/approve`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ method: 'csv' })
      .expect(200);

    const processingWallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(processingWallet.body).toMatchObject({
      balance: { payableCents: '0', processingCents: '500000' },
      payoutEligibility: {
        requestable: false,
        reason: 'processing',
        message: 'A payout is already processing.',
        activePayout: { id: payoutRequest.id, status: 'processing' },
      },
    });
    const processingReplay = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(processingReplay.body.id).toBe(payoutRequest.id);
    expect(processingReplay.body.payoutReadiness).toEqual(processingWallet.body.payoutReadiness);
    expect(await prisma.payout.count({ where: { tenantId: tenant.id, membershipId: seller.id } })).toBe(1);
  });

  it('serializes a member request racing an admin processing start into one active payout', async () => {
    const { tenant, seller, owner } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);
    const seededRequest = await createRequestedPayout(tenant.id, seller.id, 500_000n);
    const scope = { mode: 'selected' as const, membershipIds: [seller.id] };
    const preview = await requestPreview(ownerTok, scope);

    const [memberRequest, batchStart] = await Promise.all([
      request(app.getHttpServer()).post('/v1/app/payout-requests').set('Authorization', `Bearer ${sellerTok}`),
      request(app.getHttpServer())
        .post('/v1/admin/payouts/batches')
        .set('Authorization', `Bearer ${ownerTok}`)
        .send({ scope, previewToken: preview.body.previewToken }),
    ]);
    expect([memberRequest.status, batchStart.status]).toEqual([200, 200]);
    expect(memberRequest.body.id).toBe(seededRequest.id);
    expect(batchStart.body).toMatchObject({ processingCount: 1 });
    const active = await prisma.payout.findMany({
      where: { tenantId: tenant.id, membershipId: seller.id, status: { in: [PayoutStatus.requested, PayoutStatus.processing] } },
    });
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe(PayoutStatus.processing);
    expect(await prisma.ledgerEntry.count({ where: { beneficiaryMembershipId: seller.id, status: LedgerStatus.processing } })).toBe(1);
  });

  it('admin can reject requested payout', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const req1 = await createRequestedPayout(tenant.id, seller.id, 500_000n);

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/${req1.id}/reject`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ reason: '   ' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/${req1.id}/reject`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ reason: 'missing bank details' })
      .expect(200);

    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: req1.id } });
    expect(payout.status).toBe(PayoutStatus.rejected);
    expect(payout.rejectionReason).toContain('missing bank details');
    expect(await prisma.ledgerEntry.count({ where: { beneficiaryMembershipId: seller.id, status: LedgerStatus.payable } })).toBe(1);
  });

  it('staff cannot view or run payouts (403)', async () => {
    const { tenant, chain } = await scenario();
    const staff = chain[2];
    await prisma.membership.update({ where: { id: staff.id }, data: { role: Role.tenant_staff } });
    const staffTok = token({ userId: staff.userId, membershipId: staff.id, tenantId: tenant.id, role: Role.tenant_staff });

    await request(app.getHttpServer())
      .get('/v1/admin/payouts/payable')
      .set('Authorization', `Bearer ${staffTok}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches/preview')
      .set('Authorization', `Bearer ${staffTok}`)
      .send({ scope: { mode: 'all_eligible', filters: { method: 'manual' } } })
      .expect(403);
    await request(app.getHttpServer())
      .post('/v1/admin/payouts/run')
      .set('Authorization', `Bearer ${staffTok}`)
      .send({})
      .expect(403);
  });

  it('adds a fail-closed canonical presentation to member and admin payout responses without leaking settlement data', async () => {
    const { tenant, seller, owner } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const payout = await createRequestedPayout(tenant.id, seller.id, 500_000n);
    await prisma.payout.update({
      where: { id: payout.id },
      data: { settlementReference: 'reference-must-not-leak', settlementEvidence: 'evidence-must-not-leak' },
    });

    const mine = await request(app.getHttpServer())
      .get('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(mine.body[0].presentation).toMatchObject({
      state: 'status-unavailable',
      authority: 'unavailable',
      method: null,
      attemptId: null,
      actions: { mutations: 'disabled', support: { kind: 'support', reasonCode: 'payout_status_unavailable' } },
    });
    expect(JSON.stringify(mine.body[0])).not.toContain('reference-must-not-leak');
    expect(JSON.stringify(mine.body[0])).not.toContain('evidence-must-not-leak');

    const admin = await request(app.getHttpServer())
      .get('/v1/admin/payouts')
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    expect(admin.body.items[0].presentation).toMatchObject({ state: 'status-unavailable', authority: 'unavailable' });
    expect(JSON.stringify(admin.body.items[0].presentation)).not.toContain('reference-must-not-leak');
    expect(JSON.stringify(admin.body.items[0].presentation)).not.toContain('evidence-must-not-leak');
  });

  it('projects exact requested and processing advisory candidates for a guard-rehydrated process-capable admin', async () => {
    const { tenant, seller, owner, chain } = await scenario();
    const processRole = await prisma.tenantRole.create({
      data: {
        tenantId: tenant.id,
        key: 'payout_process_context',
        name: 'Payout process context',
        permissions: ['payouts.process', 'payouts.view'],
      },
    });
    const processor = chain[1];
    await prisma.membership.update({
      where: { id: processor.id },
      data: { role: Role.tenant_admin, roleId: processRole.id },
    });
    const processorToken = token({
      userId: processor.userId,
      membershipId: processor.id,
      tenantId: tenant.id,
      role: Role.tenant_admin,
    });
    const ownerToken = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);
    const payout = await createRequestedPayout(tenant.id, seller.id, 500_000n);

    const requested = await request(app.getHttpServer())
      .get('/v1/admin/payouts')
      .set('Authorization', `Bearer ${processorToken}`)
      .expect(200);
    expect(requested.body.items.find((item: { id: string }) => item.id === payout.id).presentation.actionCandidates).toEqual({
      authority: 'active-tenant',
      mutations: ['approve-request', 'reject-request'],
    });

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/${payout.id}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ method: 'csv' })
      .expect(200);
    const processing = await request(app.getHttpServer())
      .get('/v1/admin/payouts')
      .set('Authorization', `Bearer ${processorToken}`)
      .expect(200);
    expect(processing.body.items.find((item: { id: string }) => item.id === payout.id).presentation.actionCandidates).toEqual({
      authority: 'active-tenant',
      mutations: ['settle-batch', 'fail-batch'],
    });
  });

  it('does not project candidates for a guard-rehydrated view-only custom admin', async () => {
    const { tenant, seller, chain } = await scenario();
    const viewRole = await prisma.tenantRole.create({
      data: {
        tenantId: tenant.id,
        key: 'payout_view_context',
        name: 'Payout view context',
        permissions: ['payouts.view'],
      },
    });
    const viewer = chain[1];
    await prisma.membership.update({
      where: { id: viewer.id },
      data: { role: Role.tenant_admin, roleId: viewRole.id },
    });
    const viewerToken = token({
      userId: viewer.userId,
      membershipId: viewer.id,
      tenantId: tenant.id,
      role: Role.tenant_admin,
    });
    const payout = await createRequestedPayout(tenant.id, seller.id, 500_000n);

    const listed = await request(app.getHttpServer())
      .get('/v1/admin/payouts')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(listed.body.items.find((item: { id: string }) => item.id === payout.id).presentation.actionCandidates).toEqual({
      authority: 'active-tenant',
      mutations: [],
    });
  });

  it('keeps member, terminal, and status-unavailable payout presentation candidates empty', async () => {
    const { tenant, seller, owner } = await scenario();
    const sellerToken = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const ownerToken = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const terminal = await createRequestedPayout(tenant.id, seller.id, 500_000n);
    await prisma.payout.update({
      where: { id: terminal.id },
      data: {
        status: PayoutStatus.rejected,
        activeKey: null,
        rejectedAt: new Date(),
        rejectionReason: 'rejected for test',
      },
    });
    const unavailable = await createRequestedPayout(tenant.id, seller.id, 500_001n);
    await prisma.payout.update({
      where: { id: unavailable.id },
      data: { settlementReference: 'must-not-be-actionable' },
    });

    const mine = await request(app.getHttpServer())
      .get('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    for (const item of mine.body) {
      expect(item.presentation.actionCandidates).toEqual({ authority: 'active-tenant', mutations: [] });
    }

    const admin = await request(app.getHttpServer())
      .get('/v1/admin/payouts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    for (const payout of [terminal, unavailable]) {
      expect(admin.body.items.find((item: { id: string }) => item.id === payout.id).presentation.actionCandidates).toEqual({
        authority: 'active-tenant',
        mutations: [],
      });
    }
  });
});
