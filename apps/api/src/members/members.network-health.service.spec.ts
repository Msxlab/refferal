import { MembershipStatus, Prisma } from '@prisma/client';
import { MembersAdminService } from './members.admin.service';

describe('MembersAdminService network health dormant scope', () => {
  it('reports leader scan and dormant result truncation without changing the top-20 clusters', async () => {
    const leaders = Array.from({ length: 25 }, (_, index) => ({
      id: `leader-${index + 1}`,
      referralCode: `LEAD-${index + 1}`,
      user: { fullName: `Leader ${index + 1}` },
    }));
    const tx = {
      tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
      membership: {
        groupBy: jest.fn().mockResolvedValue([
          { status: MembershipStatus.active, _count: { _all: 25 } },
        ]),
        count: jest.fn().mockResolvedValue(30),
        findMany: jest.fn().mockResolvedValue(leaders),
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ sellers: 0n }])
        .mockResolvedValueOnce(leaders.map(({ id }) => ({ id, team: 2n })))
        .mockResolvedValueOnce([]),
    };
    const prisma = {
      tenant: { findUniqueOrThrow: jest.fn(() => { throw new Error('read escaped snapshot'); }) },
      membership: {
        groupBy: jest.fn(() => { throw new Error('read escaped snapshot'); }),
        count: jest.fn(() => { throw new Error('read escaped snapshot'); }),
        findMany: jest.fn(() => { throw new Error('read escaped snapshot'); }),
      },
      $queryRaw: jest.fn(() => { throw new Error('read escaped snapshot'); }),
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const members = new MembersAdminService(
      prisma as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );

    const result = await members.networkHealth('tenant-1');

    expect(result.dormantClusters).toHaveLength(20);
    expect(result.dormantScope).toEqual({
      complete: false,
      totalLeaders: 30,
      scannedLeaders: 25,
      matchedDormantInScan: 25,
      returnedDormant: 20,
      leaderLimit: 200,
      resultLimit: 20,
    });
    const leaderWhere = { tenantId: 'tenant-1', OR: [{ isTeamLeader: true }, { sponsorMembershipId: null }] };
    expect(tx.membership.count).toHaveBeenCalledWith({ where: leaderWhere });
    expect(tx.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: leaderWhere,
      take: 200,
      orderBy: [{ depth: 'asc' }, { joinedAt: 'asc' }, { id: 'asc' }],
    }));
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });
});
