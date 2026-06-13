import { Injectable, NotFoundException } from '@nestjs/common';
import { PayoutProfileStatus, Prisma } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertProfileInput } from './kyc.types';

@Injectable()
export class KycService {
  constructor(private readonly prisma: PrismaService) {}

  /** Uye kendi profili (maskeli). Yoksa null. */
  async mine(membershipId: string) {
    const p = await this.prisma.payoutProfile.findUnique({ where: { membershipId } });
    return p ? this.serialize(p) : null;
  }

  /**
   * Profil olustur/guncelle (uye). TAM TIN/hesap no SAKLANMAZ — yalniz son-4.
   * Her degisiklik durumu pending_review'a alir, lastChangedAt'i tazeler (soguma sayaci).
   */
  async upsert(actor: ActorContext, membershipId: string, input: UpsertProfileInput) {
    const taxIdLast4 = input.taxId.slice(-4);
    const accountLast4 = input.accountNumber.slice(-4);
    const now = new Date();
    const data = {
      legalName: input.legalName,
      country: input.country,
      taxIdType: input.taxIdType,
      taxIdLast4,
      bankName: input.bankName,
      routingNumber: input.routingNumber,
      accountType: input.accountType,
      accountLast4,
      status: PayoutProfileStatus.pending_review,
      rejectionReason: null,
      reviewedByUserId: null,
      reviewedAt: null,
      lastChangedAt: now,
    };
    const p = await this.prisma.payoutProfile.upsert({
      where: { membershipId },
      create: { tenantId: actor.tenantId, membershipId, ...data },
      update: data,
    });
    await this.audit(actor, 'kyc.submit', p.id, { membershipId, status: p.status });
    return this.serialize(p);
  }

  /** Admin inceleme kuyrugu (durum filtreli) + uye adi/kodu. */
  async list(tenantId: string, status?: PayoutProfileStatus) {
    const rows = await this.prisma.payoutProfile.findMany({
      where: { tenantId, status },
      orderBy: { lastChangedAt: 'asc' },
      include: { membership: { select: { referralCode: true, user: { select: { fullName: true, email: true } } } } },
    });
    return rows.map((p) => ({
      ...this.serialize(p),
      membershipId: p.membershipId,
      fullName: p.membership.user.fullName,
      email: p.membership.user.email,
      referralCode: p.membership.referralCode,
    }));
  }

  /** Admin karari: verify | reject (audit'li). */
  async decide(actor: ActorContext, membershipId: string, action: 'verify' | 'reject', reason?: string) {
    const p = await this.prisma.payoutProfile.findUnique({ where: { membershipId } });
    if (!p || p.tenantId !== actor.tenantId) throw new NotFoundException('odeme profili bulunamadi');
    const status = action === 'verify' ? PayoutProfileStatus.verified : PayoutProfileStatus.rejected;
    const updated = await this.prisma.payoutProfile.update({
      where: { membershipId },
      data: {
        status,
        rejectionReason: action === 'reject' ? reason ?? 'rejected' : null,
        reviewedByUserId: actor.userId,
        reviewedAt: new Date(),
      },
    });
    await this.audit(actor, action === 'verify' ? 'kyc.verify' : 'kyc.reject', p.id, { membershipId, reason: reason ?? null });
    return this.serialize(updated);
  }

  private serialize(p: {
    legalName: string; country: string; taxIdType: string; taxIdLast4: string;
    bankName: string | null; routingNumber: string; accountType: string; accountLast4: string;
    status: string; rejectionReason: string | null; lastChangedAt: Date; reviewedAt: Date | null;
  }) {
    return {
      legalName: p.legalName,
      country: p.country,
      taxIdType: p.taxIdType,
      taxIdLast4: p.taxIdLast4,
      bankName: p.bankName,
      routingNumber: p.routingNumber,
      accountType: p.accountType,
      accountLast4: p.accountLast4,
      status: p.status,
      rejectionReason: p.rejectionReason,
      lastChangedAt: p.lastChangedAt,
      reviewedAt: p.reviewedAt,
    };
  }

  private async audit(actor: ActorContext, action: string, entityId: string, after: object) {
    await this.prisma.auditLog.create({
      data: { tenantId: actor.tenantId, actorUserId: actor.userId, action, entity: 'kyc', entityId, after: after as Prisma.InputJsonValue },
    });
  }
}
