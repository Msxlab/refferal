import { ConflictException, Injectable } from '@nestjs/common';
import { Membership, Prisma, Role } from '@prisma/client';
import { ltreeLabel, newUuid, randomCode } from '../common/crypto';

type Tx = Prisma.TransactionClient;

@Injectable()
export class MembershipsService {
  /**
   * Sponsor altina yeni uyelik yerlestirir (SPEC 6):
   * path = parent.path || own_id, yerlesim DEGISTIRILEMEZ (DB trigger'i da korur).
   * id istemci tarafinda uretilir ki path tek INSERT'te dogru yazilsin.
   */
  async createUnder(
    tx: Tx,
    params: {
      tenantId: string;
      userId: string;
      sponsor: Pick<Membership, 'id' | 'path' | 'depth' | 'tenantId'>;
      role?: Role;
    },
  ): Promise<Membership> {
    if (params.sponsor.tenantId !== params.tenantId) {
      throw new ConflictException('sponsor baska bir tenantta');
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
        // referral_code carpismasi: yeniden dene; baska unique ihlali yukari firlat
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
    throw new ConflictException('referral kodu uretilemedi');
  }
}
