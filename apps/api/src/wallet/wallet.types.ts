import { z } from 'zod';

export const walletQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  // Optional ledger filtreleri — verilmediginde davranis degismez (tum satirlar).
  type: z.enum(['commission', 'reversal', 'adjustment']).optional(),
  status: z.enum(['pending', 'payable', 'paid', 'reversed']).optional(),
});
export type WalletQuery = z.infer<typeof walletQuerySchema>;

export const earningsQuerySchema = z.object({
  // Son N ay (icinde bulunulan ay dahil), tenant timezone'una gore
  months: z.coerce.number().int().min(3).max(12).default(6),
});
export type EarningsQuery = z.infer<typeof earningsQuerySchema>;

export const dashboardQuerySchema = z.object({
  // YYYY-MM; verilmezse tenant timezone'una gore icinde bulunulan ay
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
