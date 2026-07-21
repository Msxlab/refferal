import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PayoutProfileStatus, Prisma } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { SecretCipher } from '../common/secret-cipher';
import { PrismaService } from '../prisma/prisma.service';
import { lockPayoutRiskState } from '../payouts/payout-risk-lock';
import { SanctionsService } from '../sanctions/sanctions.service';
import { UpsertProfileInput } from './kyc.types';

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sanctions: SanctionsService,
    private readonly secretCipher: SecretCipher,
  ) {}

  /** Uye kendi profili (maskeli). Yoksa null. */
  async mine(membershipId: string) {
    const p = await this.prisma.payoutProfile.findUnique({ where: { membershipId } });
    return p ? this.serialize(p) : null;
  }

  /**
   * Profil olustur/guncelle (uye). Tam vergi kimligi saklanmaz; yalniz son-4 tutulur.
   * Tam hesap no, self-hosted ACH icin yalniz encrypted-at-rest olarak saklanir.
   * Her degisiklik durumu pending_review'a alir, lastChangedAt'i tazeler (soguma sayaci).
   */
  async upsert(actor: ActorContext, membershipId: string, input: UpsertProfileInput) {
    const taxIdLast4 = input.taxId.slice(-4);
    const accountLast4 = input.accountNumber.slice(-4);
    const now = new Date();
    const accountEnc = await this.secretCipher.encrypt(input.accountNumber, {
      purpose: 'payout-account',
      tenantId: actor.tenantId,
      recordId: membershipId,
    });
    const p = await this.prisma.$transaction(async (tx) => {
      await lockPayoutRiskState(tx);
      const sanctionsHit = await this.sanctions.isHit(input.legalName); // OFAC/AML taramasi (#10)
      const data = {
        legalName: input.legalName,
        country: input.country,
        taxIdType: input.taxIdType,
        taxIdLast4,
        bankName: input.bankName,
        routingNumber: input.routingNumber,
        accountType: input.accountType,
        accountLast4,
        accountEnc,
        status: PayoutProfileStatus.pending_review,
        rejectionReason: null,
        reviewedByUserId: null,
        reviewedAt: null,
        sanctionsHit,
        lastChangedAt: now,
      };
      const profile = await tx.payoutProfile.upsert({
        where: { membershipId },
        create: { tenantId: actor.tenantId, membershipId, ...data },
        update: data,
      });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: 'kyc.submit',
          entity: 'kyc',
          entityId: profile.id,
          after: { membershipId, status: profile.status } as Prisma.InputJsonValue,
        },
      });
      return profile;
    });
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
    const result = await this.prisma.$transaction(async (tx) => {
      await lockPayoutRiskState(tx);
      const p = await tx.payoutProfile.findUnique({ where: { membershipId } });
      if (!p || p.tenantId !== actor.tenantId) throw new NotFoundException('odeme profili bulunamadi');
      // verify aninda CANLI yeniden tara: submit'ten sonra listeye girmis bir ad onayda yakalanir
      if (action === 'verify' && (await this.sanctions.isHit(p.legalName))) {
        if (!p.sanctionsHit) {
          await tx.payoutProfile.update({ where: { membershipId }, data: { sanctionsHit: true } });
        }
        return { blocked: true as const };
      }
      const status = action === 'verify' ? PayoutProfileStatus.verified : PayoutProfileStatus.rejected;
      const updated = await tx.payoutProfile.update({
        where: { membershipId },
        data: {
          status,
          rejectionReason: action === 'reject' ? reason ?? 'rejected' : null,
          reviewedByUserId: actor.userId,
          reviewedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: action === 'verify' ? 'kyc.verify' : 'kyc.reject',
          entity: 'kyc',
          entityId: p.id,
          after: { membershipId, reason: reason ?? null } as Prisma.InputJsonValue,
        },
      });
      return { blocked: false as const, updated };
    });
    if (result.blocked) {
      throw new ConflictException('sanctions match (compliance review) - verify edilemez');
    }
    return this.serialize(result.updated);
  }

  private serialize(p: {
    legalName: string; country: string; taxIdType: string; taxIdLast4: string;
    bankName: string | null; routingNumber: string; accountType: string; accountLast4: string;
    status: string; rejectionReason: string | null; lastChangedAt: Date; reviewedAt: Date | null;
    sanctionsHit?: boolean;
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
      sanctionsHit: p.sanctionsHit ?? false,
      lastChangedAt: p.lastChangedAt,
      reviewedAt: p.reviewedAt,
    };
  }

}
