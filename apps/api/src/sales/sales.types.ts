import { z } from 'zod';

// Tutarlar integer cent. JSON number int guvenli araligi cent icin fazlasiyla yeterli.
const amountCents = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

// ISO tarih/datetime → Date
const saleDate = z.coerce.date();

export const createSaleSchema = z.object({
  // satici ya membership id ya da referral kod ile belirtilir
  sellerMembershipId: z.string().uuid().optional(),
  sellerReferralCode: z.string().trim().min(3).max(32).optional(),
  amountCents,
  saleDate: saleDate.optional(),
  customerRef: z.string().trim().max(200).optional(),
  externalRef: z.string().trim().max(200).optional(),
}).refine((v) => v.sellerMembershipId || v.sellerReferralCode, {
  message: 'sellerMembershipId veya sellerReferralCode gerekli',
  path: ['sellerMembershipId'],
});
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export const listSalesSchema = z.object({
  status: z.enum(['draft', 'approved', 'void']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListSalesInput = z.infer<typeof listSalesSchema>;

export const deliverSchema = z.object({
  deliveredAt: saleDate.optional(),
});
export type DeliverInput = z.infer<typeof deliverSchema>;

// CSV import: header zorunlu. Kolonlar: referral_code,amount_cents,sale_date,customer_ref,external_ref
export const importSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
});
export type ImportInput = z.infer<typeof importSchema>;
