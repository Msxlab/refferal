import { Injectable } from '@nestjs/common';
import { MaturationRule, Prisma, type Tenant } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { PlansService } from '../plans/plans.service';
import { PrismaService } from '../prisma/prisma.service';

export interface UpdateSettingsInput {
  maturationRule?: MaturationRule;
  maturationDays?: number | null;
  payoutMinCents?: bigint;
  timezone?: string;
  notifyNewMemberName?: boolean;
  compressionEnabled?: boolean;
  inactiveMembersEarn?: boolean;
  requireSeparateApprover?: boolean;
  requireKycForPayout?: boolean;
  requirePayoutApproval?: boolean;
  autoRequestPayouts?: boolean;
  branding?: Prisma.InputJsonValue;
}

type SettingsAuditSource = Pick<
  Tenant,
  | 'maturationRule'
  | 'maturationDays'
  | 'payoutMinCents'
  | 'timezone'
  | 'notifyNewMemberName'
  | 'compressionEnabled'
  | 'inactiveMembersEarn'
  | 'requireSeparateApprover'
  | 'requireKycForPayout'
  | 'requirePayoutApproval'
  | 'autoRequestPayouts'
  | 'branding'
>;

function settingsAuditSnapshot(tenant: SettingsAuditSource) {
  return {
    maturationRule: tenant.maturationRule,
    maturationDays: tenant.maturationDays,
    payoutMinCents: tenant.payoutMinCents.toString(),
    timezone: tenant.timezone,
    notifyNewMemberName: tenant.notifyNewMemberName,
    compressionEnabled: tenant.compressionEnabled,
    inactiveMembersEarn: tenant.inactiveMembersEarn,
    requireSeparateApprover: tenant.requireSeparateApprover,
    requireKycForPayout: tenant.requireKycForPayout,
    requirePayoutApproval: tenant.requirePayoutApproval,
    autoRequestPayouts: tenant.autoRequestPayouts,
    branding: tenant.branding,
  };
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
  ) {}

  async get(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return {
      slug: t.slug,
      name: t.name,
      currency: t.currency,
      timezone: t.timezone,
      maturationRule: t.maturationRule,
      maturationDays: t.maturationDays,
      payoutMinCents: t.payoutMinCents.toString(),
      notifyNewMemberName: t.notifyNewMemberName,
      compressionEnabled: t.compressionEnabled,
      inactiveMembersEarn: t.inactiveMembersEarn,
      requireSeparateApprover: t.requireSeparateApprover,
      requireKycForPayout: t.requireKycForPayout,
      requirePayoutApproval: t.requirePayoutApproval,
      autoRequestPayouts: t.autoRequestPayouts,
      branding: t.branding,
    };
  }

  /** Aktif komisyon planinin bonus katmanlari (MLM unilevel+). */
  async getPlanBonus(tenantId: string) {
    return this.plans.getPlanBonus(tenantId);
  }

  async updatePlanBonus(actor: ActorContext, input: { fastStartBps: number; fastStartDays: number; matchingBps: number }) {
    return this.plans.createBonusVersion(actor, input);
  }

  async update(actor: ActorContext, input: UpdateSettingsInput) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });

      const updated = await tx.tenant.update({
        where: { id: actor.tenantId },
        data: {
          maturationRule: input.maturationRule,
          maturationDays: input.maturationDays === undefined ? undefined : input.maturationDays,
          payoutMinCents: input.payoutMinCents,
          timezone: input.timezone,
          notifyNewMemberName: input.notifyNewMemberName,
          compressionEnabled: input.compressionEnabled,
          inactiveMembersEarn: input.inactiveMembersEarn,
          requireSeparateApprover: input.requireSeparateApprover,
          requireKycForPayout: input.requireKycForPayout,
          requirePayoutApproval: input.requirePayoutApproval,
          autoRequestPayouts: input.autoRequestPayouts,
          // kismi guncelleme tum kolonu ezmesin: mevcut branding ile birlestir
          branding:
            input.branding === undefined
              ? undefined
              : ({ ...((before.branding as Record<string, unknown>) ?? {}), ...(input.branding as Record<string, unknown>) } as Prisma.InputJsonValue),
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: 'tenant.update_settings',
          entity: 'tenant',
          entityId: actor.tenantId,
          before: settingsAuditSnapshot(before),
          after: settingsAuditSnapshot(updated),
        },
      });
    });

    return this.get(actor.tenantId);
  }
}
