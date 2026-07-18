import { commissionPlanSchema } from '@refearn/shared';
import { z } from 'zod';

const centsSchema = z
  .union([z.string().trim().regex(/^\d+$/), z.number().int().positive()])
  .transform((v) => String(v));

export const createPlanSchema = commissionPlanSchema.and(
  z.object({
    effectiveFrom: z.coerce.date().optional(),
  }),
);
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

export const simulatePlanSchema = z
  .object({
    amountCents: centsSchema,
    planId: z.string().uuid().optional(),
    plan: commissionPlanSchema.optional(),
    uplineCount: z.coerce.number().int().min(1).max(12).optional(),
  })
  .refine((v) => v.planId || v.plan, {
    message: 'planId veya plan gerekli',
    path: ['planId'],
  });
export type SimulatePlanInput = z.infer<typeof simulatePlanSchema>;
