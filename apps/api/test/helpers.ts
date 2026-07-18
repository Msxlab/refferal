import {
  CommissionPlan,
  MaturationRule,
  Membership,
  PrismaClient,
  Sale,
  SaleStatus,
  Tenant,
} from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { DEFAULT_LEVEL_RATES_BPS, DEFAULT_POOL_RATE_BPS } from '@refearn/shared';
import { assertPrismaTargetsConfiguredTestDatabase } from './test-database-guard';

let seq = 0;
const next = () => ++seq;

const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
/** Dogrulanmis bir platform_admin kullanicisi olusturur (login icin gercek sifre hash'i). */
export async function createPlatformAdmin(
  prisma: PrismaClient, password: string, email = `platform-${next()}@test.refearn.local`,
): Promise<{ id: string; email: string }> {
  const user = await prisma.user.create({
    data: { email, passwordHash: await hash(password, ARGON2), fullName: 'Test Platform', isPlatformAdmin: true, emailVerifiedAt: new Date() },
    select: { id: true, email: true },
  });
  return user;
}

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await assertPrismaTargetsConfiguredTestDatabase(prisma);
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_logs, notifications, devices, refresh_tokens, user_tokens, payout_settlement_batch_items,
      payout_settlement_batches, payouts,
      monthly_summaries, team_stats, ledger_entries, sales, commission_plan_levels,
      commission_plans, invites, memberships, users, tenants
    CASCADE`);
}

export async function createTenant(
  prisma: PrismaClient,
  overrides: Partial<{
    maturationRule: MaturationRule;
    maturationDays: number;
    timezone: string;
  }> = {},
): Promise<Tenant> {
  await assertPrismaTargetsConfiguredTestDatabase(prisma);
  const n = next();
  return prisma.tenant.create({
    data: {
      slug: `tenant-${n}`,
      name: `Tenant ${n}`,
      maturationRule: overrides.maturationRule ?? MaturationRule.on_approval,
      maturationDays: overrides.maturationDays,
      timezone: overrides.timezone ?? 'America/New_York',
    },
  });
}

export async function createPlan(
  prisma: PrismaClient,
  tenantId: string,
  opts: Partial<{
    poolRateBps: number;
    rates: number[];
    effectiveFrom: Date;
    name: string;
    version: number;
    fastStartBps: number;
    fastStartDays: number;
    matchingBps: number;
  }> = {},
): Promise<CommissionPlan> {
  await assertPrismaTargetsConfiguredTestDatabase(prisma);
  const rates = opts.rates ?? [...DEFAULT_LEVEL_RATES_BPS];
  const latest = await prisma.commissionPlan.aggregate({
    where: { tenantId },
    _max: { version: true },
  });
  return prisma.$transaction(async (tx) => {
    const plan = await tx.commissionPlan.create({
      data: {
        tenantId,
        version: opts.version ?? (latest._max.version ?? 0) + 1,
        finalized: false,
        name: opts.name ?? `Plan ${next()}`,
        poolRateBps: opts.poolRateBps ?? DEFAULT_POOL_RATE_BPS,
        depth: rates.length,
        fastStartBps: opts.fastStartBps ?? 0,
        fastStartDays: opts.fastStartDays ?? 0,
        matchingBps: opts.matchingBps ?? 0,
        effectiveFrom: opts.effectiveFrom ?? new Date('2026-01-01T00:00:00Z'),
        levels: { create: rates.map((rateBps, level) => ({ level, rateBps })) },
      },
    });
    return tx.commissionPlan.update({ where: { id: plan.id }, data: { finalized: true } });
  });
}

/**
 * Creates an n-member chain: [root, child, grandchild, ...] - chain[i].sponsor = chain[i-1].
 * If sponsorUnder is provided, the root is attached under that sponsor.
 */
export async function createChain(
  prisma: PrismaClient,
  tenantId: string,
  n: number,
  sponsorUnder?: Membership,
): Promise<Membership[]> {
  await assertPrismaTargetsConfiguredTestDatabase(prisma);
  const chain: Membership[] = [];
  let parent: Membership | undefined = sponsorUnder;
  for (let i = 0; i < n; i++) {
    const k = next();
    const user = await prisma.user.create({
      data: {
        email: `user-${k}@test.refearn.local`,
        passwordHash: 'test-only',
        fullName: `User ${k}`,
        emailVerifiedAt: new Date(), // Test members count as verified for the payout gate.
      },
    });
    const member: Membership = await prisma.membership.create({
      data: {
        tenantId,
        userId: user.id,
        sponsorMembershipId: parent?.id ?? null,
        referralCode: `RC${k}`,
        depth: parent ? parent.depth + 1 : 0,
        path: '', // path asagida kendi id'siyle guncellenir (ltree-uyumlu format)
        // test uyeleri tam posta adresli sayilir (Faz A2 cek-odeme kapisi) — emailVerifiedAt gibi
        mailingName: `User ${k}`,
        mailingLine1: '1 Test St',
        mailingCity: 'Austin',
        mailingState: 'TX',
        mailingPostal: '73301',
        mailingCountry: 'US',
      },
    });
    const ownLabel = member.id.replace(/-/g, '_');
    const path = parent ? `${parent.path}.${ownLabel}` : ownLabel;
    const updated = await prisma.membership.update({ where: { id: member.id }, data: { path } });
    chain.push(updated);
    parent = updated;
  }
  return chain;
}

export async function createSale(
  prisma: PrismaClient,
  tenantId: string,
  sellerMembershipId: string,
  amountCents: bigint,
  opts: Partial<{ saleDate: Date; status: SaleStatus }> = {},
): Promise<Sale> {
  await assertPrismaTargetsConfiguredTestDatabase(prisma);
  return prisma.sale.create({
    data: {
      tenantId,
      sellerMembershipId,
      amountCents,
      saleDate: opts.saleDate ?? new Date(),
      status: opts.status ?? SaleStatus.draft,
    },
  });
}

/** Explicitly seeds the five approved manual controls and one verified destination for payout-flow tests. */
export async function seedReadyPayoutCompliance(
  prisma: PrismaClient,
  tenantId: string,
  membershipId: string,
  reviewedByUserId: string,
  overrides: Partial<{
    providerReference: string;
    maskedLabel: string;
    last4: string;
    expiresAt: Date | null;
  }> = {},
): Promise<void> {
  await assertPrismaTargetsConfiguredTestDatabase(prisma);
  const reviewedAt = new Date();
  await prisma.payoutReadinessCheck.createMany({
    data: ['address', 'kyc', 'fraud', 'sanctions', 'payment_method'].map((key) => ({
      tenantId,
      membershipId,
      key: key as 'address' | 'kyc' | 'fraud' | 'sanctions' | 'payment_method',
      status: 'ready' as const,
      reasonCode: `${key}_approved`,
      reviewedByUserId,
      reviewedAt,
      expiresAt: overrides.expiresAt ?? new Date('2100-01-01T00:00:00.000Z'),
      version: 1,
    })),
  });
  await prisma.payoutDestination.create({
    data: {
      tenantId,
      membershipId,
      providerReference: overrides.providerReference ?? 'test-provider-reference',
      maskedLabel: overrides.maskedLabel ?? 'USD payout destination •••• 4242',
      last4: overrides.last4 ?? '4242',
      country: 'US',
      currency: 'USD',
      verifiedByUserId: reviewedByUserId,
      verifiedAt: reviewedAt,
      version: 1,
      active: true,
    },
  });
}

/** Bir uyenin tum ledger satirlarinin net toplami (commission + reversal + adjustment). */
export async function netLedger(prisma: PrismaClient, membershipId: string): Promise<bigint> {
  const entries = await prisma.ledgerEntry.findMany({ where: { beneficiaryMembershipId: membershipId } });
  return entries.reduce((acc, e) => acc + e.amountCents, 0n);
}

/** Bir uyenin summary bucket toplamlari (tum aylar/seviyeler). */
export async function summaryTotals(
  prisma: PrismaClient,
  membershipId: string,
): Promise<{ pending: bigint; payable: bigint; processing: bigint; paid: bigint }> {
  const rows = await prisma.monthlySummary.findMany({ where: { membershipId } });
  return rows.reduce(
    (acc, r) => ({
      pending: acc.pending + r.pendingCents,
      payable: acc.payable + r.payableCents,
      processing: acc.processing + r.processingCents,
      paid: acc.paid + r.paidCents,
    }),
    { pending: 0n, payable: 0n, processing: 0n, paid: 0n },
  );
}
