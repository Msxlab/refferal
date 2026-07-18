import { z } from 'zod';
import { BPS_DENOMINATOR, MAX_PLAN_DEPTH, MIN_PLAN_DEPTH } from './constants';

export const planLevelSchema = z.object({
  level: z.number().int().min(0).max(MAX_PLAN_DEPTH - 1),
  rateBps: z.number().int().min(0).max(BPS_DENOMINATOR),
});

export type PlanLevelInput = z.infer<typeof planLevelSchema>;

/**
 * Plan validation (SPEC 3.2): API-layer rule, enforced again in the database
 * by a constraint trigger.
 * - SUM(level_rates) <= pool_rate
 * - all rates >= 0
 * - level 0 (seller) is required
 * - levels cover 0..depth-1 without gaps or duplicates
 */
export const commissionPlanSchema = z
  .object({
    name: z.string().min(1).max(120),
    poolRateBps: z.number().int().min(0).max(BPS_DENOMINATOR),
    depth: z.number().int().min(MIN_PLAN_DEPTH).max(MAX_PLAN_DEPTH),
    levels: z.array(planLevelSchema).min(1),
  })
  .superRefine((plan, ctx) => {
    const sorted = [...plan.levels].sort((a, b) => a.level - b.level);

    const seen = new Set<number>();
    for (const l of plan.levels) {
      if (seen.has(l.level)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `level ${l.level} is duplicated`, path: ['levels'] });
      }
      seen.add(l.level);
    }

    if (!seen.has(0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'level 0 (seller) is required', path: ['levels'] });
    }

    if (sorted.length !== plan.depth || sorted.some((l, i) => l.level !== i)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `levels must cover 0..${plan.depth - 1} without gaps`,
        path: ['levels'],
      });
    }

    const sum = plan.levels.reduce((acc, l) => acc + l.rateBps, 0);
    if (sum > plan.poolRateBps) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `sum of level rates (${sum} bps) cannot exceed pool rate (${plan.poolRateBps} bps)`,
        path: ['levels'],
      });
    }
  });

export type CommissionPlanInput = z.infer<typeof commissionPlanSchema>;
