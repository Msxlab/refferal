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
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_logs, notifications, devices, refresh_tokens, user_tokens, payouts,
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
  }> = {},
): Promise<CommissionPlan> {
  const rates = opts.rates ?? [...DEFAULT_LEVEL_RATES_BPS];
  return prisma.commissionPlan.create({
    data: {
      tenantId,
      name: opts.name ?? `Plan ${next()}`,
      poolRateBps: opts.poolRateBps ?? DEFAULT_POOL_RATE_BPS,
      depth: rates.length,
      effectiveFrom: opts.effectiveFrom ?? new Date('2026-01-01T00:00:00Z'),
      levels: { create: rates.map((rateBps, level) => ({ level, rateBps })) },
    },
  });
}

/**
 * n uyelik zinciri olusturur: [kok, cocuk, torun, ...] — chain[i].sponsor = chain[i-1].
 * sponsorUnder verilirse kok onun altina baglanir.
 */
export async function createChain(
  prisma: PrismaClient,
  tenantId: string,
  n: number,
  sponsorUnder?: Membership,
): Promise<Membership[]> {
  const chain: Membership[] = [];
  let parent: Membership | undefined = sponsorUnder;
  for (let i = 0; i < n; i++) {
    const k = next();
    const user = await prisma.user.create({
      data: {
        email: `user-${k}@test.refearn.local`,
        passwordHash: 'test-only',
        fullName: `User ${k}`,
        emailVerifiedAt: new Date(), // test uyeleri dogrulanmis sayilir (payout kapisi)
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

/** Bir uyenin tum ledger satirlarinin net toplami (commission + reversal + adjustment). */
export async function netLedger(prisma: PrismaClient, membershipId: string): Promise<bigint> {
  const entries = await prisma.ledgerEntry.findMany({ where: { beneficiaryMembershipId: membershipId } });
  return entries.reduce((acc, e) => acc + e.amountCents, 0n);
}

/** Bir uyenin summary bucket toplamlari (tum aylar/seviyeler). */
export async function summaryTotals(
  prisma: PrismaClient,
  membershipId: string,
): Promise<{ pending: bigint; payable: bigint; paid: bigint }> {
  const rows = await prisma.monthlySummary.findMany({ where: { membershipId } });
  return rows.reduce(
    (acc, r) => ({
      pending: acc.pending + r.pendingCents,
      payable: acc.payable + r.payableCents,
      paid: acc.paid + r.paidCents,
    }),
    { pending: 0n, payable: 0n, paid: 0n },
  );
}
