import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { PrismaService } from '../prisma/prisma.service';
import { CreateViewInput, UpdateViewInput } from './views.types';

@Injectable()
export class ViewsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Hedefe gore gorunumler: kendi (kisisel+paylasilan) + ekibin paylastiklari. */
  async list(tenantId: string, userId: string, target: string) {
    const rows = await this.prisma.savedView.findMany({
      where: { tenantId, target, OR: [{ ownerUserId: userId }, { shared: true }] },
      orderBy: [{ shared: 'asc' }, { name: 'asc' }],
    });
    // paylasilan ve baskasinin olan gorunumler icin sahip adini coz
    const otherOwners = [...new Set(rows.filter((v) => v.ownerUserId !== userId).map((v) => v.ownerUserId))];
    const owners = otherOwners.length
      ? await this.prisma.user.findMany({ where: { id: { in: otherOwners } }, select: { id: true, fullName: true } })
      : [];
    const nameOf = new Map(owners.map((u) => [u.id, u.fullName]));
    return rows.map((v) => ({
      id: v.id,
      name: v.name,
      shared: v.shared,
      config: v.config,
      mine: v.ownerUserId === userId,
      ownerName: v.ownerUserId === userId ? null : nameOf.get(v.ownerUserId) ?? null,
    }));
  }

  async create(actor: ActorContext, input: CreateViewInput) {
    const v = await this.prisma.savedView.create({
      data: {
        tenantId: actor.tenantId,
        ownerUserId: actor.userId,
        target: input.target,
        name: input.name,
        shared: input.shared,
        config: input.config as Prisma.InputJsonValue,
      },
    });
    return { id: v.id, name: v.name, shared: v.shared, config: v.config, mine: true, ownerName: null };
  }

  async update(actor: ActorContext, id: string, input: UpdateViewInput) {
    const v = await this.owned(actor, id);
    const updated = await this.prisma.savedView.update({
      where: { id: v.id },
      data: {
        name: input.name,
        shared: input.shared,
        config: input.config as Prisma.InputJsonValue | undefined,
      },
    });
    return { id: updated.id, name: updated.name, shared: updated.shared, config: updated.config, mine: true, ownerName: null };
  }

  async remove(actor: ActorContext, id: string) {
    const v = await this.owned(actor, id);
    await this.prisma.savedView.delete({ where: { id: v.id } });
    return { deleted: true };
  }

  /** Yalniz sahibi duzenler/siler (paylasilan gorunumu de yalniz sahibi yonetir). */
  private async owned(actor: ActorContext, id: string) {
    const v = await this.prisma.savedView.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!v) throw new NotFoundException('gorunum bulunamadi');
    if (v.ownerUserId !== actor.userId) throw new ForbiddenException('yalnizca gorunumun sahibi duzenleyebilir');
    return v;
  }
}
