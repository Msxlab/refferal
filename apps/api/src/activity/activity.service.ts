import { Injectable } from '@nestjs/common';
import { LedgerType, PayoutMethod, PayoutStatus, SaleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVITY_PAGE_SIZE, ActivityItem, ActivityQuery } from './activity.types';

/**
 * Uye aktivite akisi (derive-on-read). Tum kaynaklar member+tenant scoped.
 * GIZLILIK (wallet.service ile ayni model): yalniz DIREKT recruit'ler isimle gosterilir;
 * daha derin downline join'leri bu akista hic gosterilmez (yalniz kendi davet ettigi 1. seviye).
 */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async feed(membershipId: string, tenantId: string, q: ActivityQuery): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
    const items: ActivityItem[] = [];

    // 1) DIREKT recruit join'leri (isimle — kendi davet ettikleri). sponsor = me.
    const directs = await this.prisma.membership.findMany({
      where: { tenantId, sponsorMembershipId: membershipId },
      select: { id: true, joinedAt: true, user: { select: { fullName: true } } },
    });
    for (const d of directs) {
      items.push({
        id: `join:${d.id}`,
        type: 'team_join',
        ts: d.joinedAt.toISOString(),
        title: `${d.user.fullName} joined your team`,
        subject: d.user.fullName,
      });
    }

    // 2) Kendi satislari onaylandi (approvedAt dolu).
    const sales = await this.prisma.sale.findMany({
      where: { tenantId, sellerMembershipId: membershipId, status: SaleStatus.approved, approvedAt: { not: null } },
      select: { id: true, approvedAt: true, amountCents: true },
    });
    for (const s of sales) {
      items.push({
        id: `sale:${s.id}`,
        type: 'sale_approved',
        ts: (s.approvedAt as Date).toISOString(),
        title: 'Your sale was approved',
        amountCents: s.amountCents.toString(),
      });
    }

    // 3) Komisyon kredilendi (ledger, type=commission — kendi beneficiary satirlari).
    const ledger = await this.prisma.ledgerEntry.findMany({
      where: { tenantId, beneficiaryMembershipId: membershipId, type: LedgerType.commission },
      select: { id: true, createdAt: true, amountCents: true },
    });
    for (const l of ledger) {
      items.push({
        id: `comm:${l.id}`,
        type: 'commission_credited',
        ts: l.createdAt.toISOString(),
        title: 'Commission credited',
        amountCents: l.amountCents.toString(),
      });
    }

    // 4) Cek postalandi / odendi (Payout, method=check).
    const payouts = await this.prisma.payout.findMany({
      where: { tenantId, membershipId, method: PayoutMethod.check },
      select: { id: true, totalCents: true, mailedAt: true, paidAt: true, status: true },
    });
    for (const p of payouts) {
      if (p.mailedAt) {
        items.push({ id: `mailed:${p.id}`, type: 'check_mailed', ts: p.mailedAt.toISOString(), title: 'Check mailed', amountCents: p.totalCents.toString() });
      }
      if (p.status === PayoutStatus.paid && p.paidAt) {
        items.push({ id: `paid:${p.id}`, type: 'check_paid', ts: p.paidAt.toISOString(), title: 'Check paid', amountCents: p.totalCents.toString() });
      }
    }

    // (ts, id) desc siralama — kararlı: ts esitse id ile tie-break.
    items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

    // cursor: "<ts>|<id>" — bu anahtardan KESIN kucuk olan ilk sayfa disi eleman.
    let start = 0;
    if (q.cursor) {
      const bar = q.cursor.lastIndexOf('|');
      const curTs = q.cursor.slice(0, bar);
      const curId = q.cursor.slice(bar + 1);
      start = items.findIndex((it) => it.ts < curTs || (it.ts === curTs && it.id < curId));
      if (start < 0) start = items.length;
    }

    const page = items.slice(start, start + ACTIVITY_PAGE_SIZE);
    const last = page[page.length - 1];
    const hasMore = start + ACTIVITY_PAGE_SIZE < items.length;
    const nextCursor = hasMore && last ? `${last.ts}|${last.id}` : null;
    return { items: page, nextCursor };
  }
}
