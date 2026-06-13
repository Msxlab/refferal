import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerStatus, NotificationChannel, PayoutMethod, PayoutStatus, Prisma } from '@prisma/client';
import { EngineService } from '../engine/engine.service';
import { monthKey } from '../engine/month';
import { PrismaService } from '../prisma/prisma.service';
import { ActorContext } from '../common/actor';
import { kycPayoutBlock } from '../kyc/kyc.types';
import { fraudPayoutBlock } from '../fraud/fraud.types';

type Tx = Prisma.TransactionClient;

/** decide/retry transaction'lari icin kilitlenen ledger satiri (ay anahtari summary kaydirmasi icin). */
interface PayoutLineRow {
  id: string;
  level: number;
  amountCents: bigint;
  status: LedgerStatus;
  month: string;
}

/** FOR UPDATE ile kilitlenen payout satiri. */
interface LockedPayoutRow {
  id: string;
  membershipId: string;
  status: PayoutStatus;
  totalCents: bigint;
  period: string;
  ref: string | null;
}

const TX_OPTS: { timeout: number; maxWait: number } = { timeout: 20_000, maxWait: 15_000 };

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
             SUM(le.amount_cents)::bigint AS "netCents"
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

    // Payout engelleri: KYC kapisi (tenant bayragi) + fraud bayragi (her zaman acik).
    const tenantCfg = await this.prisma.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
    const block = new Map<string, string>();
    if (tenantCfg.requireKycForPayout) {
      const profiles = await this.prisma.payoutProfile.findMany({
        where: { tenantId: actor.tenantId, membershipId: { in: targets } },
        select: { membershipId: true, status: true, lastChangedAt: true },
      });
      const byMember = new Map(profiles.map((p) => [p.membershipId, p]));
      for (const id of targets) {
        const b = kycPayoutBlock(byMember.get(id) ?? null);
        if (b) block.set(id, b);
      }
    }
    // fraud bayragi: cleared olmayan + skor >= esik → bloklu (riskli komisyon hold'u)
    const flags = await this.prisma.fraudFlag.findMany({
      where: { tenantId: actor.tenantId, membershipId: { in: targets } },
      select: { membershipId: true, status: true, score: true },
    });
    for (const f of flags) {
      const b = fraudPayoutBlock(f);
      if (b && !block.has(f.membershipId)) block.set(f.membershipId, b);
    }

    for (const membershipId of targets) {
      const reason = block.get(membershipId);
      if (reason) {
        skipped.push({ membershipId, reason, netCents: '0' });
        continue;
      }
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

  /** Payout dekontu (SPEC 9): payout + uye bilgisi + bagli ledger satirlari. */
  async detail(tenantId: string, payoutId: string) {
    const p = await this.prisma.payout.findFirst({
      where: { id: payoutId, tenantId },
      include: {
        membership: { select: { referralCode: true, user: { select: { fullName: true, email: true } } } },
        entries: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, saleId: true, level: true, type: true, amountCents: true, createdAt: true },
        },
      },
    });
    if (!p) {
      throw new NotFoundException('odeme bulunamadi');
    }
    return {
      id: p.id,
      membershipId: p.membershipId,
      member: {
        fullName: p.membership.user.fullName,
        referralCode: p.membership.referralCode,
        email: p.membership.user.email,
      },
      totalCents: p.totalCents.toString(),
      method: p.method,
      status: p.status,
      period: p.period,
      paidAt: p.paidAt,
      ref: p.ref,
      createdAt: p.createdAt,
      lines: p.entries.map((e) => ({
        id: e.id,
        saleId: e.saleId,
        level: e.level,
        type: e.type,
        amountCents: e.amountCents.toString(),
        createdAt: e.createdAt,
      })),
    };
  }

  /**
   * Talep karari (SPEC 9). Yalnizca 'requested'|'processing' payout icin, TEK transaction:
   * - approve: requestPayout satir BAGLAMAZ (yalnizca tutari snapshot'lar); once bu payout'a
   *   bagli satirlara bakilir, yoksa requestPayout'un sectigi kume uygulanir — uyenin TUM
   *   payable satirlari (negatif reversal/mahsup dahil, engine.payoutMember ile ayni mantik).
   *   Satirlar 'paid' + payout_id, summary payable→paid, payout paid + paidAt + ref.
   * - reject: bagli satirlar 'payable'a geri doner + payout_id=null (bakiye uyeye iade),
   *   payout 'failed' + ref'e sebep.
   */
  async decide(actor: ActorContext, payoutId: string, input: { action: 'approve' | 'reject'; ref?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
      const payout = await this.lockPayout(tx, actor.tenantId, payoutId);
      if (payout.status !== PayoutStatus.requested && payout.status !== PayoutStatus.processing) {
        throw new ConflictException('yalnizca requested/processing durumundaki odeme karara baglanabilir');
      }

      if (input.action === 'approve') {
        let lines = await this.lockBoundLines(tx, tenant.timezone, payoutId);
        if (lines.length === 0) {
          // requestPayout'un secimi: uyenin tum payable satirlari (mahsup dahil)
          lines = await this.lockPayableLines(tx, tenant.timezone, actor.tenantId, payout.membershipId);
        }
        if (lines.length === 0) {
          throw new BadRequestException('odenebilir ledger satiri kalmamis — talep onaylanamaz');
        }
        const net = lines.reduce((a, l) => a + l.amountCents, 0n);
        if (net <= 0n) {
          throw new BadRequestException('net odenebilir tutar pozitif degil — talep onaylanamaz');
        }

        await tx.ledgerEntry.updateMany({
          where: { id: { in: lines.map((l) => l.id) } },
          data: { status: LedgerStatus.paid, payoutId },
        });
        // summary kaydirma yalnizca su an payable olan satirlar icin (zaten paid olan no-op)
        await this.shiftSummaries(
          tx,
          actor.tenantId,
          payout.membershipId,
          lines.filter((l) => l.status === LedgerStatus.payable),
          'payableToPaid',
        );

        const updated = await tx.payout.update({
          where: { id: payoutId },
          // totalCents talep anindaki snapshot'ti; fiilen odenen satirlarin netiyle esitle
          data: {
            status: PayoutStatus.paid,
            paidAt: new Date(),
            totalCents: net,
            ...(input.ref !== undefined ? { ref: input.ref } : {}),
          },
        });

        await tx.notification.create({
          data: {
            tenantId: actor.tenantId,
            recipientMembershipId: payout.membershipId,
            channel: NotificationChannel.push,
            template: 'payout_sent',
            payload: { payoutId, totalCents: net.toString(), period: payout.period },
          },
        });
        await this.audit(tx, actor, 'payout.approve', payoutId,
          { status: payout.status, totalCents: payout.totalCents.toString() },
          { status: 'paid', totalCents: net.toString(), entryCount: lines.length, ref: input.ref ?? null });

        return this.serializeDecision(updated, lines.length);
      }

      // reject — bagli satirlari serbest birak (bakiye uyeye iade)
      const lines = await this.lockBoundLines(tx, tenant.timezone, payoutId);
      if (lines.length > 0) {
        await tx.ledgerEntry.updateMany({
          where: { id: { in: lines.map((l) => l.id) } },
          data: { status: LedgerStatus.payable, payoutId: null },
        });
        // paid'e gecmis satirlarin summary'sini geri al
        await this.shiftSummaries(
          tx,
          actor.tenantId,
          payout.membershipId,
          lines.filter((l) => l.status === LedgerStatus.paid),
          'paidToPayable',
        );
      }
      const updated = await tx.payout.update({
        where: { id: payoutId },
        data: { status: PayoutStatus.failed, ...(input.ref !== undefined ? { ref: input.ref } : {}) },
      });
      await this.audit(tx, actor, 'payout.reject', payoutId,
        { status: payout.status },
        { status: 'failed', releasedCount: lines.length, ref: input.ref ?? null });

      return this.serializeDecision(updated, lines.length);
    }, TX_OPTS);
  }

  /**
   * Basarisiz odemeyi yeniden dene (SPEC 9). Yalnizca status='failed' VE hala bu payout'a
   * bagli ledger satirlari varsa: satirlar 'paid', payout 'paid' + paidAt. Reject bagli
   * satirlari serbest biraktigi icin reddedilmis talep retry edilemez — yeni odeme calistirilir.
   */
  async retry(actor: ActorContext, payoutId: string) {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
      const payout = await this.lockPayout(tx, actor.tenantId, payoutId);
      if (payout.status !== PayoutStatus.failed) {
        throw new ConflictException('yalnizca failed durumundaki odeme yeniden denenebilir');
      }

      const lines = await this.lockBoundLines(tx, tenant.timezone, payoutId);
      if (lines.length === 0) {
        throw new BadRequestException('bu odeme reddedilmis; bakiye uyeye iade edildi — yeni odeme calistirin');
      }

      await tx.ledgerEntry.updateMany({
        where: { id: { in: lines.map((l) => l.id) } },
        data: { status: LedgerStatus.paid },
      });
      await this.shiftSummaries(
        tx,
        actor.tenantId,
        payout.membershipId,
        lines.filter((l) => l.status === LedgerStatus.payable),
        'payableToPaid',
      );

      const updated = await tx.payout.update({
        where: { id: payoutId },
        data: { status: PayoutStatus.paid, paidAt: new Date() },
      });

      await tx.notification.create({
        data: {
          tenantId: actor.tenantId,
          recipientMembershipId: payout.membershipId,
          channel: NotificationChannel.push,
          template: 'payout_sent',
          payload: { payoutId, totalCents: payout.totalCents.toString(), period: payout.period },
        },
      });
      await this.audit(tx, actor, 'payout.retry', payoutId,
        { status: payout.status },
        { status: 'paid', totalCents: payout.totalCents.toString(), entryCount: lines.length });

      return this.serializeDecision(updated, lines.length);
    }, TX_OPTS);
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
    // Dolandiricilik kapisi: dogrulanmamis (sybil) hesap kazanc cekemesin.
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
      select: { user: { select: { emailVerifiedAt: true } } },
    });
    if (!membership) {
      throw new BadRequestException('uyelik bulunamadi');
    }
    if (!membership.user.emailVerifiedAt) {
      throw new BadRequestException('odeme talebi icin e-posta adresinizi dogrulamaniz gerekir');
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    // KYC kapisi: acikken yalniz verified + soguma gecmis profille talep acilir
    if (tenant.requireKycForPayout) {
      const profile = await this.prisma.payoutProfile.findUnique({
        where: { membershipId },
        select: { status: true, lastChangedAt: true },
      });
      const block = kycPayoutBlock(profile);
      if (block) throw new BadRequestException(block);
    }
    // fraud bayragi: bloklu uye odeme talebi acamaz (her zaman acik)
    const flag = await this.prisma.fraudFlag.findUnique({ where: { membershipId }, select: { status: true, score: true } });
    const fraudBlock = fraudPayoutBlock(flag);
    if (fraudBlock) throw new BadRequestException(fraudBlock);
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

  // ---------------------------------------------------------------- internals

  /** Payout'u FOR UPDATE ile kilitle — eszamanli decide/retry cift islemesin. Tenant-scoped. */
  private async lockPayout(tx: Tx, tenantId: string, payoutId: string): Promise<LockedPayoutRow> {
    const rows = await tx.$queryRaw<LockedPayoutRow[]>`
      SELECT id,
             membership_id AS "membershipId",
             status,
             total_cents   AS "totalCents",
             period,
             ref
      FROM payouts
      WHERE id = ${payoutId}::uuid AND tenant_id = ${tenantId}::uuid
      FOR UPDATE`;
    if (rows.length === 0) {
      throw new NotFoundException('odeme bulunamadi');
    }
    return rows[0];
  }

  /** Bu payout'a bagli ledger satirlarini kilitle (ay anahtari engine ile ayni COALESCE kuralindan).
      LEFT JOIN: satisa bagli olmayan bonus/ayarlama satirlari da dahil (ay le.summary_month'tan). */
  private lockBoundLines(tx: Tx, timezone: string, payoutId: string): Promise<PayoutLineRow[]> {
    return tx.$queryRaw<PayoutLineRow[]>`
      SELECT le.id,
             le.level,
             le.amount_cents AS "amountCents",
             le.status,
             COALESCE(
               le.summary_month,
               s.summary_month,
               to_char(s.sale_date AT TIME ZONE ${timezone}, 'YYYY-MM')
             ) AS "month"
      FROM ledger_entries le
      LEFT JOIN sales s ON s.id = le.sale_id
      WHERE le.payout_id = ${payoutId}::uuid
      FOR UPDATE OF le`;
  }

  /** Uyenin TUM payable satirlarini kilitle — engine.payoutMember / requestPayout secimiyle ayni kume. */
  private lockPayableLines(tx: Tx, timezone: string, tenantId: string, membershipId: string): Promise<PayoutLineRow[]> {
    return tx.$queryRaw<PayoutLineRow[]>`
      SELECT le.id,
             le.level,
             le.amount_cents AS "amountCents",
             le.status,
             COALESCE(
               le.summary_month,
               s.summary_month,
               to_char(s.sale_date AT TIME ZONE ${timezone}, 'YYYY-MM')
             ) AS "month"
      FROM ledger_entries le
      LEFT JOIN sales s ON s.id = le.sale_id
      WHERE le.tenant_id = ${tenantId}::uuid
        AND le.beneficiary_membership_id = ${membershipId}::uuid
        AND le.status = 'payable'
      FOR UPDATE OF le`;
  }

  /** monthly_summaries kaydirma: (month, level) basina grupla, tek yonlu delta uygula. */
  private async shiftSummaries(
    tx: Tx,
    tenantId: string,
    membershipId: string,
    lines: PayoutLineRow[],
    direction: 'payableToPaid' | 'paidToPayable',
  ): Promise<void> {
    const byKey = new Map<string, { month: string; level: number; amount: bigint }>();
    for (const l of lines) {
      const key = `${l.month}|${l.level}`;
      const cur = byKey.get(key) ?? { month: l.month, level: l.level, amount: 0n };
      cur.amount += l.amountCents;
      byKey.set(key, cur);
    }
    for (const { month, level, amount } of byKey.values()) {
      const payable = direction === 'payableToPaid' ? -amount : amount;
      const paid = direction === 'payableToPaid' ? amount : -amount;
      // Raw ON CONFLICT upsert — engine.bumpSummary ile ayni kalip (yaris durumuna dayanikli)
      await tx.$executeRaw`
        INSERT INTO monthly_summaries
          (id, tenant_id, membership_id, month, level, pending_cents, payable_cents, paid_cents, created_at, updated_at)
        VALUES
          (gen_random_uuid(), ${tenantId}::uuid, ${membershipId}::uuid, ${month}, ${level}, 0, ${payable}, ${paid}, now(), now())
        ON CONFLICT (tenant_id, membership_id, month, level) DO UPDATE SET
          payable_cents = monthly_summaries.payable_cents + EXCLUDED.payable_cents,
          paid_cents    = monthly_summaries.paid_cents    + EXCLUDED.paid_cents,
          updated_at    = now()`;
    }
  }

  private serializeDecision(
    p: { id: string; status: PayoutStatus; period: string; totalCents: bigint; paidAt: Date | null; ref: string | null },
    lineCount: number,
  ) {
    return {
      id: p.id,
      status: p.status,
      period: p.period,
      totalCents: p.totalCents.toString(),
      paidAt: p.paidAt,
      ref: p.ref,
      lineCount,
    };
  }

  /** Para etkileyen payout kararlari audit log'a yazilir (sales.service.ts kalibi, tx icinde). */
  private async audit(
    tx: Tx,
    actor: ActorContext,
    action: string,
    entityId: string,
    before: object,
    after: object,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action,
        entity: 'payout',
        entityId,
        before,
        after,
      },
    });
  }
}

/** CSV hucresi: virgul/tirnak/yeni satir varsa tirnakla ve "" kacisla. */
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
