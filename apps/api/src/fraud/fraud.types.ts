import { z } from 'zod';

/** Bu skor ve uzerindeki (cleared olmayan) bayrak payout'u BLOKLAR (riskli komisyon hold'u). */
export const FRAUD_BLOCK_SCORE = 50;

export function fraudPayoutBlock(flag: { status: string; score: number } | null): string | null {
  if (!flag || flag.status === 'cleared') return null;
  if (flag.score >= FRAUD_BLOCK_SCORE) return 'flagged for fraud review';
  return null;
}

export const listFraudSchema = z.object({
  status: z.enum(['open', 'cleared', 'confirmed']).optional(),
});
export type ListFraudInput = z.infer<typeof listFraudSchema>;

export const decideFraudSchema = z.object({
  action: z.enum(['clear', 'confirm']),
  note: z.string().trim().max(500).optional(),
});
export type DecideFraudInput = z.infer<typeof decideFraudSchema>;
