import { Injectable, NotFoundException } from '@nestjs/common';
import { ActorContext } from '../common/actor';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actor: ActorContext, title: string, body: string) {
    const a = await this.prisma.announcement.create({
      data: { tenantId: actor.tenantId, title, body, createdByUserId: actor.userId },
    });
    return { id: a.id };
  }

  async listAdmin(tenantId: string) {
    const rows = await this.prisma.announcement.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { _count: { select: { reads: true } } },
    });
    return rows.map((a) => ({ id: a.id, title: a.title, body: a.body, reads: a._count.reads, createdAt: a.createdAt }));
  }

  async remove(actor: ActorContext, id: string) {
    await this.prisma.announcement.deleteMany({ where: { id, tenantId: actor.tenantId } });
    return { deleted: true };
  }

  /** Uye: son duyurular + okundu durumu. */
  async listForMember(tenantId: string, membershipId: string) {
    const rows = await this.prisma.announcement.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { reads: { where: { membershipId }, select: { id: true } } },
    });
    return rows.map((a) => ({ id: a.id, title: a.title, body: a.body, createdAt: a.createdAt, read: a.reads.length > 0 }));
  }

  async markRead(tenantId: string, membershipId: string, announcementId: string) {
    // duyuru bu kiracinin mi? — caprazl-tenant okundu makbuzu yazimi engellenir (tenant-scope)
    const a = await this.prisma.announcement.findFirst({ where: { id: announcementId, tenantId }, select: { id: true } });
    if (!a) throw new NotFoundException('duyuru bulunamadi');
    await this.prisma.announcementRead.upsert({
      where: { announcementId_membershipId: { announcementId, membershipId } },
      create: { announcementId, membershipId },
      update: {},
    });
    return { read: true };
  }
}
