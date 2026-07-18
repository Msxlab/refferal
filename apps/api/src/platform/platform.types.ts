import { z } from 'zod';

const PERIOD = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'gecersiz donem (YYYY-MM)');

/** C1: sirket askiya al / aktive et. */
export const setStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
});
export type SetStatusInput = z.infer<typeof setStatusSchema>;

/** C2: billing yapilandirmasi (aylik sabit ucret cent, aktif/pasif, not). */
export const setBillingSchema = z.object({
  monthlyFeeCents: z.number().int().min(0).max(100_000_000),
  active: z.boolean(),
  notes: z.string().trim().max(500).optional().nullable(),
});
export type SetBillingInput = z.infer<typeof setBillingSchema>;

/** C2: tek sirkete fatura kes. */
export const issueInvoiceSchema = z.object({
  period: PERIOD,
  dueInDays: z.number().int().min(0).max(180).optional(),
});
export type IssueInvoiceInput = z.infer<typeof issueInvoiceSchema>;

/** C2: tum aktif sirketlere donem faturasi. */
export const issuePeriodSchema = z.object({
  period: PERIOD,
  dueInDays: z.number().int().min(0).max(180).optional(),
});
export type IssuePeriodInput = z.infer<typeof issuePeriodSchema>;

/** C2: odendi isaretle (cek/havale referansi). */
export const markPaidSchema = z.object({
  note: z.string().trim().max(200).optional(),
});
export type MarkPaidInput = z.infer<typeof markPaidSchema>;
