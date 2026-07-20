import { NotFoundException } from '@nestjs/common';
import { LedgerStatus, Prisma, SaleStatus } from '@prisma/client';
import { monthKey } from '../engine/month';

const TREE_SNAPSHOT_LIMIT = 500;

export async function readMemberTreeSnapshot(
  tx: Prisma.TransactionClient,
  tenantId: string,
  rootMembershipId?: string,
) {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { timezone: true },
  });
  const month = monthKey(new Date(), tenant.timezone);
  let total: number;
  let selectedIds: string[];

  if (rootMembershipId) {
    const root = await tx.membership.findFirst({
      where: { id: rootMembershipId, tenantId },
      select: { path: true },
    });
    if (!root) throw new NotFoundException('lider/kok uyelik bu isletmede bulunamadi');
    const [countRows, scopeRows] = await Promise.all([
      tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        SELECT count(*)::bigint AS total
        FROM memberships
        WHERE tenant_id = ${tenantId}::uuid AND path::ltree <@ ${root.path}::ltree`),
      tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id::text AS id
        FROM memberships
        WHERE tenant_id = ${tenantId}::uuid AND path::ltree <@ ${root.path}::ltree
        ORDER BY depth ASC, joined_at ASC, id ASC
        LIMIT ${TREE_SNAPSHOT_LIMIT}`),
    ]);
    total = Number(countRows[0]?.total ?? 0n);
    selectedIds = scopeRows.slice(0, TREE_SNAPSHOT_LIMIT).map((row) => row.id);
  } else {
    const [tenantTotal, scopeRows] = await Promise.all([
      tx.membership.count({ where: { tenantId } }),
      tx.membership.findMany({
        where: { tenantId },
        orderBy: [{ depth: 'asc' }, { joinedAt: 'asc' }, { id: 'asc' }],
        take: TREE_SNAPSHOT_LIMIT,
        select: { id: true },
      }),
    ]);
    total = tenantTotal;
    selectedIds = scopeRows.slice(0, TREE_SNAPSHOT_LIMIT).map((row) => row.id);
  }

  const nodes = selectedIds.length
    ? await tx.membership.findMany({
        where: { tenantId, id: { in: selectedIds } },
        orderBy: [{ depth: 'asc' }, { joinedAt: 'asc' }, { id: 'asc' }],
        include: { user: { select: { fullName: true } } },
      })
    : [];
  const returnedIds = nodes.map((node) => node.id);
  const [salesAgg, earnAgg, monthlyAgg] = returnedIds.length
    ? await Promise.all([
        tx.sale.groupBy({
          by: ['sellerMembershipId'],
          where: {
            tenantId,
            status: SaleStatus.approved,
            summaryMonth: month,
            sellerMembershipId: { in: returnedIds },
          },
          _count: { _all: true },
          _sum: { amountCents: true },
        }),
        tx.ledgerEntry.groupBy({
          by: ['beneficiaryMembershipId'],
          where: {
            tenantId,
            status: { in: [LedgerStatus.payable, LedgerStatus.processing, LedgerStatus.paid] },
            beneficiaryMembershipId: { in: returnedIds },
          },
          _sum: { amountCents: true },
        }),
        tx.monthlySummary.groupBy({
          by: ['membershipId'],
          where: { tenantId, month, membershipId: { in: returnedIds } },
          _sum: { pendingCents: true, payableCents: true, processingCents: true, paidCents: true },
        }),
      ])
    : [[], [], []];
  const bySeller = new Map(salesAgg.map((row) => [row.sellerMembershipId, row]));
  const byBeneficiary = new Map(
    earnAgg.map((row) => [row.beneficiaryMembershipId, row._sum.amountCents ?? 0n]),
  );
  const byMonthly = new Map(
    monthlyAgg.map((row) => [
      row.membershipId,
      (row._sum.pendingCents ?? 0n)
        + (row._sum.payableCents ?? 0n)
        + (row._sum.processingCents ?? 0n)
        + (row._sum.paidCents ?? 0n),
    ]),
  );

  const teamSize = new Map<string, number>();
  const subtreeRevenue = new Map<string, bigint>();
  for (const node of nodes) {
    teamSize.set(node.id, 0);
    subtreeRevenue.set(node.id, bySeller.get(node.id)?._sum.amountCents ?? 0n);
  }
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    const parentId = node.sponsorMembershipId;
    if (parentId && teamSize.has(parentId)) {
      teamSize.set(parentId, teamSize.get(parentId)! + teamSize.get(node.id)! + 1);
      subtreeRevenue.set(parentId, subtreeRevenue.get(parentId)! + subtreeRevenue.get(node.id)!);
    }
  }

  const items = nodes.map((node) => {
    const sales = bySeller.get(node.id);
    return {
      id: node.id,
      parentId: node.sponsorMembershipId,
      fullName: node.user.fullName,
      referralCode: node.referralCode,
      role: node.role,
      status: node.status,
      depth: node.depth,
      isTeamLeader: node.isTeamLeader,
      joinedAt: node.joinedAt.toISOString(),
      salesCount: sales?._count._all ?? 0,
      revenueCents: (sales?._sum.amountCents ?? 0n).toString(),
      earningsCents: (byBeneficiary.get(node.id) ?? 0n).toString(),
      monthlyCommissionCents: (byMonthly.get(node.id) ?? 0n).toString(),
      teamSize: teamSize.get(node.id) ?? 0,
      subtreeRevenueCents: (subtreeRevenue.get(node.id) ?? 0n).toString(),
    };
  });

  return {
    items,
    scope: {
      complete: items.length === total,
      total,
      limit: TREE_SNAPSHOT_LIMIT,
    },
  };
}
