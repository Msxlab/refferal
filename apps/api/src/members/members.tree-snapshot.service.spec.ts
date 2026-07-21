import { LedgerStatus, MembershipStatus, Prisma, Role } from '@prisma/client';
import { MembersAdminService } from './members.admin.service';

describe('MembersAdminService tree snapshot', () => {
  const joinedAt = new Date('2026-07-01T12:00:00.000Z');

  function service(options?: { total?: number; rowCount?: number }) {
    const rowCount = options?.rowCount ?? 2;
    const total = options?.total ?? rowCount;
    const scopeRows = Array.from({ length: rowCount }, (_, index) => ({ id: `member-${index + 1}` }));
    const selectedRows = scopeRows.slice(0, 500).map(({ id }, index) => ({
      id,
      sponsorMembershipId: index === 0 ? null : 'member-1',
      referralCode: `REF-${index + 1}`,
      role: Role.member,
      status: MembershipStatus.active,
      depth: index === 0 ? 0 : 1,
      isTeamLeader: index === 0,
      joinedAt,
      user: { fullName: `Member ${index + 1}` },
    }));
    const tx = {
      tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
      membership: {
        count: jest.fn().mockResolvedValue(total),
        findFirst: jest.fn(),
        findMany: jest.fn()
          .mockResolvedValueOnce(scopeRows)
          .mockResolvedValueOnce(selectedRows),
      },
      sale: { groupBy: jest.fn().mockResolvedValue([]) },
      ledgerEntry: { groupBy: jest.fn().mockResolvedValue([]) },
      monthlySummary: { groupBy: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn(),
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    return {
      members: new MembersAdminService(
        prisma as never,
        null as never,
        null as never,
        { assertTenant: jest.fn() } as never,
        null as never,
      ),
      prisma,
      tx,
      selectedRows,
      scopeRows,
    };
  }

  it('separates total count from the 500-id selection and scopes every aggregate to returned ids', async () => {
    const { members, prisma, tx, selectedRows } = service({ total: 701, rowCount: 501 });

    const result = await members.treeSnapshot('tenant-1');
    const selectedIds = selectedRows.map(({ id }) => id);

    expect(result.items).toHaveLength(500);
    expect(result.scope).toEqual({ complete: false, total: 701, limit: 500 });
    expect(tx.membership.count).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1' } });
    expect(tx.membership.findMany).toHaveBeenNthCalledWith(1, {
      where: { tenantId: 'tenant-1' },
      orderBy: [{ depth: 'asc' }, { joinedAt: 'asc' }, { id: 'asc' }],
      take: 500,
      select: { id: true },
    });
    expect(tx.membership.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { tenantId: 'tenant-1', id: { in: selectedIds } },
    }));
    expect(tx.sale.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sellerMembershipId: { in: selectedIds } }),
    }));
    expect(tx.ledgerEntry.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        beneficiaryMembershipId: { in: selectedIds },
        status: { in: [LedgerStatus.payable, LedgerStatus.processing, LedgerStatus.paid] },
      }),
    }));
    expect(tx.monthlySummary.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ membershipId: { in: selectedIds } }),
      _sum: expect.objectContaining({ processingCents: true }),
    }));
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it('returns a complete snapshot with the existing tree item money semantics', async () => {
    const { members, tx } = service();
    tx.sale.groupBy.mockResolvedValue([
      { sellerMembershipId: 'member-1', _count: { _all: 2 }, _sum: { amountCents: 12500n } },
      { sellerMembershipId: 'member-2', _count: { _all: 1 }, _sum: { amountCents: 2500n } },
    ]);
    tx.ledgerEntry.groupBy.mockResolvedValue([
      { beneficiaryMembershipId: 'member-1', _sum: { amountCents: 900n } },
    ]);
    tx.monthlySummary.groupBy.mockResolvedValue([
      {
        membershipId: 'member-1',
        _sum: { pendingCents: 0n, payableCents: 0n, processingCents: 600n, paidCents: 0n },
      },
    ]);

    const result = await members.treeSnapshot('tenant-1');

    expect(result.scope).toEqual({ complete: true, total: 2, limit: 500 });
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: 'member-1',
      salesCount: 2,
      revenueCents: '12500',
      earningsCents: '900',
      monthlyCommissionCents: '600',
      teamSize: 1,
      subtreeRevenueCents: '15000',
    }));
  });

  it('keeps root lookup, subtree count, selection, nodes, and aggregates in the same tenant-safe transaction', async () => {
    const { members, prisma, tx, selectedRows, scopeRows } = service();
    tx.membership.findFirst.mockResolvedValue({ path: 'tenant_root.member_1' });
    tx.membership.findMany.mockReset().mockResolvedValue(selectedRows);
    tx.$queryRaw
      .mockResolvedValueOnce([{ total: 2n }])
      .mockResolvedValueOnce(scopeRows);

    const result = await members.treeSnapshot('tenant-1', 'root-membership-id');

    expect(result.scope).toEqual({ complete: true, total: 2, limit: 500 });
    expect(tx.membership.findFirst).toHaveBeenCalledWith({
      where: { id: 'root-membership-id', tenantId: 'tenant-1' },
      select: { path: true },
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    for (const [query] of tx.$queryRaw.mock.calls) {
      expect(query.values).toEqual(expect.arrayContaining(['tenant-1', 'tenant_root.member_1']));
    }
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });
});
