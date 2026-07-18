import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Birlesik global arama (Cmd+K). Tenant-scoped; uye + satis. Her grup en fazla 6. */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(tenantId: string, q: string) {
    const term = q.trim();
    if (term.length < 2) return { members: [], sales: [] };
    const ci = { contains: term, mode: 'insensitive' as const };

    const [members, sales] = await Promise.all([
      this.prisma.membership.findMany({
        where: {
          tenantId,
          OR: [
            { referralCode: ci },
            { user: { fullName: ci } },
            { user: { email: ci } },
          ],
        },
        take: 6,
        orderBy: { joinedAt: 'desc' },
        include: { user: { select: { fullName: true, email: true } } },
      }),
      this.prisma.sale.findMany({
        where: {
          tenantId,
          OR: [
            { customerRef: ci },
            { externalRef: ci },
            { seller: { referralCode: ci } },
            { seller: { user: { fullName: ci } } },
          ] as Prisma.SaleWhereInput['OR'],
        },
        take: 6,
        orderBy: { saleDate: 'desc' },
        include: { seller: { select: { referralCode: true, user: { select: { fullName: true } } } } },
      }),
    ]);

    return {
      members: members.map((m) => ({ id: m.id, name: m.user.fullName, email: m.user.email, code: m.referralCode })),
      sales: sales.map((s) => ({
        id: s.id,
        sellerName: s.seller.user.fullName,
        sellerCode: s.seller.referralCode,
        amountCents: s.amountCents.toString(),
        currency: s.currency,
        status: s.status,
        customerRef: s.customerRef,
      })),
    };
  }
}
