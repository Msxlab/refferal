import { ReportsService, type TodoAccess } from './reports.service';

describe('ReportsService todo authorization', () => {
  function service() {
    const prisma = {
      sale: { count: jest.fn().mockResolvedValue(4) },
      payout: { count: jest.fn().mockResolvedValue(3) },
      fraudFlag: { count: jest.fn().mockResolvedValue(2) },
    };
    return { reports: new ReportsService(prisma as never), prisma };
  }

  it('does not query or disclose task buckets the caller cannot act on', async () => {
    const { reports, prisma } = service();
    const access: TodoAccess = {
      salesApproval: false,
      payoutProcessing: false,
      complianceReview: false,
    };

    await expect(reports.todo('tenant-1', access)).resolves.toEqual({ items: [], total: 0 });
    expect(prisma.sale.count).not.toHaveBeenCalled();
    expect(prisma.payout.count).not.toHaveBeenCalled();
    expect(prisma.fraudFlag.count).not.toHaveBeenCalled();
  });

  it('returns only authorized task buckets', async () => {
    const { reports, prisma } = service();
    const access: TodoAccess = {
      salesApproval: true,
      payoutProcessing: false,
      complianceReview: false,
    };

    const result = await reports.todo('tenant-1', access);

    expect(result.items.map(({ key }) => key)).toEqual(['sales_approval']);
    expect(result.total).toBe(4);
    expect(prisma.sale.count).toHaveBeenCalledTimes(1);
    expect(prisma.payout.count).not.toHaveBeenCalled();
    expect(prisma.fraudFlag.count).not.toHaveBeenCalled();
  });

  it('links authorized fraud review work to the payout review surface', async () => {
    const { reports } = service();
    const access: TodoAccess = {
      salesApproval: false,
      payoutProcessing: false,
      complianceReview: true,
    };

    const result = await reports.todo('tenant-1', access);

    expect(result.items).toEqual([
      expect.objectContaining({ key: 'fraud_review', href: '/admin/payouts' }),
    ]);
  });
});

describe('ReportsService monthly commission truth', () => {
  it('keeps processing-only commission visible in dashboard totals and top earners', async () => {
    const prisma = {
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'UTC', currency: 'USD' }),
      },
      membership: {
        count: jest.fn()
          .mockResolvedValueOnce(3)
          .mockResolvedValueOnce(2),
        findMany: jest.fn().mockResolvedValue([
          { id: 'member-1', referralCode: 'REF-1', user: { fullName: 'Member One' } },
        ]),
      },
      sale: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 10_000n } }),
        count: jest.fn().mockResolvedValue(1),
      },
      monthlySummary: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { pendingCents: 0n, payableCents: 0n, processingCents: 700n, paidCents: 0n },
        }),
        groupBy: jest.fn().mockResolvedValue([
          {
            membershipId: 'member-1',
            _sum: { pendingCents: 0n, payableCents: 0n, processingCents: 700n, paidCents: 0n },
          },
        ]),
      },
      payout: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalCents: 0n } }),
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ sum: 0n }])
        .mockResolvedValueOnce([{ sum: 0n }]),
      $transaction: jest.fn((queries: Array<Promise<unknown>>) => Promise.all(queries)),
    };
    const reports = new ReportsService(
      prisma as never,
      { assertTenant: jest.fn() } as never,
    );

    const result = await reports.dashboard('tenant-1', '2026-07');

    expect(result.thisMonth.commissionCents).toBe('700');
    expect(result.topEarners).toEqual([
      expect.objectContaining({ membershipId: 'member-1', earnedCents: '700' }),
    ]);
    expect(prisma.monthlySummary.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      _sum: expect.objectContaining({ processingCents: true }),
    }));
    expect(prisma.monthlySummary.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      _sum: expect.objectContaining({ processingCents: true }),
    }));
  });
});
