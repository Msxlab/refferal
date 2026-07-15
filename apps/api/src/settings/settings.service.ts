import { Injectable } from '@nestjs/common';
import { MaturationRule, Prisma } from '@prisma/client';
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
    const before = await this.prisma.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });

    const updated = await this.prisma.tenant.update({
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

    await this.prisma.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'tenant.update_settings',
        entity: 'tenant',
        entityId: actor.tenantId,
        before: {
          maturationRule: before.maturationRule,
          maturationDays: before.maturationDays,
          payoutMinCents: before.payoutMinCents.toString(),
          timezone: before.timezone,
          notifyNewMemberName: before.notifyNewMemberName,
        },
        after: {
          maturationRule: updated.maturationRule,
          maturationDays: updated.maturationDays,
          payoutMinCents: updated.payoutMinCents.toString(),
          timezone: updated.timezone,
          notifyNewMemberName: updated.notifyNewMemberName,
        },
      },
    });

    return this.get(actor.tenantId);
  }
}
