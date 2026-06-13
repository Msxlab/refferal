import { Injectable, NotFoundException } from '@nestjs/common';
import { LedgerStatus, Prisma } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { PrismaService } from '../prisma/prisma.service';

interface Tier { name: string; sortOrder: number; minTeam: number; minEarningsCents: number; overrideBps: number }

type Client = PrismaService | Prisma.TransactionClient;

// Tenant tier tanimlamadiysa yerlesik varsayilan merdiven (override yerlesikte kapali: 0).
const DEFAULT_TIERS: Tier[] = [
  { name: 'Bronze', sortOrder: 0, minTeam: 0, minEarningsCents: 0, overrideBps: 0 },
  { name: 'Silver', sortOrder: 1, minTeam: 3, minEarningsCents: 100_000, overrideBps: 0 }, // $1,000
  { name: 'Gold', sortOrder: 2, minTeam: 10, minEarningsCents: 1_000_000, overrideBps: 0 }, // $10,000
  { name: 'Platinum', sortOrder: 3, minTeam: 25, minEarningsCents: 5_000_000, overrideBps: 0 }, // $50,000
];

@Injectable()
export class RanksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Etkin merdiven: tenant ozel tier'lari varsa onlar, yoksa varsayilanlar (sortOrder asc). */
  async effectiveTiers(tenantId: string, client: Client = this.prisma): Promise<Tier[]> {
    const custom = await client.rankTier.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } });
    if (custom.length === 0) return DEFAULT_TIERS;
    return custom.map((t) => ({ name: t.name, sortOrder: t.sortOrder, minTeam: t.minTeam, minEarningsCents: Number(t.minEarningsCents), overrideBps: t.overrideBps }));
  }

  /**
   * Uyenin ulastigi rutbe tier'i (team + kazanc esiklerini gecen en yuksek tier).
   * client verilirse ayni transaction'da okur (engine apply akisi icin).
   */
  async resolveTier(client: Client, tenantId: string, membershipId: string): Promise<Tier | null> {
    const me = await client.membership.findFirst({ where: { id: membershipId, tenantId }, select: { path: true } });
    if (!me) return null;
    const [teamRows, earnAgg] = await Promise.all([
      client.$queryRaw<Array<{ c: bigint }>>`
        SELECT count(*)::bigint AS c FROM memberships
        WHERE tenant_id = ${tenantId}::uuid AND path::ltree <@ ${me.path}::ltree AND id <> ${membershipId}::uuid`,
      client.ledgerEntry.aggregate({
        where: { tenantId, beneficiaryMembershipId: membershipId, status: { in: [LedgerStatus.payable, LedgerStatus.paid] } },
        _sum: { amountCents: true },
      }),
    ]);
    const teamSize = Number(teamRows[0]?.c ?? 0n);
    const earnings = Number(earnAgg._sum.amountCents ?? 0n);
    const tiers = await this.effectiveTiers(tenantId, client);
    let current: Tier | null = null;
    for (const t of tiers) {
      if (teamSize >= t.minTeam && earnings >= t.minEarningsCents) current = t;
    }
    return current;
  }

  /** Uyenin guncel rutbe override bps'i (kendi satislarinda ek bonus orani). 0 = yok. */
  async overrideBpsFor(client: Client, tenantId: string, membershipId: string): Promise<number> {
    const tier = await this.resolveTier(client, tenantId, membershipId);
    return tier?.overrideBps ?? 0;
  }

  // ---- admin CRUD ----
  async list(tenantId: string) {
    const custom = await this.prisma.rankTier.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } });
    if (custom.length === 0) {
      return { isDefault: true, tiers: DEFAULT_TIERS.map((t) => ({ id: null, ...t, minEarningsCents: t.minEarningsCents.toString() })) };
    }
    return { isDefault: false, tiers: custom.map((t) => ({ id: t.id, name: t.name, sortOrder: t.sortOrder, minTeam: t.minTeam, minEarningsCents: t.minEarningsCents.toString(), overrideBps: t.overrideBps })) };
  }

  async create(actor: ActorContext, input: { name: string; sortOrder: number; minTeam: number; minEarningsCents: number; overrideBps?: number }) {
    const t = await this.prisma.rankTier.create({
      data: { tenantId: actor.tenantId, name: input.name, sortOrder: input.sortOrder, minTeam: input.minTeam, minEarningsCents: BigInt(input.minEarningsCents), overrideBps: input.overrideBps ?? 0 },
    });
    return { id: t.id };
  }

  async update(actor: ActorContext, id: string, input: { name?: string; sortOrder?: number; minTeam?: number; minEarningsCents?: number; overrideBps?: number }) {
    const t = await this.prisma.rankTier.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!t) throw new NotFoundException('rutbe bulunamadi');
    await this.prisma.rankTier.update({
      where: { id },
      data: {
        name: input.name, sortOrder: input.sortOrder, minTeam: input.minTeam,
        minEarningsCents: input.minEarningsCents === undefined ? undefined : BigInt(input.minEarningsCents),
        overrideBps: input.overrideBps,
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
      overrideBps: current?.overrideBps ?? 0, // bu rutbede kendi satislarinda ek bonus orani
      teamSize,
      earningsCents: String(earnings),
      progress,
      overallPct: progress ? Math.min(progress.teamPct, progress.earningsPct) : 100,
      badges,
    };
  }
}
