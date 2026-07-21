import { z } from 'zod';

// Amounts are integer cents. JSON safe integers are ample for cent values.
const amountCents = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

// ISO date/datetime -> Date.
const saleDate = z.coerce.date();

export const createSaleSchema = z.object({
  // Seller can be identified by membership id or referral code.
  sellerMembershipId: z.string().uuid().optional(),
  sellerReferralCode: z.string().trim().min(3).max(32).optional(),
  amountCents,
  saleDate: saleDate.optional(),
  customerRef: z.string().trim().max(200).optional(),
  externalRef: z.string().trim().max(200).optional(),
}).refine((v) => v.sellerMembershipId || v.sellerReferralCode, {
  message: 'sellerMembershipId or sellerReferralCode is required',
  path: ['sellerMembershipId'],
});
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

// Ortak filtre seti: liste + summary + export ayni paramlari paylasir (page'siz).
export const salesFilterSchema = z.object({
  status: z.enum(['draft', 'approved', 'void']).optional(),
  summaryMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  // Free search: seller name/code plus customer_ref/external_ref.
  q: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  minCents: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  maxCents: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});
export type SalesFilterInput = z.infer<typeof salesFilterSchema>;

export const listSalesSchema = salesFilterSchema.extend({
  sort: z.enum(['saleDate', 'amountCents', 'status', 'createdAt']).default('saleDate'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict().superRefine((value, ctx) => {
  if (value.from && value.to && value.from > value.to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['from'],
      message: 'from must be before or equal to to',
    });
  }
  if (value.minCents !== undefined && value.maxCents !== undefined && value.minCents > value.maxCents) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['minCents'],
      message: 'minCents must be less than or equal to maxCents',
    });
  }
});
export type ListSalesInput = z.infer<typeof listSalesSchema>;

export const bulkActionSchema = z.enum(['approve', 'void']);
export type BulkAction = z.infer<typeof bulkActionSchema>;

export const bulkScopeSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('selected'),
    ids: z.array(z.string().uuid()).min(1).max(200),
  }).strict(),
  z.object({
    mode: z.literal('all-results'),
    filters: listSalesSchema,
  }).strict(),
]);
export type BulkScope = z.infer<typeof bulkScopeSchema>;

export const previewBulkSchema = z.object({
  action: bulkActionSchema,
  scope: bulkScopeSchema,
}).strict();
export type PreviewBulkInput = z.infer<typeof previewBulkSchema>;

export const confirmBulkSchema = z.object({
  scope: bulkScopeSchema,
  previewToken: z.string().min(32).max(4096),
}).strict();
export type ConfirmBulkInput = z.infer<typeof confirmBulkSchema>;

export type BulkPreviewTotal = { currency: string; amountCents: string };

export type BulkPreview = {
  previewToken: string;
  expiresAt: string;
  action: BulkAction;
  eligibleCount: number;
  excludedCount: number;
  totals: BulkPreviewTotal[];
};

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

// CSV import wizard: column mapping by header name plus preview dry-run support.
// If mapping is omitted, amount is preferred; legacy amount_cents/cents still parse as integer cents.
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
