import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PayoutReadinessCheck,
  PayoutReadinessCheckKey,
  PayoutReadinessDecisionStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { fraudPayoutBlock } from '../fraud/fraud.types';
import { kycPayoutBlock } from '../kyc/kyc.types';
import { normalizeName } from '../sanctions/sanctions.service';
import {
  PayoutComplianceDecisionInput,
  PayoutComplianceKeyInput,
  PayoutDestinationInput,
} from './payouts.types';
import { isValidPayoutReadinessVersion } from './payout-readiness';

export const PAYOUT_COMPLIANCE_CONTROL_KEYS: readonly PayoutReadinessCheckKey[] = [
  PayoutReadinessCheckKey.address,
  PayoutReadinessCheckKey.kyc,
  PayoutReadinessCheckKey.fraud,
  PayoutReadinessCheckKey.sanctions,
  PayoutReadinessCheckKey.payment_method,
];

export interface PayoutComplianceActor {
  userId: string;
  tenantId: string;
  membershipId: string;
}

type Transaction = Prisma.TransactionClient;
type ComplianceClient = PrismaService | Transaction;

type SafeStoredControl = {
  key: PayoutReadinessCheckKey;
  status: PayoutReadinessDecisionStatus;
  reasonCode: string;
  reviewedAt: Date | null;
  expiresAt: Date | null;
  version: number;
};

type SafeStoredDestination = {
  id: string;
  verifiedAt: Date | null;
  version: number;
};

export type PayoutComplianceReadinessInput = {
  manualChecks: SafeStoredControl[];
  destination: SafeStoredDestination | null;
};

export type PayoutComplianceSnapshot = {
  format: 1;
  controls: Array<{
    key: PayoutReadinessCheckKey;
    status: PayoutReadinessDecisionStatus;
    reasonCode: string;
    expiresAt: string | null;
    version: number;
  }>;
  destination: { id: string; verifiedAt: string; version: number } | null;
};

export type PayoutComplianceRecheck = 'ready' | 'changed' | 'recheck_required';

