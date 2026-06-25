import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActorContext } from '../common/actor';
import { mailingAddressComplete } from '../account/account.types';
import { buildChecksPdf, CheckDoc } from './checks.pdf';
import { CheckState, GenerateRunInput, MarkMailedInput, PayeeSnapshot } from './checks.types';

type Tx = Prisma.TransactionClient;
const TX_OPTS = { timeout: 20_000, maxWait: 15_000 };
// Cek tutar tavani: NACHA entry siniri ile ayni ($99,999,999.99). Ustunde tutar-yaziyla (centsToWords)
// Number'a dusunce hassasiyet kaybeder + "Billion" ustu kelime uretmez → bozuk cek. Bu yuzden reddet.
const CHECK_AMOUNT_MAX = 9_999_999_999n;

const MAILING_SELECT = {
  mailingName: true, mailingLine1: true, mailingLine2: true,
  mailingCity: true, mailingState: true, mailingPostal: true, mailingCountry: true,
} as const;

function usDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Cek-run (Faz A2.2): odenen (status=paid) cek-yontemli payout'lara sirali cek no atar,
 * adresi O AN snapshot'lar, yazdirilabilir PDF (cek + register) uretir, postalaninca isaretler.
 * Para HAREKETI burada YOK — o, mevcut payout hattinda (decide/approve) zaten gerceklesti.
 */
