import { z } from 'zod';

const month = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'must use YYYY-MM format');

export const startPayoutBatchSchema = z.object({
  // If omitted, all current threshold-eligible members are reserved only when the set is <= 100.
  membershipIds: z.array(z.string().uuid()).max(100).optional(),
  period: month.optional(),
  method: z.enum(['manual', 'csv']).default('manual'),
});
export type StartPayoutBatchInput = z.infer<typeof startPayoutBatchSchema>;

// Compatibility contract for the legacy /run endpoint: it now reserves processing only.
export const runPayoutSchema = startPayoutBatchSchema;
export type RunPayoutInput = StartPayoutBatchInput;

export const listPayoutsSchema = z.object({
  status: z.enum(['requested', 'processing', 'paid', 'rejected', 'failed']).optional(),
  period: month.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListPayoutsInput = z.infer<typeof listPayoutsSchema>;

export const exportPayoutsSchema = z.object({
  period: month,
});
export type ExportPayoutsInput = z.infer<typeof exportPayoutsSchema>;

export const approvePayoutRequestSchema = z.object({
  method: z.enum(['manual', 'csv']).default('manual'),
}).default({ method: 'manual' });
export type ApprovePayoutRequestInput = z.infer<typeof approvePayoutRequestSchema>;

export const rejectPayoutRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RejectPayoutRequestInput = z.infer<typeof rejectPayoutRequestSchema>;

export const settlePayoutBatchSchema = z.object({
  settlementReference: z.string().trim().min(1).max(240),
  settlementEvidence: z.string().trim().min(1).max(2000),
});
export type SettlePayoutBatchInput = z.infer<typeof settlePayoutBatchSchema>;

export const failPayoutBatchSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type FailPayoutBatchInput = z.infer<typeof failPayoutBatchSchema>;
