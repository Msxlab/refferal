import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PackagesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.billingPackage.findMany({ orderBy: { monthlyFeeCents: 'asc' } });
    return rows.map((p) => this.serialize(p));
  }

  async create(actorUserId: string, input: { key: string; name: string; monthlyFeeCents: number; features: object; limits: object }) {
    const exists = await this.prisma.billingPackage.findUnique({ where: { key: input.key }, select: { id: true } });
    if (exists) throw new BadRequestException('bu key zaten var');
    const pkg = await this.prisma.billingPackage.create({
      data: {
        key: input.key, name: input.name, monthlyFeeCents: BigInt(input.monthlyFeeCents),
        features: input.features as Prisma.InputJsonValue, limits: input.limits as Prisma.InputJsonValue,
      },
    });
    await this.audit(actorUserId, 'platform.package_created', pkg.id, { key: pkg.key });
    return this.serialize(pkg);
  }

  async update(actorUserId: string, id: string, input: Partial<{ name: string; monthlyFeeCents: number; features: object; limits: object; active: boolean }>) {
    const exists = await this.prisma.billingPackage.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('paket bulunamadi');
    const pkg = await this.prisma.billingPackage.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.monthlyFeeCents !== undefined ? { monthlyFeeCents: BigInt(input.monthlyFeeCents) } : {}),
        ...(input.features !== undefined ? { features: input.features as Prisma.InputJsonValue } : {}),
        ...(input.limits !== undefined ? { limits: input.limits as Prisma.InputJsonValue } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    await this.audit(actorUserId, 'platform.package_updated', id, { name: pkg.name });
    return this.serialize(pkg);
  }

  /** Soft-delete: referans varsa active=false; referans yoksa yine soft (hard-delete asla). */
  async softDelete(actorUserId: string, id: string) {
    const exists = await this.prisma.billingPackage.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('paket bulunamadi');
    const pkg = await this.prisma.billingPackage.update({ where: { id }, data: { active: false } });
    await this.audit(actorUserId, 'platform.package_deactivated', id, {});
    return this.serialize(pkg);
  }

  /** MRR = active billing config'lerin monthlyFeeCents toplami (BigInt → string). */
  async mrr() {
    const rows = await this.prisma.tenantBilling.findMany({ where: { active: true }, select: { monthlyFeeCents: true } });
    const total = rows.reduce((a, r) => a + r.monthlyFeeCents, 0n);
    return { mrrCents: total.toString(), activeCount: rows.length };
  }

  private serialize(p: { id: string; key: string; name: string; monthlyFeeCents: bigint; features: unknown; limits: unknown; active: boolean }) {
    return { id: p.id, key: p.key, name: p.name, monthlyFeeCents: p.monthlyFeeCents.toString(), features: p.features, limits: p.limits, active: p.active };
  }

  private async audit(actorUserId: string, action: string, entityId: string, after: object) {
    await this.prisma.auditLog.create({ data: { tenantId: null, actorUserId, action, entity: 'billing_package', entityId, after: after as Prisma.InputJsonValue } });
  }
}
