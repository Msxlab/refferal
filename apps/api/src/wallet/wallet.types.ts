import { z } from 'zod';

export const walletQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type WalletQuery = z.infer<typeof walletQuerySchema>;

export const dashboardQuerySchema = z.object({
  // YYYY-MM; verilmezse tenant timezone'una gore icinde bulunulan ay
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
