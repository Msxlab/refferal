import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeCommissionLines, totalDistributed } from '@refearn/shared';
import { ActorContext } from '../common/actor';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { CreatePlanInput, SimulatePlanInput } from './plans.types';

const EFFECTIVE_FROM_UNIQUE_CONSTRAINT = 'commission_plans_tenant_id_effective_from_key';
const EFFECTIVE_FROM_CONFLICT_MESSAGE = 'a plan already exists for this effectiveFrom value';

function isEffectiveFromUniqueConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  if (target === EFFECTIVE_FROM_UNIQUE_CONSTRAINT) return true;
  if (!Array.isArray(target) || target.length !== 2 || !target.every((field) => typeof field === 'string')) {
    return false;
  }
  const fields = new Set(target as string[]);
  return (
    (fields.has('tenant_id') && fields.has('effective_from')) ||
    (fields.has('tenantId') && fields.has('effectiveFrom'))
  );
}

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(actor: ActorContext) {
    this.tenantContext.assertActor(actor);
    const plans = await this.prisma.commissionPlan.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      include: { levels: { orderBy: { level: 'asc' } } },
    });
    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      poolRateBps: p.poolRateBps,
      depth: p.depth,
      effectiveFrom: p.effectiveFrom,
      createdBy: p.createdBy,
      createdAt: p.createdAt,
      levels: p.levels.map((l) => ({ level: l.level, rateBps: l.rateBps })),
    }));
  }

  async create(actor: ActorContext, input: CreatePlanInput) {
    this.tenantContext.assertActor(actor);
    const effectiveFrom = input.effectiveFrom ?? new Date();
    const existing = await this.prisma.commissionPlan.findFirst({
      where: { tenantId: actor.tenantId, effectiveFrom },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(EFFECTIVE_FROM_CONFLICT_MESSAGE);
    }

    const plan = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.commissionPlan.create({
          data: {
            tenantId: actor.tenantId,
            name: input.name,
            poolRateBps: input.poolRateBps,
            depth: input.depth,
            effectiveFrom,
            createdBy: actor.userId,
            levels: { create: input.levels.map((l) => ({ level: l.level, rateBps: l.rateBps })) },
          },
          include: { levels: { orderBy: { level: 'asc' } } },
        });
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            actorUserId: actor.userId,
            action: 'commission_plan.create',
            entity: 'commission_plan',
            entityId: created.id,
            after: {
              name: created.name,
              poolRateBps: created.poolRateBps,
              depth: created.depth,
              effectiveFrom: created.effectiveFrom.toISOString(),
              levels: created.levels.map((l) => ({ level: l.level, rateBps: l.rateBps })),
            },
          },
        });
        return created;
      })
      .catch((error: unknown) => {
        if (isEffectiveFromUniqueConflict(error)) {
          throw new ConflictException(EFFECTIVE_FROM_CONFLICT_MESSAGE);
        }
        throw error;
      });

    return {
      id: plan.id,
      name: plan.name,
      poolRateBps: plan.poolRateBps,
      depth: plan.depth,
      effectiveFrom: plan.effectiveFrom,
      levels: plan.levels.map((l) => ({ level: l.level, rateBps: l.rateBps })),
    };
  }

  async simulate(actor: ActorContext, input: SimulatePlanInput) {
    this.tenantContext.assertActor(actor);
    const plan = input.planId ? await this.findPlan(actor.tenantId, input.planId) : input.plan;
    if (!plan) throw new NotFoundException('plan not found');

    const amount = BigInt(input.amountCents);
    if (amount <= 0n) throw new BadRequestException('amountCents must be positive');
    const chain = Array.from({ length: input.uplineCount ?? plan.depth }, (_, i) => `level_${i}`);
    const lines = computeCommissionLines(amount, plan.levels, chain);
    const distributed = totalDistributed(lines);
    return {
      amountCents: amount.toString(),
      poolRateBps: plan.poolRateBps,
      depth: plan.depth,
      uplineCount: chain.length,
      distributedCents: distributed.toString(),
      retainedCents: (amount - distributed).toString(),
      lines: lines.map((l) => ({
        level: l.level,
        beneficiary: l.beneficiaryMembershipId,
        rateBps: l.rateBpsUsed,
        amountCents: l.amountCents.toString(),
      })),
    };
  }

  private async findPlan(tenantId: string, planId: string) {
    const plan = await this.prisma.commissionPlan.findFirst({
      where: { id: planId, tenantId },
      include: { levels: { orderBy: { level: 'asc' } } },
    });
    if (!plan) return null;
    return {
      name: plan.name,
      poolRateBps: plan.poolRateBps,
      depth: plan.depth,
      levels: plan.levels.map((l) => ({ level: l.level, rateBps: l.rateBps })),
    };
  }
}
