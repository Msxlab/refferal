import { Injectable, NotFoundException } from '@nestjs/common';
import { LedgerStatus } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { PrismaService } from '../prisma/prisma.service';

interface Tier { name: string; sortOrder: number; minTeam: number; minEarningsCents: number }

// Tenant tier tanimlamadiysa yerlesik varsayilan merdiven.
const DEFAULT_TIERS: Tier[] = [
  { name: 'Bronze', sortOrder: 0, minTeam: 0, minEarningsCents: 0 },
  { name: 'Silver', sortOrder: 1, minTeam: 3, minEarningsCents: 100_000 }, // $1,000
  { name: 'Gold', sortOrder: 2, minTeam: 10, minEarningsCents: 1_000_000 }, // $10,000
  { name: 'Platinum', sortOrder: 3, minTeam: 25, minEarningsCents: 5_000_000 }, // $50,000
];

@Injectable()
export class RanksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Etkin merdiven: tenant ozel tier'lari varsa onlar, yoksa varsayilanlar (sortOrder asc). */
  async effectiveTiers(tenantId: string): Promise<Tier[]> {
    const custom = await this.prisma.rankTier.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } });
    if (custom.length === 0) return DEFAULT_TIERS;
    return custom.map((t) => ({ name: t.name, sortOrder: t.sortOrder, minTeam: t.minTeam, minEarningsCents: Number(t.minEarningsCents) }));
  }

  // ---- admin CRUD ----
  async list(tenantId: string) {
    const custom = await this.prisma.rankTier.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } });
    if (custom.length === 0) {
      return { isDefault: true, tiers: DEFAULT_TIERS.map((t) => ({ id: null, ...t, minEarningsCents: t.minEarningsCents.toString() })) };
    }
    return { isDefault: false, tiers: custom.map((t) => ({ id: t.id, name: t.name, sortOrder: t.sortOrder, minTeam: t.minTeam, minEarningsCents: t.minEarningsCents.toString() })) };
  }

  async create(actor: ActorContext, input: { name: string; sortOrder: number; minTeam: number; minEarningsCents: number }) {
    const t = await this.prisma.rankTier.create({
      data: { tenantId: actor.tenantId, name: input.name, sortOrder: input.sortOrder, minTeam: input.minTeam, minEarningsCents: BigInt(input.minEarningsCents) },
    });
    return { id: t.id };
  }

  async update(actor: ActorContext, id: string, input: { name?: string; sortOrder?: number; minTeam?: number; minEarningsCents?: number }) {
    const t = await this.prisma.rankTier.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!t) throw new NotFoundException('rutbe bulunamadi');
    await this.prisma.rankTier.update({
      where: { id },
      data: {
        name: input.name, sortOrder: input.sortOrder, minTeam: input.minTeam,
        minEarningsCents: input.minEarningsCents === undefined ? undefined : BigInt(input.minEarningsCents),
      },
    });
    return { id };
  }

  async remove(actor: ActorContext, id: string) {
    const t = await this.prisma.rankTier.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!t) throw new NotFoundException('rutbe bulunamadi');
    await this.prisma.rankTier.delete({ where: { id } });
    return { deleted: true };
  }

  // ---- uye rutbesi + rozetler ----
  async memberRank(membershipId: string, tenantId: string) {
    const me = await this.prisma.membership.findFirst({ where: { id: membershipId, tenantId }, select: { path: true } });
    if (!me) throw new NotFoundException('uyelik bulunamadi');

    const [teamRows, earnAgg, directs, salesCount] = await Promise.all([
      this.prisma.$queryRaw<Array<{ c: bigint }>>`
        SELECT count(*)::bigint AS c FROM memberships
        WHERE tenant_id = ${tenantId}::uuid AND path::ltree <@ ${me.path}::ltree AND id <> ${membershipId}::uuid`,
      this.prisma.ledgerEntry.aggregate({
        where: { tenantId, beneficiaryMembershipId: membershipId, status: { in: [LedgerStatus.payable, LedgerStatus.paid] } },
        _sum: { amountCents: true },
      }),
      this.prisma.membership.count({ where: { tenantId, sponsorMembershipId: membershipId } }),
      this.prisma.sale.count({ where: { tenantId, sellerMembershipId: membershipId } }),
    ]);
    const teamSize = Number(teamRows[0]?.c ?? 0n);
    const earnings = Number(earnAgg._sum.amountCents ?? 0n);

    const tiers = await this.effectiveTiers(tenantId);
    let currentIdx = -1;
    tiers.forEach((t, i) => { if (teamSize >= t.minTeam && earnings >= t.minEarningsCents) currentIdx = i; });
    const current = currentIdx >= 0 ? tiers[currentIdx] : null;
    const next = tiers[currentIdx + 1] ?? null;
    const progress = next
      ? {
          teamPct: next.minTeam > 0 ? Math.min(100, Math.round((teamSize / next.minTeam) * 100)) : 100,
          earningsPct: next.minEarningsCents > 0 ? Math.min(100, Math.round((earnings / next.minEarningsCents) * 100)) : 100,
        }
      : null;

    const badges = [
      { key: 'first_sale', label: 'First sale', earned: salesCount > 0 },
      { key: 'first_recruit', label: 'First recruit', earned: directs > 0 },
      { key: 'team_5', label: 'Team of 5', earned: teamSize >= 5 },
      { key: 'earned_10k', label: '$10K earned', earned: earnings >= 1_000_000 },
    ];

    return {
      current: current?.name ?? null,
      next: next?.name ?? null,
      teamSize,
      earningsCents: String(earnings),
      progress,
      overallPct: progress ? Math.min(progress.teamPct, progress.earningsPct) : 100,
      badges,
    };
  }
}
