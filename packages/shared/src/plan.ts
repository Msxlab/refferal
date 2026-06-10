import { z } from 'zod';
import { BPS_DENOMINATOR, MAX_PLAN_DEPTH, MIN_PLAN_DEPTH } from './constants';

export const planLevelSchema = z.object({
  level: z.number().int().min(0).max(MAX_PLAN_DEPTH - 1),
  rateBps: z.number().int().min(0).max(BPS_DENOMINATOR),
});

export type PlanLevelInput = z.infer<typeof planLevelSchema>;

/**
 * Plan dogrulamasi (SPEC 3.2) — API katmani kurali; ayni kural DB'de
 * constraint trigger ile ikinci kez zorlanir:
 * - SUM(level_rates) <= pool_rate
 * - tum oranlar >= 0
 * - level 0 (satici) zorunlu
 * - level'lar 0..depth-1 araliginda, bossuz ve tekrarsiz
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
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `level ${l.level} tekrarlanmis`, path: ['levels'] });
      }
      seen.add(l.level);
    }

    if (!seen.has(0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'level 0 (satici) zorunlu', path: ['levels'] });
    }

    if (sorted.length !== plan.depth || sorted.some((l, i) => l.level !== i)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `levels 0..${plan.depth - 1} araligini bossuz kapsamali`,
        path: ['levels'],
      });
    }

    const sum = plan.levels.reduce((acc, l) => acc + l.rateBps, 0);
    if (sum > plan.poolRateBps) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `seviye oranlari toplami (${sum} bps) havuz oranini (${plan.poolRateBps} bps) asamaz`,
        path: ['levels'],
      });
    }
  });

export type CommissionPlanInput = z.infer<typeof commissionPlanSchema>;
