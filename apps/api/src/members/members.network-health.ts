import { MembershipStatus, Prisma, SaleStatus } from '@prisma/client';
import { monthKey } from '../engine/month';

const NETWORK_HEALTH_LEADER_LIMIT = 200;
const DORMANT_CLUSTER_RESULT_LIMIT = 20;

export async function readNetworkHealth(tx: Prisma.TransactionClient, tenantId: string) {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { timezone: true },
  });
  const month = monthKey(new Date(), tenant.timezone);

  const statusRows = await tx.membership.groupBy({
    by: ['status'],
    where: { tenantId },
    _count: { _all: true },
  });
  const members = statusRows.reduce((total, row) => total + row._count._all, 0);
  const active = statusRows.find((row) => row.status === MembershipStatus.active)?._count._all ?? 0;
  const inactive = members - active;

  const sellerRows = await tx.$queryRaw<Array<{ sellers: bigint }>>(Prisma.sql`
    SELECT count(DISTINCT s.seller_membership_id)::bigint AS sellers
    FROM sales s
    JOIN memberships m
      ON m.tenant_id = s.tenant_id AND m.id = s.seller_membership_id
    WHERE s.tenant_id = ${tenantId}::uuid
      AND s.status = ${SaleStatus.approved}::"SaleStatus"
      AND s.summary_month = ${month}
      AND m.status = ${MembershipStatus.active}::"MembershipStatus"`);
  const activeSellerCount = Number(sellerRows[0]?.sellers ?? 0n);
  const noSaleCount = Math.max(0, active - activeSellerCount);
  const noSaleActive = {
    count: noSaleCount,
    total: active,
    pct: active > 0 ? Math.round((noSaleCount / active) * 100) : 0,
  };

  const leaderWhere: Prisma.MembershipWhereInput = {
    tenantId,
    OR: [{ isTeamLeader: true }, { sponsorMembershipId: null }],
  };
  const [totalLeaders, leaders] = await Promise.all([
    tx.membership.count({ where: leaderWhere }),
    tx.membership.findMany({
      where: leaderWhere,
      orderBy: [{ depth: 'asc' }, { joinedAt: 'asc' }, { id: 'asc' }],
      take: NETWORK_HEALTH_LEADER_LIMIT,
      select: { id: true, referralCode: true, user: { select: { fullName: true } } },
    }),
  ]);

  let dormantMatches: Array<{
    leaderId: string;
    leaderName: string;
    referralCode: string;
    teamSize: number;
  }> = [];
  if (leaders.length > 0) {
    const leaderIds = leaders.map((leader) => leader.id);
    const teamRows = await tx.$queryRaw<Array<{ id: string; team: bigint }>>(Prisma.sql`
      SELECT l.id::text AS id, count(d.id)::bigint AS team
      FROM memberships l
      JOIN memberships d ON d.tenant_id = l.tenant_id AND d.path::ltree <@ l.path::ltree
      WHERE l.tenant_id = ${tenantId}::uuid
        AND l.id = ANY(ARRAY[${Prisma.join(leaderIds)}]::uuid[])
      GROUP BY l.id`);
    const teamById = new Map(teamRows.map((row) => [row.id, Math.max(0, Number(row.team) - 1)]));
    const soldRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT DISTINCT l.id::text AS id
      FROM memberships l
      JOIN memberships d ON d.tenant_id = l.tenant_id AND d.path::ltree <@ l.path::ltree
      JOIN sales s ON s.tenant_id = l.tenant_id AND s.seller_membership_id = d.id
        AND s.status = ${SaleStatus.approved}::"SaleStatus" AND s.summary_month = ${month}
      WHERE l.tenant_id = ${tenantId}::uuid
        AND l.id = ANY(ARRAY[${Prisma.join(leaderIds)}]::uuid[])`);
    const soldLeaderIds = new Set(soldRows.map((row) => row.id));
    dormantMatches = leaders
      .filter((leader) => !soldLeaderIds.has(leader.id) && (teamById.get(leader.id) ?? 0) > 0)
      .map((leader) => ({
        leaderId: leader.id,
        leaderName: leader.user.fullName,
        referralCode: leader.referralCode,
        teamSize: teamById.get(leader.id) ?? 0,
      }))
      .sort((left, right) => right.teamSize - left.teamSize);
  }
  const dormantClusters = dormantMatches.slice(0, DORMANT_CLUSTER_RESULT_LIMIT);

  return {
    month,
    totals: { members, active, inactive },
    noSaleActive,
    dormantClusters,
    dormantScope: {
      complete: leaders.length === totalLeaders && dormantMatches.length <= DORMANT_CLUSTER_RESULT_LIMIT,
      totalLeaders,
      scannedLeaders: leaders.length,
      matchedDormantInScan: dormantMatches.length,
      returnedDormant: dormantClusters.length,
      leaderLimit: NETWORK_HEALTH_LEADER_LIMIT,
      resultLimit: DORMANT_CLUSTER_RESULT_LIMIT,
    },
  };
}