@Injectable()
export class ChecksService {
  private readonly logger = new Logger(ChecksService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** Bir cek-payout'un is durumu (no atandi mi / postalandi mi / adres tam mi). */
  private stateOf(p: { checkNumber: number | null; mailedAt: Date | null }, addressComplete: boolean): CheckState {
    if (p.mailedAt) return 'mailed';
    if (p.checkNumber != null) return 'printed';
    return addressComplete ? 'ready_to_print' : 'needs_address';
  }

  /** Cek kuyrugu: odenen tum cek-payout'lar + is durumu + sayaclar. */
  async list(tenantId: string) {
    const rows = await this.prisma.payout.findMany({
      where: { tenantId, method: 'check', status: 'paid' },
      orderBy: [{ checkNumber: 'asc' }, { paidAt: 'asc' }],
      include: { membership: { select: { ...MAILING_SELECT, user: { select: { fullName: true } } } } },
    });

    const items = rows.map((p) => {
      const snap = (p.payeeSnapshot as PayeeSnapshot | null) ?? null;
      const complete = snap ? true : mailingAddressComplete(p.membership);
      const payeeName = snap?.name ?? p.membership.mailingName ?? p.membership.user.fullName;
      return {
        payoutId: p.id,
        membershipId: p.membershipId,
        payeeName,
        totalCents: p.totalCents.toString(),
        period: p.period,
        checkNumber: p.checkNumber,
        mailedAt: p.mailedAt,
        addressComplete: complete,
        state: this.stateOf(p, complete),
      };
    });

    const counts = items.reduce(
      (a, it) => { a[it.state] += 1; return a; },
      { needs_address: 0, ready_to_print: 0, printed: 0, mailed: 0 } as Record<CheckState, number>,
    );
    return { items, counts };
  }

  /**
   * Cek-run: no atanmamis odenmis cek-payout'lara sirali no + adres snapshot ata.
   * Tenant satiri FOR UPDATE ile kilitlenir → eszamanli iki run ayni numarayi atayamaz.
   * Adresi eksik olanlar atlanir (cek bir adrese postalanir).
   */
  async generateRun(actor: ActorContext, input: GenerateRunInput) {
    const result = await this.prisma.$transaction(async (tx) => {
      // numaralandirmayi seri kil: tenant satirini kilitle, guncel sayaci oku
      const tRows = await tx.$queryRaw<Array<{ lastCheckNumber: number }>>`
        SELECT last_check_number AS "lastCheckNumber" FROM tenants WHERE id = ${actor.tenantId}::uuid FOR UPDATE`;
      let next = tRows[0]?.lastCheckNumber ?? 1000;

      const targets = await tx.payout.findMany({
        where: {
          tenantId: actor.tenantId,
          method: 'check',
          status: 'paid',
          checkNumber: null,
          ...(input.payoutIds?.length ? { id: { in: input.payoutIds } } : {}),
        },
        orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
        include: { membership: { select: { ...MAILING_SELECT, user: { select: { fullName: true } } } } },
      });

      const assigned: Array<{ payoutId: string; checkNumber: number; payeeName: string; totalCents: string; period: string }> = [];
      const skipped: Array<{ payoutId: string; name: string; reason: string }> = [];

      for (const p of targets) {
        const m = p.membership;
        if (!mailingAddressComplete(m)) {
          skipped.push({ payoutId: p.id, name: m.user.fullName, reason: 'incomplete_address' });
          continue;
        }
        // cek pozitif + sinirli tutarda olmali (0/negatif cek kesilmez; tavan = NACHA siniri)
        if (p.totalCents <= 0n || p.totalCents > CHECK_AMOUNT_MAX) {
          skipped.push({ payoutId: p.id, name: m.user.fullName, reason: 'invalid_amount' });
          continue;
        }
        next += 1;
        const snapshot: PayeeSnapshot = {
          name: m.mailingName ?? m.user.fullName,
          line1: m.mailingLine1 as string,
          line2: m.mailingLine2,
          city: m.mailingCity as string,
          state: m.mailingState as string,
          postal: m.mailingPostal as string,
          country: m.mailingCountry ?? 'US',
        };
        await tx.payout.update({
          where: { id: p.id },
          data: { checkNumber: next, payeeSnapshot: snapshot as unknown as Prisma.InputJsonValue },
        });
        assigned.push({ payoutId: p.id, checkNumber: next, payeeName: snapshot.name, totalCents: p.totalCents.toString(), period: p.period });
      }

      if (assigned.length) {
        await tx.tenant.update({ where: { id: actor.tenantId }, data: { lastCheckNumber: next } });
      }
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: 'check.run',
          entity: 'payout',
          after: {
            assigned: assigned.length,
            skipped: skipped.length,
            fromCheck: assigned[0]?.checkNumber ?? null,
            toCheck: assigned.length ? next : null,
          } as Prisma.InputJsonValue,
        },
      });

      return { assignedCount: assigned.length, assigned, skipped };
    }, TX_OPTS);

    if (result.skipped.length) {
      this.logger.warn(`check-run: ${result.skipped.length} payout adres eksik oldugu icin atlandi (tenant=${actor.tenantId})`);
    }
    return result;
  }

  /** Postalandi isaretle: no atanmis & henuz postalanmamis cekleri mailedAt ile damgala. */
  async markMailed(actor: ActorContext, input: MarkMailedInput) {
    const res = await this.prisma.payout.updateMany({
      where: {
        tenantId: actor.tenantId,
        method: 'check',
        status: 'paid',
        id: { in: input.payoutIds },
        checkNumber: { not: null },
        mailedAt: null,
      },
      data: { mailedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'check.mailed',
        entity: 'payout',
        after: { count: res.count, payoutIds: input.payoutIds } as Prisma.InputJsonValue,
      },
    });
    return { mailed: res.count };
  }

  /**
   * Yazdirilabilir cek PDF'i. payoutIds verilmezse no-atanmis & postalanmamis TUM cekler.
   * Yalniz checkNumber + payeeSnapshot dolu (no atanmis) cekler basilir. POSTALANMIS cek
   * (mailedAt dolu) HER ZAMAN haric — payoutIds verilse bile (yeniden basip cift postalamayi onler).
   */
  async buildPdf(tenantId: string, payoutIds?: string[]): Promise<{ buffer: Buffer; count: number; fileName: string }> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
    const rows = await this.prisma.payout.findMany({
      where: {
        tenantId,
        method: 'check',
        status: 'paid',
        checkNumber: { not: null },
        mailedAt: null, // KOSULSUZ: postalanmis cek yeniden bastirilamaz (cift odeme korumasi)
        ...(payoutIds?.length ? { id: { in: payoutIds } } : {}),
      },
      orderBy: [{ checkNumber: 'asc' }],
    });
    if (rows.length === 0) {
      throw new BadRequestException('bastirilacak cek yok — once cek-run ile numara atayin (postalanmis cekler haric)');
    }

    const checks: CheckDoc[] = rows.map((p) => {
      const snap = p.payeeSnapshot as unknown as PayeeSnapshot | null;
      // butunluk: no atanmis cekin adres snapshot'i tam olmali (yoksa cek-run tekrar)
      if (!snap || !snap.name || !snap.line1 || !snap.city || !snap.state || !snap.postal) {
        throw new BadRequestException(`cek ${p.checkNumber}: payee adres snapshot'i eksik — cek-run'i tekrar calistirin`);
      }
      // tutar pozitif + sinir icinde (savunma: generateRun zaten atlar, ama elle/eski veriye karsi)
      if (p.totalCents <= 0n || p.totalCents > CHECK_AMOUNT_MAX) {
        throw new BadRequestException(`cek ${p.checkNumber}: tutar cek sinirlari disinda (0 < tutar <= $99,999,999.99)`);
      }
      return {
        checkNumber: p.checkNumber as number,
        amountCents: p.totalCents,
        payee: snap,
        memo: `Commission payout — ${p.period}`,
        dateLabel: usDate(p.paidAt ?? p.createdAt),
      };
    });

    const buffer = await buildChecksPdf({ companyName: tenant.name, checks, generatedLabel: usDate(new Date()) });
    const fileName = `checks-${checks[0].checkNumber}-${checks[checks.length - 1].checkNumber}.pdf`;
    return { buffer, count: checks.length, fileName };
  }
}
