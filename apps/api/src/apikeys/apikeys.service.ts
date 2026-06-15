import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { randomToken, sha256 } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /** Yeni anahtar: ham deger YALNIZ BIR KEZ doner; DB'de sha256 hash saklanir. */
  async create(params: { tenantId: string; membershipId: string; userId: string; role: Role; name: string }) {
    const raw = `rfk_${randomToken(24)}`;
    const prefix = raw.slice(0, 12);
    const key = await this.prisma.apiKey.create({
      data: {
        tenantId: params.tenantId,
        membershipId: params.membershipId,
        createdByUserId: params.userId,
        role: params.role,
        name: params.name,
        prefix,
        keyHash: sha256(raw),
      },
    });
    await this.audit(params.tenantId, params.userId, 'apikey.create', key.id, { name: params.name });
    return { id: key.id, name: key.name, prefix: key.prefix, key: raw }; // raw yalniz burada
  }

  async list(tenantId: string) {
    const rows = await this.prisma.apiKey.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    return rows.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, role: k.role, lastUsedAt: k.lastUsedAt, expiresAt: k.expiresAt, revokedAt: k.revokedAt, createdAt: k.createdAt }));
  }

  async revoke(tenantId: string, userId: string, id: string) {
    const k = await this.prisma.apiKey.findFirst({ where: { id, tenantId } });
    if (!k) throw new NotFoundException('api anahtari bulunamadi');
    await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit(tenantId, userId, 'apikey.revoke', id, {});
    return { revoked: true };
  }

  // NOT: eski verify() kaldirildi — guard (auth.guard.ts) kendi sorgusunu satir-ici yapiyor;
  // ikinci (sapma riski tasiyan) kopya olu koddu, cagrani yoktu.

  private async audit(tenantId: string, userId: string, action: string, entityId: string, after: object) {
    await this.prisma.auditLog.create({ data: { tenantId, actorUserId: userId, action, entity: 'apikey', entityId, after } });
  }
}
