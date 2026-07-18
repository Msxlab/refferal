import { ConflictException, Injectable } from '@nestjs/common';
import { Membership, Prisma, Role } from '@prisma/client';
import { ltreeLabel, newUuid, randomCode } from '../common/crypto';
import { InviteConsentSnapshot } from '../invites/invite-consent';

type Tx = Prisma.TransactionClient;
type CreateUnderParams = {
  tenantId: string;
  userId: string;
  sponsor: Pick<Membership, 'id' | 'path' | 'depth' | 'tenantId'>;
  role?: Role;
};

@Injectable()
export class MembershipsService {
  /**
   * Places a new membership under the sponsor (SPEC 6):
   * path = parent.path || own_id, and placement is immutable, also protected by a DB trigger.
   * id is generated client-side so path is written correctly in one INSERT.
   */
  async createUnder(
    tx: Tx,
    params: CreateUnderParams,
  ): Promise<Membership> {
    if (params.sponsor.tenantId !== params.tenantId) {
      throw new ConflictException('sponsor belongs to another tenant');
    }

    const id = newUuid();
    const path = `${params.sponsor.path}.${ltreeLabel(id)}`;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await tx.membership.create({
          data: {
            id,
            tenantId: params.tenantId,
            userId: params.userId,
            role: params.role ?? Role.member,
            sponsorMembershipId: params.sponsor.id,
            referralCode: randomCode(8),
            depth: params.sponsor.depth + 1,
            path,
          },
        });
      } catch (e) {
        // Retry referral_code collisions; rethrow other unique violations.
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          Array.isArray(e.meta?.target) &&
          (e.meta.target as string[]).includes('referral_code')
        ) {
          continue;
        }
        throw e;
      }
    }
    throw new ConflictException('could not generate referral code');
  }

  async createUnderWithInviteConsent(
    tx: Tx,
    params: CreateUnderParams & { inviteId: string; consent: InviteConsentSnapshot },
  ): Promise<Membership> {
    const membership = await this.createUnder(tx, params);
    await tx.inviteAcceptanceConsent.create({
      data: {
        inviteId: params.inviteId,
        tenantId: membership.tenantId,
        userId: membership.userId,
        membershipId: membership.id,
        disclaimerVersion: params.consent.disclaimerVersion,
        locale: params.consent.locale,
        disclaimerContentHash: params.consent.disclaimerContentHash,
        tenantDisplayName: params.consent.tenantDisplayName,
        programSummary: params.consent.programSummary,
        programSummaryHash: params.consent.programSummaryHash,
        acceptedAt: params.consent.acceptedAt,
      },
    });
    return membership;
  }
}
