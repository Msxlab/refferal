import { BadRequestException, Injectable } from '@nestjs/common';
import { LedgerStatus, PayoutMethod, PayoutStatus, Prisma } from '@prisma/client';
import { EngineService } from '../engine/engine.service';
import { monthKey } from '../engine/month';
import { PrismaService } from '../prisma/prisma.service';
import { ActorContext } from '../sales/sales.service';

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
  ) {}

  private async currentPeriod(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return monthKey(new Date(), tenant.timezone);
  }

  /** Esigi gecen (net payable >= payout_min) uyeler — admin payable listesi (SPEC 9). */
  async payable(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    const rows = await this.prisma.$queryRaw<
      Array<{ membershipId: string; referralCode: string; fullName: string; netCents: bigint }>
    >`
      SELECT le.beneficiary_membership_id AS "membershipId",
             m.referral_code              AS "referralCode",
             u.full_name                  AS "fullName",
             SUM(le.amount_cents)         AS "netCents"
      FROM ledger_entries le
      JOIN memberships m ON m.id = le.beneficiary_membership_id
      JOIN users u       ON u.id = m.user_id
      WHERE le.tenant_id = ${tenantId}::uuid
        AND le.status = 'payable'
      GROUP BY le.beneficiary_membership_id, m.referral_code, u.full_name
      HAVING SUM(le.amount_cents) >= ${tenant.payoutMinCents}
      ORDER BY SUM(le.amount_cents) DESC`;

    return {
      payoutMinCents: tenant.payoutMinCents.toString(),
      currency: tenant.currency,
      members: rows.map((r) => ({
        membershipId: r.membershipId,
        referralCode: r.referralCode,
        fullName: r.fullName,
        netCents: r.netCents.toString(),
      })),
    };
  }

  /**
   * Payout calistir: secili (veya esigi gecen tum) uyeleri ode. Her uye ayri transaction
   * (EngineService.payoutMember) — biri atlanirsa digerleri etkilenmez.
   */
  async run(actor: ActorContext, input: { membershipIds?: string[]; period?: string; method: 'manual' | 'csv' }) {
    const period = input.period ?? (await this.currentPeriod(actor.tenantId));
    const method = input.method === 'csv' ? PayoutMethod.csv : PayoutMethod.manual;

    let targets: string[];
    if (input.membershipIds?.length) {
      // hepsi bu tenanta ait olmali
      const valid = await this.prisma.membership.findMany({
        where: { id: { in: input.membershipIds }, tenantId: actor.tenantId },
        select: { id: true },
      });
      if (valid.length !== input.membershipIds.length) {
        throw new BadRequestException('bazi uyelikler bu isletmede yok');
      }
      targets = valid.map((m) => m.id);
    } else {
      const list = await this.payable(actor.tenantId);
      targets = list.members.map((m) => m.membershipId);
    }

    const paid: Array<{ membershipId: string; payoutId: string; totalCents: string }> = [];
    const skipped: Array<{ membershipId: string; reason: string; netCents: string }> = [];

    for (const membershipId of targets) {
      const result = await this.engine.payoutMember({
        tenantId: actor.tenantId,
        membershipId,
        period,
        method,
        actorUserId: actor.userId,
      });
      if (result.paid) {
        paid.push({ membershipId, payoutId: result.payoutId, totalCents: result.totalCents.toString() });
      } else {
        skipped.push({ membershipId, reason: result.reason, netCents: result.netCents.toString() });
      }
    }

    return { period, method, paidCount: paid.length, skippedCount: skipped.length, paid, skipped };
  }

  async list(tenantId: string, q: { status?: PayoutStatus; period?: string; page: number; pageSize: number }) {
    const where: Prisma.PayoutWhereInput = { tenantId, status: q.status, period: q.period };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.payout.count({ where }),
      this.prisma.payout.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { membership: { select: { referralCode: true, user: { select: { fullName: true } } } } },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((p) => ({
        id: p.id,
        membershipId: p.membershipId,
        referralCode: p.membership.referralCode,
        fullName: p.membership.user.fullName,
        totalCents: p.totalCents.toString(),
        method: p.method,
        status: p.status,
        period: p.period,
        paidAt: p.paidAt,
        ref: p.ref,
      })),
    };
  }

  /** Banka CSV exportu (SPEC 9): odenmis payout'lar. */
  async exportCsv(tenantId: string, period?: string): Promise<string> {
    const payouts = await this.prisma.payout.findMany({
      where: { tenantId, status: PayoutStatus.paid, period },
      orderBy: { paidAt: 'asc' },
      include: { membership: { select: { referralCode: true, user: { select: { fullName: true, email: true } } } } },
    });

    const header = 'payout_id,period,referral_code,full_name,email,amount_cents,amount,paid_at';
    const lines = payouts.map((p) => {
      const amount = (Number(p.totalCents) / 100).toFixed(2);
      return [
        p.id,
        p.period,
        p.membership.referralCode,
        csvCell(p.membership.user.fullName),
        p.membership.user.email,
        p.totalCents.toString(),
        amount,
        p.paidAt?.toISOString() ?? '',
      ].join(',');
    });
    return [header, ...lines].join('\n') + '\n';
  }

  /** Uye payout talebi (SPEC 8): net payable >= esik ise 'requested' kayit. */
  async requestPayout(membershipId: string, tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const agg = await this.prisma.ledgerEntry.aggregate({
      where: { tenantId, beneficiaryMembershipId: membershipId, status: LedgerStatus.payable },
      _sum: { amountCents: true },
    });
    const net = agg._sum.amountCents ?? 0n;
    if (net < tenant.payoutMinCents) {
      throw new BadRequestException(
        `odenebilir bakiye ($${(Number(net) / 100).toFixed(2)}) minimum esigin ($${(Number(tenant.payoutMinCents) / 100).toFixed(2)}) altinda`,
      );
    }

    // ayni donemde acik talep varsa tekrar olusturma
    const period = monthKey(new Date(), tenant.timezone);
    const existing = await this.prisma.payout.findFirst({
      where: { tenantId, membershipId, period, status: PayoutStatus.requested },
    });
    if (existing) {
      return { id: existing.id, status: existing.status, period, requestedCents: existing.totalCents.toString() };
    }

    const payout = await this.prisma.payout.create({
      data: {
        tenantId,
        membershipId,
        totalCents: net,
        method: PayoutMethod.manual,
        status: PayoutStatus.requested,
        period,
      },
    });
    return { id: payout.id, status: payout.status, period, requestedCents: net.toString() };
  }

  async listMine(membershipId: string) {
    const rows = await this.prisma.payout.findMany({
      where: { membershipId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((p) => ({
      id: p.id,
      totalCents: p.totalCents.toString(),
      status: p.status,
      method: p.method,
      period: p.period,
      paidAt: p.paidAt,
    }));
  }
}

/** CSV hucresi: virgul/tirnak/yeni satir varsa tirnakla ve "" kacisla. */
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
