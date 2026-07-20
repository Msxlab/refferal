import { Prisma, SaleStatus } from '@prisma/client';
import { SalesService } from './sales.service';

describe('SalesService list evidence snapshot', () => {
  it('reads count, page rows, and commission aggregates in one repeatable-read transaction', async () => {
    const saleDate = new Date('2026-07-15T12:00:00.000Z');
    const sale = {
      id: 'sale-1',
      tenantId: 'tenant-1',
      sellerMembershipId: 'member-1',
      commissionPlanId: null,
      amountCents: 12500n,
      currency: 'USD',
      customerRef: null,
      createdBy: 'seller-user-1',
      saleDate,
      summaryMonth: '2026-07',
      status: SaleStatus.approved,
      approvedBy: 'admin-user-1',
      approvedAt: saleDate,
      deliveredAt: null,
      externalRef: 'ORDER-1',
      createdAt: saleDate,
      updatedAt: saleDate,
      seller: {
        referralCode: 'REF-1',
        userId: 'seller-user-1',
        user: { fullName: 'Seller One' },
      },
    };
    const tx = {
      sale: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([sale]),
      },
      ledgerEntry: {
        groupBy: jest.fn().mockResolvedValue([
          { saleId: 'sale-1', _sum: { amountCents: 875n } },
        ]),
      },
    };
    const prisma = {
      sale: { count: jest.fn(), findMany: jest.fn() },
      ledgerEntry: { groupBy: jest.fn() },
      $transaction: jest.fn(async (callback: unknown) => {
        if (typeof callback !== 'function') throw new Error('expected interactive snapshot transaction');
        return callback(tx);
      }),
    };
    const sales = new SalesService(
      prisma as never,
      null as never,
      { assertActor: jest.fn() } as never,
      null as never,
    );

    const result = await sales.list(
      { tenantId: 'tenant-1', userId: 'admin-user-1' },
      {
        status: 'approved',
        summaryMonth: '2026-07',
        sort: 'saleDate',
        dir: 'desc',
        page: 1,
        pageSize: 6,
      },
    );

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: 'sale-1',
      commissionCents: '875',
      selfSubmitted: true,
    }));
    expect(tx.ledgerEntry.groupBy).toHaveBeenCalledWith({
      by: ['saleId'],
      where: { tenantId: 'tenant-1', saleId: { in: ['sale-1'] } },
      _sum: { amountCents: true },
    });
    expect(tx.sale.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ saleDate: 'desc' }, { id: 'desc' }],
    }));
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(prisma.sale.count).not.toHaveBeenCalled();
    expect(prisma.sale.findMany).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.groupBy).not.toHaveBeenCalled();
  });
});
