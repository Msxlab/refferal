import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Campaign, CampaignStatus, MembershipStatus, Prisma, SaleStatus } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { EngineService } from '../engine/engine.service';
import { monthKey } from '../engine/month';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignInput, UpdateCampaignInput } from './campaigns.types';

export interface Prize { rank: number; bonusCents: number }
export interface Standing {
  rank: number;
  membershipId: string;
  name: string;
  code: string;
  score: number; // metric'e gore: cent (revenue) veya adet
  bonusCents: number; // bu rank'in odulu (prizes'tan)
  inactive?: boolean;
}

const MAX_STANDINGS = 50;

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
  ) {}

  // ------------------------------------------------------------------ CRUD

  async list(tenantId: string) {
    const rows = await this.prisma.campaign.findMany({
      where: { tenantId },
      orderBy: [{ status: 'asc' }, { startsAt: 'desc' }],
    });
    return rows.map((c) => this.serialize(c));
  }

  async create(actor: ActorContext, input: CreateCampaignInput) {
    const c = await this.prisma.campaign.create({
      data: {
        tenantId: actor.tenantId,
        name: input.name,
        description: input.description,
        metric: input.metric,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        prizes: input.prizes,
        createdBy: actor.userId,
      },
    });
    await this.audit(actor, 'campaign.create', c.id, { name: c.name, metric: c.metric });
    return this.serialize(c);
  }

  async update(actor: ActorContext, id: string, input: UpdateCampaignInput) {
    const c = await this.require(actor.tenantId, id);
    if (c.status === CampaignStatus.ended) {
      throw new ConflictException('bitmis kampanya duzenlenemez');
    }
    // tarih/metric/odul yalniz draft iken degistirilebilir; active iken yalniz ad/aciklama/status
    const restricted = input.metric !== undefined || input.startsAt !== undefined || input.endsAt !== undefined || input.prizes !== undefined;
    if (c.status === CampaignStatus.active && restricted) {
      throw new BadRequestException('aktif kampanyada yalniz ad/aciklama degistirilebilir');
    }
    const startsAt = input.startsAt ?? c.startsAt;
    const endsAt = input.endsAt ?? c.endsAt;
    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt, startsAt sonrasinda olmali');
    }
    if (input.prizes && new Set(input.prizes.map((p) => p.rank)).size !== input.prizes.length) {
      throw new BadRequestException('her rank yalnizca bir kez tanimlanabilir');
    }
    const updated = await this.prisma.campaign.update({
      where: { id: c.id },
      data: {
        name: input.name,
        description: input.description,
        metric: input.metric,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        prizes: input.prizes as Prisma.InputJsonValue | undefined,
        status: input.status,
      },
    });
    await this.audit(actor, 'campaign.update', c.id, { status: updated.status });
    return this.serialize(updated);
  }

  async remove(actor: ActorContext, id: string) {
    const c = await this.require(actor.tenantId, id);
    if (c.status !== CampaignStatus.draft) {
      throw new BadRequestException('yalnizca taslak kampanya silinebilir');
    }
    await this.prisma.campaign.delete({ where: { id: c.id } });
    await this.audit(actor, 'campaign.delete', id, { name: c.name });
    return { deleted: true };
  }

  /** Detay: bitmemis kampanyada CANLI siralama, bitmiste donderilen results. */
  async detail(tenantId: string, id: string) {
    const c = await this.require(tenantId, id);
    const standings =
      c.status === CampaignStatus.ended && c.results
        ? (c.results as unknown as Standing[])
        : await this.standings(tenantId, c);
    return { ...this.serialize(c), standings };
  }

  /**
   * Kampanyayi bitir: CANLI siralamayi hesapla, her odullu rank'in sahibine bonus yaz
   * (engine.awardBonus → ledger 'adjustment' payable), kazananlari results'a donder,
   * status=ended. Bitmis kampanya yeniden finalize edilemez (cift odul imkansiz).
   */
  async finalize(actor: ActorContext, id: string) {
    const c = await this.require(actor.tenantId, id);
    return this.doFinalize(actor.tenantId, c, actor.userId);
  }

  /** Finalize cekirdegi — manuel (actor) ve otomatik (scheduler, actorUserId=null) ortak yolu. */
  private async doFinalize(tenantId: string, c: Campaign, actorUserId: string | null) {
    if (c.status === CampaignStatus.ended) {
      throw new ConflictException('kampanya zaten bitirilmis');
    }
    // TEK transaction: ATOMIK claim → odul → results. Manuel finalize ile saatlik
    // auto-finalize cron'u ayni kampanyada yarisirsa yalniz BIRI gecis yapar (cift odul yok).
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const month = monthKey(new Date(), tenant.timezone);

      // Atomik claim: draft/active → ended (finalizedAt simdi). Yalniz GERCEK gecisi
      // yapan satir sayilir; ikinci yarisan icin count=0 → odul yazmadan tx geri alinir.
      const claim = await tx.campaign.updateMany({
        where: { id: c.id, tenantId, status: { in: [CampaignStatus.draft, CampaignStatus.active] } },
        data: { status: CampaignStatus.ended, finalizedAt: new Date() },
      });
      if (claim.count !== 1) {
        throw new ConflictException('kampanya zaten bitirilmis');
      }

      const standings = await this.standings(tenantId, c, tx);

      const awarded: Standing[] = [];
      for (const s of standings) {
        if (s.bonusCents > 0) {
          await this.engine.awardBonus(
            {
              tenantId,
              membershipId: s.membershipId,
              amountCents: BigInt(s.bonusCents),
              month,
              reason: `${c.name} — rank #${s.rank}`,
              actorUserId: actorUserId ?? undefined,
              meta: { campaignId: c.id, rank: s.rank },
            },
            tx, // ayni transaction: claim + bu odul birlikte commit/rollback
          );
          awarded.push(s);
        }
      }

      const updated = await tx.campaign.update({
        where: { id: c.id },
        data: { results: standings as unknown as Prisma.InputJsonValue },
      });
      await tx.auditLog.create({
        data: {
          tenantId, actorUserId, action: actorUserId ? 'campaign.finalize' : 'campaign.auto_finalize', entity: 'campaign', entityId: c.id,
          after: { awardedCount: awarded.length, totalBonusCents: awarded.reduce((a, s) => a + s.bonusCents, 0).toString() } as Prisma.InputJsonValue,
        },
      });
      return { ...this.serialize(updated), standings, awardedCount: awarded.length };
    }, { timeout: 20_000, maxWait: 15_000 });
  }

  /**
   * Dalga 5.2: penceresi BITMIS (endsAt <= now) ama hala 'active' kampanyalari otomatik finalize eder.
   * Boylece endsAt kozmetik olmaktan cikar — scheduler saatlik cagirir. Manuel erken-finalize'i engellemez.
   */
  async autoFinalizeEnded(now: Date = new Date()): Promise<{ finalized: number }> {
    const due = await this.prisma.campaign.findMany({ where: { status: CampaignStatus.active, endsAt: { lte: now } } });
    let finalized = 0;
    for (const c of due) {
      try { await this.doFinalize(c.tenantId, c, null); finalized++; } catch { /* biri patlarsa digerleri devam */ }
    }
    return { finalized };
  }

  // ----------------------------------------------------- uye yuzeyi (app)

  /** Uyenin aktif kampanyalari + kendi sirasi (CANLI). */
  async forMember(tenantId: string, membershipId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { tenantId, status: CampaignStatus.active },
      orderBy: { endsAt: 'asc' },
    });
    const out = [];
    for (const c of campaigns) {
      const standings = await this.standings(tenantId, c);
      const mine = standings.find((s) => s.membershipId === membershipId);
      out.push({
        ...this.serialize(c),
        myRank: mine?.rank ?? null,
        myScore: mine?.score ?? 0,
        leaderboard: standings.slice(0, 5),
      });
    }
    return out;
  }

  // ----------------------------------------------------- siralama hesaplama

  /** Metric'e gore CANLI siralama (pencere [startsAt, endsAt], score desc). */
  private async standings(
    tenantId: string,
    c: { metric: string; startsAt: Date; endsAt: Date; prizes: unknown },
    // finalize claim transaction'i icinden tutarli okuma icin tx gecilebilir; varsayilan canli prisma.
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Standing[]> {
    const prizes = (c.prizes as Prize[] | null) ?? [];
    const bonusByRank = new Map(prizes.map((p) => [p.rank, p.bonusCents]));
    const window = { gte: c.startsAt, lte: c.endsAt };

    let scored: Array<{ membershipId: string; score: number }> = [];
    if (c.metric === 'revenue' || c.metric === 'sales_count') {
      const rows = await db.sale.groupBy({
        by: ['sellerMembershipId'],
        where: { tenantId, status: SaleStatus.approved, saleDate: window },
        _sum: { amountCents: true },
        _count: { _all: true },
      });
      scored = rows.map((r) => ({
        membershipId: r.sellerMembershipId,
        score: c.metric === 'revenue' ? Number(r._sum.amountCents ?? 0n) : r._count._all,
      }));
    } else if (c.metric === 'new_recruits') {
      const rows = await db.membership.groupBy({
        by: ['sponsorMembershipId'],
        where: { tenantId, joinedAt: window, sponsorMembershipId: { not: null } },
        _count: { _all: true },
      });
      scored = rows
        .filter((r) => r.sponsorMembershipId)
        .map((r) => ({ membershipId: r.sponsorMembershipId as string, score: r._count._all }));
    } else {
      // invites
      const rows = await db.invite.groupBy({
        by: ['inviterMembershipId'],
        where: { tenantId, createdAt: window },
        _count: { _all: true },
      });
      scored = rows.map((r) => ({ membershipId: r.inviterMembershipId, score: r._count._all }));
    }

    scored = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, MAX_STANDINGS);
    if (scored.length === 0) return [];

    const members = await db.membership.findMany({
      where: { id: { in: scored.map((s) => s.membershipId) } },
      select: { id: true, referralCode: true, status: true, user: { select: { fullName: true } } },
    });
    const byId = new Map(members.map((m) => [m.id, m]));

    return scored.map((s, i) => {
      const m = byId.get(s.membershipId);
      const rank = i + 1;
      return {
        rank,
        membershipId: s.membershipId,
        name: m?.user.fullName ?? '—',
        code: m?.referralCode ?? '',
        score: s.score,
        bonusCents: bonusByRank.get(rank) ?? 0,
        inactive: m?.status !== MembershipStatus.active,
      } as Standing;
    });
  }

  // ----------------------------------------------------------- internals

  private async require(tenantId: string, id: string) {
    const c = await this.prisma.campaign.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('kampanya bu isletmede bulunamadi');
    return c;
  }

  private serialize(c: {
    id: string; name: string; description: string | null; metric: string;
    startsAt: Date; endsAt: Date; status: string; prizes: unknown; results: unknown;
    finalizedAt: Date | null; createdAt: Date;
  }) {
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      metric: c.metric,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      status: c.status,
      prizes: (c.prizes as Prize[] | null) ?? [],
      finalizedAt: c.finalizedAt,
      createdAt: c.createdAt,
    };
  }

  private async audit(actor: ActorContext, action: string, entityId: string, after: object) {
    await this.prisma.auditLog.create({
      data: { tenantId: actor.tenantId, actorUserId: actor.userId, action, entity: 'campaign', entityId, after },
    });
  }
}
