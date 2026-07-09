import { z } from 'zod';

const PERIOD = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'gecersiz donem (YYYY-MM)');

/** C1: sirket askiya al / aktive et. */
export const setStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'setup_needed']),
});
export type SetStatusInput = z.infer<typeof setStatusSchema>;

/** C2 + Item 10: billing yapilandirmasi (paket veya aylik sabit ucret cent, aktif/pasif, not). */
export const setBillingSchema = z.object({
  packageId: z.string().uuid().optional(),
  monthlyFeeCents: z.number().int().min(0).max(100_000_000).optional(),
  active: z.boolean(),
  notes: z.string().trim().max(500).optional().nullable(),
}).refine((v) => v.packageId !== undefined || v.monthlyFeeCents !== undefined, { message: 'packageId veya monthlyFeeCents gerekli' });
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

/** Item 11: sirket dizini sayfalama + durum filtresi + serbest arama. */
export const companiesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['active', 'suspended', 'setup_needed']).optional(),
  q: z.string().trim().max(80).optional(),
});
export type CompaniesQuery = z.infer<typeof companiesQuerySchema>;

/** Item 3/6: basit sayfalama query. */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

/** Item 6: platform audit filtre + sayfalama. */
export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().trim().max(64).optional(),
  entity: z.string().trim().max(40).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** Item 2: sirket branding (yalniz #hex ve https URL). */
const HEX = /^#[0-9a-fA-F]{6}$/;
export const brandingSchema = z.object({
  logoUrl: z.string().trim().url().startsWith('https://').max(500).optional().nullable(),
  primaryHex: z.string().trim().regex(HEX, 'gecersiz hex').optional().nullable(),
  accentHex: z.string().trim().regex(HEX, 'gecersiz hex').optional().nullable(),
});
export type BrandingInput = z.infer<typeof brandingSchema>;

/** Item 5: capraz-kiraci arama (min 2 char). */
export const searchQuerySchema = z.object({ q: z.string().trim().max(80).default('') });
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Item 9: platform admin ver (e-posta ile). */
export const grantAdminSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
export type GrantAdminInput = z.infer<typeof grantAdminSchema>;

/** Item 10: billing paket katalogu (Starter/Growth/Enterprise). */
export const createPackageSchema = z.object({
  key: z.string().trim().toLowerCase().min(2).max(40).regex(/^[a-z0-9_]+$/),
  name: z.string().trim().min(2).max(80),
  monthlyFeeCents: z.number().int().min(0).max(100_000_000),
  features: z.record(z.unknown()).default({}),
  limits: z.record(z.unknown()).default({}),
});
export type CreatePackageInput = z.infer<typeof createPackageSchema>;

export const updatePackageSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  monthlyFeeCents: z.number().int().min(0).max(100_000_000).optional(),
  features: z.record(z.unknown()).optional(),
  limits: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
});
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;
