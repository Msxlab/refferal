import { z } from 'zod';

const month = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'YYYY-MM formatinda olmali');

export const runPayoutSchema = z.object({
  // belirtilmezse esigi gecen TUM uyeler odenir
  membershipIds: z.array(z.string().uuid()).max(1000).optional(),
  period: month.optional(),
  method: z.enum(['manual', 'csv']).default('manual'),
});
export type RunPayoutInput = z.infer<typeof runPayoutSchema>;

export const listPayoutsSchema = z.object({
  status: z.enum(['requested', 'processing', 'paid', 'rejected', 'failed']).optional(),
  period: month.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListPayoutsInput = z.infer<typeof listPayoutsSchema>;

export const exportPayoutsSchema = z.object({
  period: month.optional(),
});
export type ExportPayoutsInput = z.infer<typeof exportPayoutsSchema>;

export const approvePayoutRequestSchema = z.object({
  method: z.enum(['manual', 'csv']).default('manual'),
}).default({ method: 'manual' });
export type ApprovePayoutRequestInput = z.infer<typeof approvePayoutRequestSchema>;

export const rejectPayoutRequestSchema = z.object({
  reason: z.string().trim().max(180).optional(),
}).default({});
export type RejectPayoutRequestInput = z.infer<typeof rejectPayoutRequestSchema>;
