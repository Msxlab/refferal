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

// Ortak filtre seti: liste + summary + export ayni paramlari paylasir (page'siz).
export const salesFilterSchema = z.object({
  status: z.enum(['draft', 'approved', 'void']).optional(),
  // serbest arama: satici adi/kodu + customer_ref/external_ref
  q: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  minCents: z.coerce.number().int().min(0).optional(),
  maxCents: z.coerce.number().int().min(0).optional(),
});
export type SalesFilterInput = z.infer<typeof salesFilterSchema>;

export const listSalesSchema = salesFilterSchema.extend({
  sort: z.enum(['saleDate', 'amountCents', 'status', 'createdAt']).default('saleDate'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListSalesInput = z.infer<typeof listSalesSchema>;

export const bulkSchema = z.object({
  action: z.enum(['approve', 'void', 'delete', 'deliver']),
  ids: z.array(z.string().uuid()).min(1).max(200),
});
export type BulkInput = z.infer<typeof bulkSchema>;

// Uye self-servis satis girisi (app/sales): satici = aktif uyelik (mid), satici secimi yok.
export const selfCreateSaleSchema = z.object({
  amountCents,
  saleDate: saleDate.optional(),
  customerRef: z.string().trim().max(200).optional(),
});
export type SelfCreateSaleInput = z.infer<typeof selfCreateSaleSchema>;

// Uyenin kendi satis listesi (app/sales)
export const listMySalesSchema = z.object({
  status: z.enum(['draft', 'approved', 'void']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListMySalesInput = z.infer<typeof listMySalesSchema>;

export const deliverSchema = z.object({
  deliveredAt: saleDate.optional(),
});
export type DeliverInput = z.infer<typeof deliverSchema>;

// CSV import sihirbazi: kolon eslemesi (baslik adlari) + preview (dry-run) destegi.
// mapping verilmezse varsayilan basliklar kullanilir (referral_code, amount_cents, ...).
export const importMappingSchema = z.object({
  code: z.string().trim().min(1),
  amount: z.string().trim().min(1),
  date: z.string().trim().optional(),
  customer: z.string().trim().optional(),
  external: z.string().trim().optional(),
});
export type ImportMapping = z.infer<typeof importMappingSchema>;

export const importSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  mapping: importMappingSchema.optional(),
  preview: z.boolean().optional(),
});
export type ImportInput = z.infer<typeof importSchema>;
