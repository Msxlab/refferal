import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerStatus, NotificationChannel, PayoutMethod, PayoutStatus, Prisma } from '@prisma/client';
import { EngineService } from '../engine/engine.service';
import { monthKey } from '../engine/month';
import { PrismaService } from '../prisma/prisma.service';
import { ActorContext } from '../common/actor';
import { kycPayoutBlock } from '../kyc/kyc.types';
import { fraudPayoutBlock } from '../fraud/fraud.types';
import { WebhooksService } from '../webhooks/webhooks.service';
import { EventsService } from '../events/events.service';
import { decryptSecret } from '../common/crypto';
import { achConfigFromEnv, AchEntry, buildNachaFile } from './nacha';

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
    private readonly webhooks: WebhooksService,
    private readonly events: EventsService,
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

    // her uyenin BU AY kendi cirosu (sattigi) — odeme ekraninda "sattigi vs kazandigi"
    const month = monthKey(new Date(), tenant.timezone);
    const ids = rows.map((r) => r.membershipId);
    const soldAgg = ids.length
      ? await this.prisma.sale.groupBy({
          by: ['sellerMembershipId'],
          where: { tenantId, status: 'approved', summaryMonth: month, sellerMembershipId: { in: ids } },
          _sum: { amountCents: true },
        })
      : [];
    const soldBy = new Map(soldAgg.map((s) => [s.sellerMembershipId, s._sum.amountCents ?? 0n]));

    return {
      payoutMinCents: tenant.payoutMinCents.toString(),
      currency: tenant.currency,
      members: rows.map((r) => ({
        membershipId: r.membershipId,
        referralCode: r.referralCode,
        fullName: r.fullName,
        netCents: r.netCents.toString(),
        soldThisMonthCents: (soldBy.get(r.membershipId) ?? 0n).toString(),
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
    const targets = await this.resolveTargets(actor.tenantId, input.membershipIds);

    // Maker-checker: acikken yurutme, ONERI olustur — farkli admin onaylar (proposeBatch/approveBatch).
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
    if (tenant.requirePayoutApproval) {
      const payableList = await this.payable(actor.tenantId);
      const estimate = payableList.members.filter((m) => targets.includes(m.membershipId)).reduce((a, m) => a + BigInt(m.netCents), 0n);
      const batch = await this.prisma.payoutBatch.create({
        data: { tenantId: actor.tenantId, period, method, membershipIds: targets, estimateCents: estimate, proposedByUserId: actor.userId },
      });
      await this.audit2(actor, 'payout.batch_propose', batch.id, { count: targets.length, estimateCents: estimate.toString() });
      return { proposed: true as const, batchId: batch.id, period, method, count: targets.length, estimateCents: estimate.toString() };
    }

    return this.executeTargets(actor, targets, period, method);
  }

  /** membershipIds verilirse dogrula, yoksa esigi gecen tum uyeler. */
  private async resolveTargets(tenantId: string, membershipIds?: string[]): Promise<string[]> {
    if (membershipIds?.length) {
      const valid = await this.prisma.membership.findMany({ where: { id: { in: membershipIds }, tenantId }, select: { id: true } });
      if (valid.length !== membershipIds.length) throw new BadRequestException('bazi uyelikler bu isletmede yok');
      return valid.map((m) => m.id);
    }
    const list = await this.payable(tenantId);
    return list.members.map((m) => m.membershipId);
  }

  /** Hedefleri fiilen ode (gate kontrolu + engine). run + approveBatch ortak kullanir. */
  private async executeTargets(actor: ActorContext, targets: string[], period: string, method: PayoutMethod) {
    const paid: Array<{ membershipId: string; payoutId: string; totalCents: string }> = [];
    const skipped: Array<{ membershipId: string; reason: string; netCents: string }> = [];

    // Payout engelleri: sanctions (her zaman) + KYC kapisi (tenant bayragi) + fraud (her zaman).
    const tenantCfg = await this.prisma.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
    const block = new Map<string, string>();
    const profiles = await this.prisma.payoutProfile.findMany({
      where: { tenantId: actor.tenantId, membershipId: { in: targets } },
      select: { membershipId: true, status: true, lastChangedAt: true, sanctionsHit: true },
    });
    const profileByMember = new Map(profiles.map((p) => [p.membershipId, p]));
    for (const id of targets) {
      const p = profileByMember.get(id) ?? null;
      if (p?.sanctionsHit) { block.set(id, 'sanctions match — compliance review'); continue; }
      if (tenantCfg.requireKycForPayout) {
        const b = kycPayoutBlock(p);
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

    // giden webhook: odenen her uye icin 'payout.paid' (best-effort, teslimat worker'i gonderir)
    for (const p of paid) {
      await this.webhooks.emit(actor.tenantId, 'payout.paid', { membershipId: p.membershipId, payoutId: p.payoutId, totalCents: p.totalCents, period }).catch(() => undefined);
    }
    // canli SSE: panel toplam odemeyi aninda gostersin
    if (paid.length) {
      this.events.publish(actor.tenantId, 'payout.paid', { count: paid.length, period });
    }

    return { period, method, paidCount: paid.length, skippedCount: skipped.length, paid, skipped };
  }

  // ---- maker-checker batch'leri ----

  /** Bekleyen (proposed) batch'ler — onay kuyrugu. */
  async listBatches(tenantId: string) {
    const rows = await this.prisma.payoutBatch.findMany({ where: { tenantId, status: 'proposed' }, orderBy: { createdAt: 'desc' } });
    return rows.map((b) => ({ id: b.id, period: b.period, method: b.method, count: b.membershipIds.length, estimateCents: b.estimateCents.toString(), proposedByUserId: b.proposedByUserId, createdAt: b.createdAt }));
  }

  /** Onayla + yurut. Maker≠checker: oneren kisi onaylayamaz. */
  async approveBatch(actor: ActorContext, batchId: string) {
    const batch = await this.prisma.payoutBatch.findFirst({ where: { id: batchId, tenantId: actor.tenantId } });
    if (!batch) throw new NotFoundException('payout onerisi bulunamadi');
    if (batch.status !== 'proposed') throw new ConflictException('yalnizca bekleyen oneri onaylanabilir');
    if (batch.proposedByUserId === actor.userId) throw new BadRequestException('oneriyi yapan kisi onaylayamaz (4-goz)');

    const result = await this.executeTargets(actor, batch.membershipIds, batch.period, batch.method);
    await this.prisma.payoutBatch.update({ where: { id: batch.id }, data: { status: 'executed', approvedByUserId: actor.userId, executedAt: new Date() } });
    await this.audit2(actor, 'payout.batch_approve', batch.id, { paidCount: result.paidCount, skippedCount: result.skippedCount });
    return { ...result, batchId: batch.id };
  }

  async rejectBatch(actor: ActorContext, batchId: string) {
    const batch = await this.prisma.payoutBatch.findFirst({ where: { id: batchId, tenantId: actor.tenantId } });
    if (!batch) throw new NotFoundException('payout onerisi bulunamadi');
    if (batch.status !== 'proposed') throw new ConflictException('yalnizca bekleyen oneri reddedilebilir');
    await this.prisma.payoutBatch.update({ where: { id: batch.id }, data: { status: 'rejected', approvedByUserId: actor.userId } });
    await this.audit2(actor, 'payout.batch_reject', batch.id, {});
    return { rejected: true };
  }

  private async audit2(actor: ActorContext, action: string, entityId: string, after: object): Promise<void> {
    await this.prisma.auditLog.create({ data: { tenantId: actor.tenantId, actorUserId: actor.userId, action, entity: 'payout', entityId, after } });
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
        clearedAt: p.clearedAt,
        bankRef: p.bankRef,
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
      clearedAt: p.clearedAt,
      bankRef: p.bankRef,
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

  /**
   * Banka mutabakati (Dalga 3): banka ACH'i isleyip parayi gonderdikten sonra admin ekstreyi
   * import eder. Her satir, henuz mutabik olmayan 'paid' bir payout ile TUTARA gore eslenir
   * (her payout en fazla bir kez). Eslesenler 'cleared' isaretlenir; eslesmeyenler raporlanir.
   */
  async reconcile(
    actor: ActorContext,
    rows: Array<{ amountCents: number; ref?: string }>,
  ): Promise<{
    clearedCount: number;
    matched: Array<{ payoutId: string; membershipId: string; amountCents: string; bankRef: string | null }>;
    unmatched: Array<{ amountCents: number; ref?: string }>;
    remainingUncleared: number;
  }> {
    // mutabik olmayan odenmis payout'lar — tutara gore kova (FIFO eslestirme icin eski once)
    const open = await this.prisma.payout.findMany({
      where: { tenantId: actor.tenantId, status: PayoutStatus.paid, clearedAt: null },
      orderBy: { paidAt: 'asc' },
      select: { id: true, membershipId: true, totalCents: true },
    });
    const byAmount = new Map<string, Array<{ id: string; membershipId: string }>>();
    for (const p of open) {
      const key = p.totalCents.toString();
      const arr = byAmount.get(key) ?? [];
      arr.push({ id: p.id, membershipId: p.membershipId });
      byAmount.set(key, arr);
    }

    const matched: Array<{ payoutId: string; membershipId: string; amountCents: string; bankRef: string | null }> = [];
    const unmatched: Array<{ amountCents: number; ref?: string }> = [];
    const now = new Date();

    for (const row of rows) {
      const key = BigInt(Math.round(row.amountCents)).toString();
      const bucket = byAmount.get(key);
      const hit = bucket?.shift(); // ayni tutarda birden cok varsa FIFO
      if (!hit) {
        unmatched.push(row);
        continue;
      }
      await this.prisma.payout.update({
        where: { id: hit.id },
        data: { clearedAt: now, bankRef: row.ref ?? null, reconciledByUserId: actor.userId },
      });
      matched.push({ payoutId: hit.id, membershipId: hit.membershipId, amountCents: key, bankRef: row.ref ?? null });
    }

    await this.prisma.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'payout.reconcile',
        entity: 'payout',
        after: { clearedCount: matched.length, unmatchedCount: unmatched.length } as Prisma.InputJsonValue,
      },
    });

    const remainingUncleared = await this.prisma.payout.count({
      where: { tenantId: actor.tenantId, status: PayoutStatus.paid, clearedAt: null },
    });
    return { clearedCount: matched.length, matched, unmatched, remainingUncleared };
  }

  /**
   * Self-hosted ACH/NACHA dosyasi (Dalga 3): donemin odenmis payout'lari icin banka dosyasi.
   * Dis servis YOK — admin bunu kendi bankasina yukler. Banka bilgisi (sifreli) decrypt edilir.
   */
  async achFile(tenantId: string, period?: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const payouts = await this.prisma.payout.findMany({
      where: { tenantId, status: PayoutStatus.paid, period },
      orderBy: { paidAt: 'asc' },
      include: { membership: { select: { id: true, user: { select: { fullName: true } }, payoutProfile: true } } },
    });
    const entries: AchEntry[] = [];
    for (const p of payouts) {
      const prof = p.membership.payoutProfile;
      if (!prof || !prof.accountEnc) continue; // banka bilgisi yoksa atla
      entries.push({
        routingNumber: prof.routingNumber,
        accountNumber: decryptSecret(prof.accountEnc),
        accountType: prof.accountType === 'savings' ? 'savings' : 'checking',
        amountCents: Number(p.totalCents),
        name: prof.legalName ?? p.membership.user.fullName,
        id: p.membership.id,
      });
    }
    return buildNachaFile(entries, achConfigFromEnv(tenant.name), new Date());
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

    // sanctions (her zaman) + KYC kapisi (tenant bayragi)
    const profile = await this.prisma.payoutProfile.findUnique({
      where: { membershipId },
      select: { status: true, lastChangedAt: true, sanctionsHit: true },
    });
    if (profile?.sanctionsHit) throw new BadRequestException('sanctions match — compliance review');
    if (tenant.requireKycForPayout) {
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
