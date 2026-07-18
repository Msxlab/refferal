import { z } from 'zod';

export const simulatePlanSchema = z.object({
  amountCents: z.number().int().positive(),
  sellerMembershipId: z.string().uuid().optional(),
});
export type SimulatePlanInput = z.infer<typeof simulatePlanSchema>;

/** Yeni plan VERSIYONU (effective_from ileri tarihli). Derin capraz kurallar serviste
 *  @refearn/shared commissionPlanSchema ile ikinci kez dogrulanir. */
export const createPlanSchema = z.object({
  name: z.string().trim().min(1).max(120),
  poolRateBps: z.number().int().min(0).max(10_000),
  depth: z.number().int().min(1).max(20),
  levels: z.array(z.object({ level: z.number().int().min(0).max(19), rateBps: z.number().int().min(0).max(10_000) })).min(1),
  fastStartBps: z.number().int().min(0).max(10_000).optional(),
  fastStartDays: z.number().int().min(0).max(3650).optional(),
  matchingBps: z.number().int().min(0).max(10_000).optional(),
  effectiveFrom: z.string().datetime().optional(),
});
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
