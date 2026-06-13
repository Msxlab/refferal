import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LedgerStatus,
  LedgerType,
  MaturationRule,
  NotificationChannel,
  PayoutMethod,
  PayoutStatus,
  Prisma,
  SaleStatus,
  Tenant,
} from '@prisma/client';
import { computeCommissionLines, PlanLevelRate } from '@refearn/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RanksService } from '../ranks/ranks.service';
import { monthKey } from './month';

type Tx = Prisma.TransactionClient;

interface LockedSale {
  id: string;
  tenantId: string;
  sellerMembershipId: string;
  amountCents: bigint;
  status: SaleStatus;
  saleDate: Date;
  summaryMonth: string | null;
  createdBy: string | null;
  approvedAt: Date | null;
  deliveredAt: Date | null;
}

/** void icin kilitlenen ledger satiri (FOR UPDATE sonrasi TAZE statu). */
interface LockedLedgerRow {
  id: string;
  beneficiaryMembershipId: string;
  level: number;
  rateBpsUsed: number;
  amountCents: bigint;
  status: LedgerStatus;
}

interface SummaryDelta {
  pending?: bigint;
  payable?: bigint;
  paid?: bigint;
}

export interface ApplyResult {
  applied: boolean;
  reason?: 'not_approved' | 'already_applied';
  entryCount: number;
}

const TX_OPTS: { timeout: number; maxWait: number } = { timeout: 20_000, maxWait: 15_000 };

// Eszamanli summary upsert'leri kilit sirasi farkindan deadlock (40P01) verebilir;
// serialization failure (40001) de olabilir. Bu gecici hatalar guvenle yeniden denenir
// (bkz. DECISIONS "Inceleme bulgulari" — deadlock).
const RETRYABLE_PG_CODES = new Set(['40P01', '40001']);
const MAX_TX_RETRIES = 5;

function isRetryable(err: unknown): boolean {
  const code =
    (err as { code?: string })?.code ??
    ((err as { meta?: { code?: string } })?.meta?.code as string | undefined);
  return code !== undefined && RETRYABLE_PG_CODES.has(code);
}

async function withTxRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) throw err;
    }
  }
  throw lastErr;
}

/**
 * Komisyon motoru (SPEC 7). Para etkileyen her sey TEK Postgres transaction'inda:
 * ledger + monthly_summaries + outbox + audit birlikte commit olur.
 */
