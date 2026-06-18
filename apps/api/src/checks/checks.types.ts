import { z } from 'zod';

/** Cek-run: hangi payout'lara cek kesilecek. Bos = esik gecmis tum bekleyen cek-payout'lar. */
export const generateRunSchema = z.object({
  payoutIds: z.array(z.string().uuid()).max(1000).optional(),
});
export type GenerateRunInput = z.infer<typeof generateRunSchema>;

/** Postalandi isaretle: hangi cekler postaya verildi (mailedAt set edilir). */
export const markMailedSchema = z.object({
  payoutIds: z.array(z.string().uuid()).min(1).max(1000),
});
export type MarkMailedInput = z.infer<typeof markMailedSchema>;

/** PDF ucu icin: hangi cekler bastirilacak (bos = no atanmis & postalanmamis tum cekler). */
export const checksPdfSchema = z.object({
  payoutIds: z.array(z.string().uuid()).max(1000).optional(),
});
export type ChecksPdfInput = z.infer<typeof checksPdfSchema>;

/** Payout.payeeSnapshot'in sekli — cek kesildigi ANDAki adres (sonra degisse bozulmaz). */
export interface PayeeSnapshot {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postal: string;
  country: string;
}

/** Bir cek-payout'un is durumu (admin kuyrugunda gosterilir). */
export type CheckState = 'needs_address' | 'ready_to_print' | 'printed' | 'mailed';