@Injectable()
export class PayoutComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getReadiness(actor: PayoutComplianceActor, membershipId: string) {
    this.assertActor(actor);
    await this.requireTarget(this.prisma, actor.tenantId, membershipId);
    const input = await this.readInput(this.prisma, actor.tenantId, membershipId);
    const storedControls = input.manualChecks;
    const byKey = new Map(storedControls.map((control) => [control.key, control]));
    return {
      membershipId,
      controls: PAYOUT_COMPLIANCE_CONTROL_KEYS.map((key) => {
        const control = byKey.get(key);
        return control
          ? this.safeControl(control)
          : {
              key,
              status: PayoutReadinessDecisionStatus.pending,
              reasonCode: 'review_required',
              reviewedAt: null,
              expiresAt: null,
              version: 0,
            };
      }),
      activeDestination: input.destination
        ? await this.safeDestinationForResponse(actor.tenantId, membershipId, input.destination.id)
        : null,
    };
  }

  async lockMembership(tx: Transaction, tenantId: string, membershipId: string): Promise<void> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM memberships
      WHERE id = ${membershipId}::uuid
        AND tenant_id = ${tenantId}::uuid
      FOR UPDATE`;
    if (locked.length !== 1) throw new NotFoundException('membership was not found in this business');
  }

  async readInput(client: ComplianceClient, tenantId: string, membershipId: string): Promise<PayoutComplianceReadinessInput> {
    const [manualChecks, destination] = await Promise.all([
      client.payoutReadinessCheck.findMany({
        where: { tenantId, membershipId },
        orderBy: { key: 'asc' },
        select: {
          key: true,
          status: true,
          reasonCode: true,
          reviewedAt: true,
          expiresAt: true,
          version: true,
        },
      }),
      client.payoutDestination.findFirst({
        where: { tenantId, membershipId, active: true },
        orderBy: [{ version: 'desc' }, { id: 'asc' }],
        select: { id: true, verifiedAt: true, version: true },
      }),
    ]);
    const byKey = new Map(manualChecks.map((control) => [control.key, control]));
    return {
      manualChecks: PAYOUT_COMPLIANCE_CONTROL_KEYS.flatMap((key) => {
        const control = byKey.get(key);
        return control ? [control] : [];
      }),
      destination,
    };
  }

  /**
   * Manual decisions are necessary but cannot make a newly detected fraud or sanctions hit safe.
   * This recheck is deliberately transaction-friendly so request, reservation, and settlement can
   * all fail closed against the most recent risk state.
   */
  async runtimePayoutBlock(
    client: ComplianceClient,
    tenantId: string,
    membershipId: string,
  ): Promise<string | null> {
    const [tenant, membership, fraudFlag, payoutProfile] = await Promise.all([
      client.tenant.findUnique({
        where: { id: tenantId },
        select: { requireKycForPayout: true },
      }),
      client.membership.findFirst({
        where: { id: membershipId, tenantId },
        select: { user: { select: { fullName: true } } },
      }),
      client.fraudFlag.findUnique({
        where: { membershipId },
        select: { status: true, score: true },
      }),
      client.payoutProfile.findUnique({
        where: { membershipId },
        select: { legalName: true, sanctionsHit: true, status: true, lastChangedAt: true },
      }),
    ]);

    if (!tenant || !membership) return 'payout recipient is no longer available';

    const fraudBlock = fraudPayoutBlock(fraudFlag);
    if (fraudBlock) return fraudBlock;

    if (tenant.requireKycForPayout) {
      const kycBlock = kycPayoutBlock(payoutProfile);
      if (kycBlock) return kycBlock;
    }

    if (payoutProfile?.sanctionsHit) return 'sanctions match — compliance review required';
    const names = [...new Set([payoutProfile?.legalName, membership.user.fullName].filter(Boolean))] as string[];
    if (names.length === 0) return null;

    const entries = await client.sanctionsEntry.findMany({ select: { normalizedName: true } });
    const hit = names.some((name) => {
      const tokens = new Set(normalizeName(name).split(' ').filter(Boolean));
      return entries.some((entry) => {
        const entryTokens = entry.normalizedName.split(' ').filter(Boolean);
        return entryTokens.length > 0 && entryTokens.every((token) => tokens.has(token));
      });
    });
    return hit ? 'sanctions match — compliance review required' : null;
  }

  isReady(input: PayoutComplianceReadinessInput, evaluatedAt = new Date()): boolean {
    const decisions = new Map(input.manualChecks.map((control) => [control.key, control]));
    if (decisions.size !== PAYOUT_COMPLIANCE_CONTROL_KEYS.length) return false;
    if (
      PAYOUT_COMPLIANCE_CONTROL_KEYS.some((key) => {
        const control = decisions.get(key);
        return (
          !control ||
          control.status !== PayoutReadinessDecisionStatus.ready ||
          !isValidPayoutReadinessVersion(control.version) ||
          (control.expiresAt !== null && control.expiresAt.getTime() <= evaluatedAt.getTime())
        );
      })
    ) {
      return false;
    }
    return Boolean(
      input.destination?.verifiedAt && isValidPayoutReadinessVersion(input.destination.version),
    );
  }

  buildSnapshot(input: PayoutComplianceReadinessInput): PayoutComplianceSnapshot {
    return {
      format: 1,
      controls: input.manualChecks.map((control) => ({
        key: control.key,
        status: control.status,
        reasonCode: control.reasonCode,
        expiresAt: control.expiresAt?.toISOString() ?? null,
        version: control.version,
      })),
      destination:
        input.destination?.verifiedAt
          ? {
              id: input.destination.id,
              verifiedAt: input.destination.verifiedAt.toISOString(),
              version: input.destination.version,
            }
          : null,
    };
  }

  recheckSnapshot(stored: Prisma.JsonValue | null, current: PayoutComplianceReadinessInput): PayoutComplianceRecheck {
    const parsed = this.parseSnapshot(stored);
    if (!parsed) return 'recheck_required';
    if (!this.isReady(current)) return 'changed';
    return JSON.stringify(parsed) === JSON.stringify(this.buildSnapshot(current)) ? 'ready' : 'changed';
  }

  async decide(
    actor: PayoutComplianceActor,
    membershipId: string,
    key: PayoutComplianceKeyInput,
    input: PayoutComplianceDecisionInput,
  ) {
    this.assertWritableTarget(actor, membershipId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockMembership(tx, actor.tenantId, membershipId);
        const reviewedAt = new Date();
        const expiresAt = input.expiresAt == null ? null : new Date(input.expiresAt);
        let control: PayoutReadinessCheck;
        if (input.expectedVersion === 0) {
          control = await tx.payoutReadinessCheck.create({
            data: {
              tenantId: actor.tenantId,
              membershipId,
              key,
              status: input.status,
              reasonCode: input.reasonCode,
              reviewedByUserId: actor.userId,
              reviewedAt,
              expiresAt,
              version: 1,
            },
          });
        } else {
          const updated = await tx.payoutReadinessCheck.updateMany({
            where: {
              tenantId: actor.tenantId,
              membershipId,
              key,
              version: input.expectedVersion,
            },
            data: {
              status: input.status,
              reasonCode: input.reasonCode,
              reviewedByUserId: actor.userId,
              reviewedAt,
              expiresAt,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) throw new ConflictException('payout compliance version changed');
          control = await tx.payoutReadinessCheck.findFirstOrThrow({
            where: { tenantId: actor.tenantId, membershipId, key },
          });
        }
        const safe = this.safeControl(control, membershipId);
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            actorUserId: actor.userId,
            action: 'payout_compliance.readiness_decided',
            entity: 'payout_readiness_check',
            entityId: membershipId,
            after: {
              membershipId,
              key: safe.key,
              status: safe.status,
              reasonCode: safe.reasonCode,
              version: safe.version,
              expiresAt: safe.expiresAt,
            },
          },
        });
        return safe;
      });
    } catch (error) {
      this.rethrowVersionConflict(error);
    }
  }

  async replaceDestination(
    actor: PayoutComplianceActor,
    membershipId: string,
    input: PayoutDestinationInput,
  ) {
    this.assertWritableTarget(actor, membershipId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockMembership(tx, actor.tenantId, membershipId);
        if (input.expectedVersion === 0) {
          const current = await tx.payoutDestination.findFirst({
            where: { tenantId: actor.tenantId, membershipId, active: true },
            select: { id: true },
          });
          if (current) throw new ConflictException('payout destination version changed');
        } else {
          const deactivated = await tx.payoutDestination.updateMany({
            where: {
              tenantId: actor.tenantId,
              membershipId,
              active: true,
              version: input.expectedVersion,
            },
            data: { active: false },
          });
          if (deactivated.count !== 1) throw new ConflictException('payout destination version changed');
        }
        const destination = await tx.payoutDestination.create({
          data: {
            tenantId: actor.tenantId,
            membershipId,
            providerReference: input.providerReference,
            maskedLabel: this.destinationDisplayLabel(input.currency, input.last4),
            last4: input.last4 ?? null,
            country: input.country,
            currency: input.currency,
            verifiedByUserId: actor.userId,
            verifiedAt: new Date(input.verifiedAt),
            version: input.expectedVersion + 1,
            active: true,
          },
        });
        const safe = this.safeDestination(destination);
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            actorUserId: actor.userId,
            action: 'payout_compliance.destination_replaced',
            entity: 'payout_destination',
            entityId: membershipId,
            after: {
              membershipId,
              maskedLabel: safe.maskedLabel,
              last4: safe.last4,
              country: safe.country,
              currency: safe.currency,
              verifiedAt: safe.verifiedAt,
              version: safe.version,
            },
          },
        });
        return safe;
      });
    } catch (error) {
      this.rethrowVersionConflict(error);
    }
  }

  private assertActor(actor: PayoutComplianceActor): void {
    this.tenantContext.assertTenant(actor.tenantId);
    this.tenantContext.assertMembership(actor.membershipId);
  }

  private assertWritableTarget(actor: PayoutComplianceActor, membershipId: string): void {
    this.assertActor(actor);
    if (actor.membershipId === membershipId) {
      throw new ForbiddenException('reviewers cannot approve their own payout compliance');
    }
  }

  private async requireTarget(
    prisma: PrismaService | Transaction,
    tenantId: string,
    membershipId: string,
  ): Promise<void> {
    const target = await prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('membership was not found in this business');
  }

  private safeControl(control: SafeStoredControl, membershipId?: string) {
    return {
      ...(membershipId ? { membershipId } : {}),
      key: control.key,
      status: control.status,
      reasonCode: control.reasonCode,
      reviewedAt: control.reviewedAt?.toISOString() ?? null,
      expiresAt: control.expiresAt?.toISOString() ?? null,
      version: control.version,
    };
  }

  private safeDestination(destination: {
    id: string;
    maskedLabel: string;
    last4: string | null;
    country: string;
    currency: string;
    verifiedAt: Date | null;
    version: number;
  }) {
    return {
      id: destination.id,
      maskedLabel: destination.maskedLabel,
      last4: destination.last4,
      country: destination.country,
      currency: destination.currency,
      verifiedAt: destination.verifiedAt?.toISOString() ?? null,
      version: destination.version,
    };
  }

  private async safeDestinationForResponse(tenantId: string, membershipId: string, id: string) {
    const destination = await this.prisma.payoutDestination.findFirstOrThrow({
      where: { id, tenantId, membershipId, active: true },
      select: {
        id: true,
        maskedLabel: true,
        last4: true,
        country: true,
        currency: true,
        verifiedAt: true,
        version: true,
      },
    });
    return this.safeDestination(destination);
  }

  private parseSnapshot(value: Prisma.JsonValue | null): PayoutComplianceSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const root = value as Record<string, Prisma.JsonValue>;
    if (
      !this.hasExactKeys(root, ['format', 'controls', 'destination']) ||
      root.format !== 1 ||
      !Array.isArray(root.controls) ||
      root.controls.length !== PAYOUT_COMPLIANCE_CONTROL_KEYS.length
    ) {
      return null;
    }
    const controls: PayoutComplianceSnapshot['controls'] = [];
    for (const [index, candidate] of root.controls.entries()) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
      const control = candidate as Record<string, Prisma.JsonValue>;
      if (!this.hasExactKeys(control, ['key', 'status', 'reasonCode', 'expiresAt', 'version'])) return null;
      const expectedKey = PAYOUT_COMPLIANCE_CONTROL_KEYS[index];
      if (
        control.key !== expectedKey ||
        !Object.values(PayoutReadinessDecisionStatus).includes(control.status as PayoutReadinessDecisionStatus) ||
        typeof control.reasonCode !== 'string' ||
        typeof control.version !== 'number' ||
        !isValidPayoutReadinessVersion(control.version) ||
        !this.isCanonicalIsoOrNull(control.expiresAt)
      ) {
        return null;
      }
      controls.push({
        key: control.key as PayoutReadinessCheckKey,
        status: control.status as PayoutReadinessDecisionStatus,
        reasonCode: control.reasonCode,
        expiresAt: control.expiresAt as string | null,
        version: control.version as number,
      });
    }
    if (!root.destination || typeof root.destination !== 'object' || Array.isArray(root.destination)) return null;
    const destination = root.destination as Record<string, Prisma.JsonValue>;
    if (
      !this.hasExactKeys(destination, ['id', 'verifiedAt', 'version']) ||
      typeof destination.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(destination.id) ||
      typeof destination.verifiedAt !== 'string' ||
      !this.isCanonicalIsoOrNull(destination.verifiedAt) ||
      typeof destination.version !== 'number' ||
      !isValidPayoutReadinessVersion(destination.version)
    ) {
      return null;
    }
    return {
      format: 1,
      controls,
      destination: {
        id: destination.id,
        verifiedAt: destination.verifiedAt,
        version: destination.version as number,
      },
    };
  }

  private hasExactKeys(value: Record<string, Prisma.JsonValue>, keys: readonly string[]): boolean {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
  }

  private isCanonicalIsoOrNull(value: Prisma.JsonValue): boolean {
    if (value === null) return true;
    if (typeof value !== 'string') return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
  }

  private destinationDisplayLabel(currency: string, last4?: string | null): string {
    return last4 ? `${currency} payout destination •••• ${last4}` : `${currency} payout destination`;
  }

  private rethrowVersionConflict(error: unknown): never {
    if (error instanceof ConflictException) throw error;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2002' || error.code === 'P2034')
    ) {
      throw new ConflictException('payout compliance version changed');
    }
    throw error;
  }
}