@Injectable()
export class EngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ranks: RanksService,
  ) {}

  /** Tum motor mutasyonlari icin ortak sarmalayici: tek transaction + deadlock retry. */
  private tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTxRetry(() => this.prisma.$transaction(fn, TX_OPTS));
  }

  /** Satisi onaylar ve ayni transaction icinde komisyonlari dagitir. */
  async approveSale(saleId: string, actorUserId?: string): Promise<ApplyResult> {
    return this.tx(async (tx) => {
      const sale = await this.lockSale(tx, saleId);
      if (sale.status === SaleStatus.void) {
        throw new ConflictException('void edilmis satis onaylanamaz');
      }
      if (sale.status === SaleStatus.draft) {
        // Gorevler ayrimi (maker-checker): satisi giren onaylayamaz.
        const selfApproval = !!actorUserId && !!sale.createdBy && sale.createdBy === actorUserId;
        if (selfApproval) {
          const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: sale.tenantId } });
          if (tenant.requireSeparateApprover) {
            throw new ForbiddenException('satisi giren kisi onaylayamaz (gorevler ayrimi)');
          }
          // ayar kapaliyken engellemiyoruz ama guvenlik sinyali olarak audit'e isaretliyoruz
          await this.audit(tx, sale.tenantId, actorUserId, 'security.self_approved_sale', saleId, {}, {
            createdBy: sale.createdBy,
          });
        }
        const approvedAt = new Date();
        await tx.sale.update({
          where: { id: saleId },
          data: { status: SaleStatus.approved, approvedAt, approvedBy: actorUserId ?? null },
        });
        sale.status = SaleStatus.approved;
        sale.approvedAt = approvedAt;
        await this.audit(tx, sale.tenantId, actorUserId, 'sale.approve', saleId, { status: 'draft' }, { status: 'approved' });
      }
      return this.applyCommissionsInTx(tx, sale);
    });
  }

  /** Idempotent: ayni satisa kac kez cagrilirsa cagrilsin sonuc ayni (T4/T10). */
  async applyCommissions(saleId: string): Promise<ApplyResult> {
    return this.tx(async (tx) => {
      const sale = await this.lockSale(tx, saleId);
      return this.applyCommissionsInTx(tx, sale);
    });
  }

  /**
   * Satisi void eder; mevcut her commission satiri icin esit-ters reversal ekler (T5).
   * Muhasebe kurallari docs/DECISIONS.md "Reversal muhasebesi" bolumunde.
   */
  async voidSale(saleId: string, actorUserId?: string): Promise<{ voided: boolean; reversalCount: number }> {
    return this.tx(async (tx) => {
      const sale = await this.lockSale(tx, saleId);
      if (sale.status === SaleStatus.void) {
        return { voided: false, reversalCount: 0 };
      }
      const before = sale.status;
      await tx.sale.update({ where: { id: saleId }, data: { status: SaleStatus.void } });
      await this.audit(tx, sale.tenantId, actorUserId, 'sale.void', saleId, { status: before }, { status: 'void' });

      // FOR UPDATE: eszamanli matureCommissions bu satirlari kilitlemisse bekle, sonra
      // TAZE (commit'li) statuyu oku — yoksa bayat 'pending' okuyup yanlis summary deltasi
      // yazardik (hayalet payable). mature SKIP LOCKED kullandigi icin kilitledigimiz
      // satirlari atlar; deadlock olmaz. (bkz. DECISIONS "Inceleme bulgulari")
      const entries = await tx.$queryRaw<LockedLedgerRow[]>`
        SELECT id,
               beneficiary_membership_id AS "beneficiaryMembershipId",
               level,
               rate_bps_used             AS "rateBpsUsed",
               amount_cents              AS "amountCents",
               status
        FROM ledger_entries
        WHERE sale_id = ${saleId}::uuid
          AND type = 'commission'
          AND status IN ('pending', 'payable', 'paid')
        ORDER BY level ASC
        FOR UPDATE`;
      if (entries.length === 0) {
        return { voided: true, reversalCount: 0 };
      }

      const month = sale.summaryMonth ?? (await this.fallbackMonth(tx, sale));
      await this.assertPeriodsOpen(tx, sale.tenantId, [month]); // kilitli aya ters kayit yazilamaz

      for (const entry of entries) {
        // paid satirin reversal'i payable kalir (eksiye duser, sonraki kazanclardan
        // mahsup edilir); pending/payable satirin reversal'i orijinaliyle birlikte
        // kapanir (ikisi de 'reversed').
        const reversalStatus = entry.status === LedgerStatus.paid ? LedgerStatus.payable : LedgerStatus.reversed;

        await tx.ledgerEntry.create({
          data: {
            tenantId: sale.tenantId,
            saleId,
            beneficiaryMembershipId: entry.beneficiaryMembershipId,
            level: entry.level,
            rateBpsUsed: entry.rateBpsUsed,
            amountCents: -entry.amountCents,
            type: LedgerType.reversal,
            status: reversalStatus,
          },
        });

        if (entry.status !== LedgerStatus.paid) {
          await tx.ledgerEntry.update({ where: { id: entry.id }, data: { status: LedgerStatus.reversed } });
        }

        const delta: SummaryDelta =
          entry.status === LedgerStatus.pending
            ? { pending: -entry.amountCents }
            : { payable: -entry.amountCents }; // payable veya paid (mahsup)
        await this.bumpSummary(tx, sale.tenantId, entry.beneficiaryMembershipId, month, entry.level, delta);

        await tx.notification.create({
          data: {
            tenantId: sale.tenantId,
            recipientMembershipId: entry.beneficiaryMembershipId,
            channel: NotificationChannel.push,
            template: 'commission_reversed',
            payload: { saleId, level: entry.level, amountCents: (-entry.amountCents).toString() },
          },
        });
      }

      return { voided: true, reversalCount: entries.length };
    });
  }

  /** Teslimati isaretler; on_delivery kuralinda pending satirlarin matures_at'ini doldurur (T7). */
  async markDelivered(saleId: string, deliveredAt: Date = new Date()): Promise<{ delivered: boolean }> {
    return this.tx(async (tx) => {
      const sale = await this.lockSale(tx, saleId);
      if (sale.status !== SaleStatus.approved) {
        throw new ConflictException('yalnizca onaylanmis satis teslim edilebilir');
      }
      if (sale.deliveredAt) {
        return { delivered: false };
      }
      await tx.sale.update({ where: { id: saleId }, data: { deliveredAt } });
      // teslime bagli olgunlasma: on_delivery → hemen; days_after_delivery → teslim + N gun
      // (iade penceresi). Diger kurallarda teslim-bekleyen pending satir yok (no-op).
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: sale.tenantId } });
      const maturesAt =
        tenant.maturationRule === MaturationRule.days_after_delivery
          ? new Date(deliveredAt.getTime() + (tenant.maturationDays ?? 0) * 86_400_000)
          : deliveredAt;
      await tx.ledgerEntry.updateMany({
        where: { saleId, type: LedgerType.commission, status: LedgerStatus.pending, maturesAt: null },
        data: { maturesAt },
      });
      return { delivered: true };
    });
  }

  /** Job (5 dk'da bir): matures_at <= now olan pending satirlari payable yapar (SPEC 7). */
  async matureCommissions(now: Date = new Date()): Promise<{ matured: number }> {
    return this.tx(async (tx) => {
      // Ay anahtari satista DONDURULMUS summary_month'tan gelir (apply'da yazildi);
      // null kalmis tarihsel kayitlar icin sale_date + tenant.timezone'a duser.
      const due = await tx.$queryRaw<
        Array<{
          id: string;
          tenantId: string;
          membershipId: string;
          level: number;
          amountCents: bigint;
          month: string;
        }>
      >`
        SELECT le.id,
               le.tenant_id                  AS "tenantId",
               le.beneficiary_membership_id  AS "membershipId",
               le.level,
               le.amount_cents               AS "amountCents",
               COALESCE(
                 s.summary_month,
                 to_char(s.sale_date AT TIME ZONE t.timezone, 'YYYY-MM')
               )                             AS "month"
        FROM ledger_entries le
        JOIN sales s   ON s.id = le.sale_id
        JOIN tenants t ON t.id = le.tenant_id
        WHERE le.type = 'commission'
          AND le.status = 'pending'
          AND le.matures_at IS NOT NULL
          AND le.matures_at <= ${now}
        ORDER BY le.created_at
        FOR UPDATE OF le SKIP LOCKED`;

      for (const row of due) {
        await tx.ledgerEntry.update({ where: { id: row.id }, data: { status: LedgerStatus.payable } });
        await this.bumpSummary(tx, row.tenantId, row.membershipId, row.month, row.level, {
          pending: -row.amountCents,
          payable: row.amountCents,
        });
      }
      return { matured: due.length };
    });
  }

  /**
   * Bir uyenin TUM payable satirlarini tek payout'ta oder (SPEC 6/9):
   * payable satirlari FOR UPDATE ile kilitle → net topla → net < min ise atla →
   * payout olustur (paid) → satirlari paid + payout_id → summary payable→paid → outbox.
   * Negatif reversal (mahsup) satirlari da dahildir: net, clawback dusulmus tutardir.
   * Idempotent degildir ama atomiktir; net<min atlanir (skipped doner).
   */
  async payoutMember(params: {
    tenantId: string;
    membershipId: string;
    period: string;
    method?: PayoutMethod;
    actorUserId?: string;
  }): Promise<
    | { paid: true; payoutId: string; totalCents: bigint; entryCount: number }
    | { paid: false; reason: 'below_min' | 'nothing_payable'; netCents: bigint }
  > {
    return this.tx(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: params.tenantId } });

      // LEFT JOIN: satisa bagli olmayan satirlar (kampanya bonusu vb.) da dahil; ay
      // bucket'i once le.summary_month'tan (bonus), sonra sale'den turetilir.
      const rows = await tx.$queryRaw<
        Array<{ id: string; level: number; amountCents: bigint; month: string }>
      >`
        SELECT le.id,
               le.level,
               le.amount_cents AS "amountCents",
               COALESCE(
                 le.summary_month,
                 s.summary_month,
                 to_char(s.sale_date AT TIME ZONE ${tenant.timezone}, 'YYYY-MM')
               ) AS "month"
        FROM ledger_entries le
        LEFT JOIN sales s ON s.id = le.sale_id
        WHERE le.tenant_id = ${params.tenantId}::uuid
          AND le.beneficiary_membership_id = ${params.membershipId}::uuid
          AND le.status = 'payable'
        FOR UPDATE OF le`;

      if (rows.length === 0) {
        return { paid: false as const, reason: 'nothing_payable' as const, netCents: 0n };
      }
      const net = rows.reduce((a, r) => a + r.amountCents, 0n);
      if (net < tenant.payoutMinCents) {
        return { paid: false as const, reason: 'below_min' as const, netCents: net };
      }

      // kilitli aya ait payable payout edilemez (o ayin summary'sini degistirir)
      await this.assertPeriodsOpen(tx, params.tenantId, rows.map((r) => r.month));

      const payout = await tx.payout.create({
        data: {
          tenantId: params.tenantId,
          membershipId: params.membershipId,
          totalCents: net,
          method: params.method ?? PayoutMethod.manual,
          status: PayoutStatus.paid,
          period: params.period,
          paidAt: new Date(),
        },
      });

      await tx.ledgerEntry.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { status: LedgerStatus.paid, payoutId: payout.id },
      });

      // summary: (month, level) basina payable→paid kaydir
      const byKey = new Map<string, { month: string; level: number; amount: bigint }>();
      for (const r of rows) {
        const key = `${r.month}|${r.level}`;
        const cur = byKey.get(key) ?? { month: r.month, level: r.level, amount: 0n };
        cur.amount += r.amountCents;
        byKey.set(key, cur);
      }
      for (const { month, level, amount } of byKey.values()) {
        await this.bumpSummary(tx, params.tenantId, params.membershipId, month, level, {
          payable: -amount,
          paid: amount,
        });
      }

      await tx.notification.create({
        data: {
          tenantId: params.tenantId,
          recipientMembershipId: params.membershipId,
          channel: NotificationChannel.push,
          template: 'payout_sent',
          payload: { payoutId: payout.id, totalCents: net.toString(), period: params.period },
        },
      });
      await this.audit(tx, params.tenantId, params.actorUserId, 'payout.paid', payout.id, {}, {
        membershipId: params.membershipId,
        totalCents: net.toString(),
        entryCount: rows.length,
      });

      return { paid: true as const, payoutId: payout.id, totalCents: net, entryCount: rows.length };
    });
  }

  /**
   * Satisa bagli OLMAYAN bonus/ayarlama satiri (kampanya odulu vb.): tek transaction'da
   * ledger 'adjustment' (payable) satiri + summary (level 0) + bildirim + audit. Satir
   * summaryMonth'u kendisi tasir; mevcut payout akisi (payoutMember/decide/retry) LEFT JOIN
   * ile bunu da oder. Negatif amountCents = clawback/ceza (ileride).
   */
  async awardBonus(params: {
    tenantId: string;
    membershipId: string;
    amountCents: bigint;
    month: string;
    reason: string;
    actorUserId?: string;
    meta?: Record<string, unknown>;
  }): Promise<{ ledgerId: string }> {
    return this.tx(async (tx) => {
      const entry = await tx.ledgerEntry.create({
        data: {
          tenantId: params.tenantId,
          saleId: null,
          beneficiaryMembershipId: params.membershipId,
          level: 0,
          rateBpsUsed: 0,
          amountCents: params.amountCents,
          type: LedgerType.adjustment,
          status: LedgerStatus.payable,
          summaryMonth: params.month,
        },
      });
      await this.bumpSummary(tx, params.tenantId, params.membershipId, params.month, 0, {
        payable: params.amountCents,
      });
      await tx.notification.create({
        data: {
          tenantId: params.tenantId,
          recipientMembershipId: params.membershipId,
          channel: NotificationChannel.push,
          template: 'bonus_awarded',
          payload: { amountCents: params.amountCents.toString(), reason: params.reason },
        },
      });
      await this.audit(tx, params.tenantId, params.actorUserId, 'campaign.bonus', entry.id, {}, {
        membershipId: params.membershipId,
        amountCents: params.amountCents.toString(),
        reason: params.reason,
        ...(params.meta ?? {}),
      });
      return { ledgerId: entry.id };
    });
  }

  // ---------------------------------------------------------------- internals

  /**
   * SPEC 7 applyCommissions — cagiran, satisi FOR UPDATE ile kilitlemis olmali.
   * approved degilse veya commission satirlari zaten varsa no-op.
   */
  private async applyCommissionsInTx(tx: Tx, sale: LockedSale): Promise<ApplyResult> {
    if (sale.status !== SaleStatus.approved) {
      return { applied: false, reason: 'not_approved', entryCount: 0 };
    }

    const existing = await tx.ledgerEntry.count({ where: { saleId: sale.id, type: LedgerType.commission } });
    if (existing > 0) {
      return { applied: false, reason: 'already_applied', entryCount: existing };
    }

    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: sale.tenantId } });
    const plan = await this.resolvePlan(tx, sale.tenantId, sale.saleDate);
    const chain = await this.uplineChain(tx, sale.sellerMembershipId, plan.depth);
    const lines = computeCommissionLines(sale.amountCents, plan.levels, chain);

    const { status, maturesAt } = this.maturation(tenant, sale);

    // Ay anahtarini DONDUR: ilk apply'da hesapla ve satista sakla; void/mature ayni
    // degeri kullanir (tenant.timezone sonradan degisse bile tutarli bucket).
    const month = sale.summaryMonth ?? monthKey(sale.saleDate, tenant.timezone);
    await this.assertPeriodsOpen(tx, sale.tenantId, [month]); // kilitli aya komisyon yazilamaz
    if (!sale.summaryMonth) {
      await tx.sale.update({ where: { id: sale.id }, data: { summaryMonth: month } });
      sale.summaryMonth = month;
    }

    for (const line of lines) {
      await tx.ledgerEntry.create({
        data: {
          tenantId: sale.tenantId,
          saleId: sale.id,
          beneficiaryMembershipId: line.beneficiaryMembershipId,
          level: line.level,
          rateBpsUsed: line.rateBpsUsed,
          amountCents: line.amountCents,
          type: LedgerType.commission,
          status,
          maturesAt,
        },
      });

      const delta: SummaryDelta =
        status === LedgerStatus.payable ? { payable: line.amountCents } : { pending: line.amountCents };
      await this.bumpSummary(tx, sale.tenantId, line.beneficiaryMembershipId, month, line.level, delta);

      await tx.notification.create({
        data: {
          tenantId: sale.tenantId,
          recipientMembershipId: line.beneficiaryMembershipId,
          channel: NotificationChannel.push,
          template: 'commission_earned',
          payload: { saleId: sale.id, level: line.level, amountCents: line.amountCents.toString() },
        },
      });
    }

    // ---- MLM bonus katmanlari (unilevel+): direkt sponsora fast-start + matching ----
    // Sentetik seviye numaralari (1000/1001) base seviyelerle cakismaz; type=commission
    // oldugu icin void/payout/summary/maturation akisindan dogal gecer.
    let bonusCount = 0;
    const sponsorId = chain[1]; // saticinin direkt sponsoru (varsa)
    if (sponsorId && (plan.fastStartBps > 0 || plan.matchingBps > 0)) {
      const addBonus = async (level: number, rateBps: number, amountCents: bigint, template: string) => {
        if (amountCents <= 0n) return;
        await tx.ledgerEntry.create({
          data: { tenantId: sale.tenantId, saleId: sale.id, beneficiaryMembershipId: sponsorId, level, rateBpsUsed: rateBps, amountCents, type: LedgerType.commission, status, maturesAt },
        });
        const delta: SummaryDelta = status === LedgerStatus.payable ? { payable: amountCents } : { pending: amountCents };
        await this.bumpSummary(tx, sale.tenantId, sponsorId, month, level, delta);
        await tx.notification.create({
          data: { tenantId: sale.tenantId, recipientMembershipId: sponsorId, channel: NotificationChannel.push, template, payload: { saleId: sale.id, amountCents: amountCents.toString() } },
        });
        bonusCount++;
      };

      // fast-start: satici fastStartDays icinde katildiysa, amount * fastStartBps
      if (plan.fastStartBps > 0 && plan.fastStartDays > 0) {
        const seller = await tx.membership.findUnique({ where: { id: sale.sellerMembershipId }, select: { joinedAt: true } });
        if (seller && sale.saleDate.getTime() - seller.joinedAt.getTime() <= plan.fastStartDays * 86_400_000) {
          await addBonus(1000, plan.fastStartBps, (sale.amountCents * BigInt(plan.fastStartBps)) / 10000n, 'commission_earned');
        }
      }
      // matching: saticinin level-0 komisyonunun matchingBps'i (sponsor eslestirme)
      if (plan.matchingBps > 0 && lines.length > 0) {
        await addBonus(1001, plan.matchingBps, (lines[0].amountCents * BigInt(plan.matchingBps)) / 10000n, 'commission_earned');
      }
    }

    // ---- rutbe override (sentetik seviye 1002): satici, ulastigi rutbenin overrideBps'i
    // kadar KENDI satisinda ek bonus alir. Rutbe = team + kazanc esikleri (RanksService). ----
    const overrideBps = await this.ranks.overrideBpsFor(tx, sale.tenantId, sale.sellerMembershipId);
    if (overrideBps > 0) {
      const overrideAmount = (sale.amountCents * BigInt(overrideBps)) / 10000n;
      if (overrideAmount > 0n) {
        const seller = sale.sellerMembershipId;
        await tx.ledgerEntry.create({
          data: { tenantId: sale.tenantId, saleId: sale.id, beneficiaryMembershipId: seller, level: 1002, rateBpsUsed: overrideBps, amountCents: overrideAmount, type: LedgerType.commission, status, maturesAt },
        });
        const delta: SummaryDelta = status === LedgerStatus.payable ? { payable: overrideAmount } : { pending: overrideAmount };
        await this.bumpSummary(tx, sale.tenantId, seller, month, 1002, delta);
        await tx.notification.create({
          data: { tenantId: sale.tenantId, recipientMembershipId: seller, channel: NotificationChannel.push, template: 'rank_override_earned', payload: { saleId: sale.id, amountCents: overrideAmount.toString(), overrideBps } },
        });
        bonusCount++;
      }
    }

    return { applied: true, entryCount: lines.length + bonusCount };
  }

  private async lockSale(tx: Tx, saleId: string): Promise<LockedSale> {
    const rows = await tx.$queryRaw<LockedSale[]>`
      SELECT id,
             tenant_id            AS "tenantId",
             seller_membership_id AS "sellerMembershipId",
             amount_cents         AS "amountCents",
             status,
             sale_date            AS "saleDate",
             summary_month        AS "summaryMonth",
             created_by           AS "createdBy",
             approved_at          AS "approvedAt",
             delivered_at         AS "deliveredAt"
      FROM sales
      WHERE id = ${saleId}::uuid
      FOR UPDATE`;
    if (rows.length === 0) {
      throw new NotFoundException(`satis bulunamadi: ${saleId}`);
    }
    return rows[0];
  }

  /** summary_month NULL kalmis (apply oncesi void edilmis) satis icin son care. */
  private async fallbackMonth(tx: Tx, sale: LockedSale): Promise<string> {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: sale.tenantId } });
    return monthKey(sale.saleDate, tenant.timezone);
  }

  /**
   * Donem kilidi (muhasebe kapanisi): verilen ay(lar) kilitliyse para etkileyen yazimi reddet.
   * Ledger yazimi / void reversal / payout, kilitli bir ayin summary'sine dokunamaz.
   */
  private async assertPeriodsOpen(tx: Tx, tenantId: string, periods: string[]): Promise<void> {
    const unique = [...new Set(periods)];
    if (unique.length === 0) return;
    const lock = await tx.periodLock.findFirst({ where: { tenantId, period: { in: unique } } });
    if (lock) {
      throw new ConflictException(`donem kilitli (${lock.period}) — once muhasebe kilidini acin`);
    }
  }

  /** Satis tarihinde gecerli plan: effective_from <= sale_date, en yeni (SPEC 3.2 / T6). */
  private async resolvePlan(
    tx: Tx,
    tenantId: string,
    saleDate: Date,
  ): Promise<{ depth: number; levels: PlanLevelRate[]; fastStartBps: number; fastStartDays: number; matchingBps: number }> {
    const plan = await tx.commissionPlan.findFirst({
      where: { tenantId, effectiveFrom: { lte: saleDate } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      include: { levels: { orderBy: { level: 'asc' } } },
    });
    if (!plan) {
      throw new ConflictException(`satis tarihinde gecerli komisyon plani yok (tenant=${tenantId})`);
    }
    return {
      depth: plan.depth,
      levels: plan.levels.map((l) => ({ level: l.level, rateBps: l.rateBps })),
      fastStartBps: plan.fastStartBps,
      fastStartDays: plan.fastStartDays,
      matchingBps: plan.matchingBps,
    };
  }

  /**
   * Saticidan yukari sponsor zinciri, en fazla depth eleman (SPEC 7 adim 3).
   * chain[0] = satici. Pasif uye MVP'de payini almaya devam eder — filtre yok;
   * compression tenant ayari semada var, varsayilan kapali.
   */
  private async uplineChain(tx: Tx, sellerMembershipId: string, depth: number): Promise<string[]> {
    const chain: string[] = [];
    let currentId: string | null = sellerMembershipId;
    for (let level = 0; level < depth && currentId; level++) {
      chain.push(currentId);
      const m: { sponsorMembershipId: string | null } | null = await tx.membership.findUnique({
        where: { id: currentId },
        select: { sponsorMembershipId: true },
      });
      if (!m) {
        throw new NotFoundException(`uyelik bulunamadi: ${currentId}`);
      }
      currentId = m.sponsorMembershipId;
    }
    return chain;
  }

  /** Olgunlasma kurali (SPEC 3.4): satirin baslangic statusu + matures_at. */
  private maturation(
    tenant: Tenant,
    sale: LockedSale,
  ): { status: LedgerStatus; maturesAt: Date | null } {
    switch (tenant.maturationRule) {
      case MaturationRule.on_approval:
        return { status: LedgerStatus.payable, maturesAt: null };
      case MaturationRule.on_delivery:
        // teslim edilene kadar matures_at bos; markDelivered doldurur, job olgunlastirir
        return { status: LedgerStatus.pending, maturesAt: sale.deliveredAt };
      case MaturationRule.days_after_approval: {
        const base = sale.approvedAt ?? new Date();
        const days = tenant.maturationDays ?? 0;
        return { status: LedgerStatus.pending, maturesAt: new Date(base.getTime() + days * 86_400_000) };
      }
      case MaturationRule.days_after_delivery: {
        // iade penceresi: teslime kadar matures_at bos; markDelivered teslim+N ile doldurur
        const days = tenant.maturationDays ?? 0;
        return {
          status: LedgerStatus.pending,
          maturesAt: sale.deliveredAt ? new Date(sale.deliveredAt.getTime() + days * 86_400_000) : null,
        };
      }
    }
  }

  /**
   * monthly_summaries upsert — ayni transaction'da (SPEC 7 adim 5).
   * Raw ON CONFLICT: es zamanli iki transaction'in ayni satiri olusturma yarisini
   * Postgres atomik cozer (Prisma upsert'un P2002 yarisina karsi).
   */
  private async bumpSummary(
    tx: Tx,
    tenantId: string,
    membershipId: string,
    month: string,
    level: number,
    delta: SummaryDelta,
  ): Promise<void> {
    const pending = delta.pending ?? 0n;
    const payable = delta.payable ?? 0n;
    const paid = delta.paid ?? 0n;
    await tx.$executeRaw`
      INSERT INTO monthly_summaries
        (id, tenant_id, membership_id, month, level, pending_cents, payable_cents, paid_cents, created_at, updated_at)
      VALUES
        (gen_random_uuid(), ${tenantId}::uuid, ${membershipId}::uuid, ${month}, ${level}, ${pending}, ${payable}, ${paid}, now(), now())
      ON CONFLICT (tenant_id, membership_id, month, level) DO UPDATE SET
        pending_cents = monthly_summaries.pending_cents + EXCLUDED.pending_cents,
        payable_cents = monthly_summaries.payable_cents + EXCLUDED.payable_cents,
        paid_cents    = monthly_summaries.paid_cents    + EXCLUDED.paid_cents,
        updated_at    = now()`;
  }

  /** Para etkileyen aksiyonlar audit log'a yazilir (SPEC 4.2 / 10). */
  private async audit(
    tx: Tx,
    tenantId: string,
    actorUserId: string | undefined,
    action: string,
    entityId: string,
    before: object,
    after: object,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: actorUserId ?? null,
        action,
        // entity action prefix'inden: 'sale.approve'→'sale', 'payout.paid'→'payout'
        entity: action.split('.')[0],
        entityId,
        before,
        after,
      },
    });
  }
}
