import { z } from 'zod';
import { HIERARCHY_TOKEN_MAX_LENGTH } from '../members/network-hierarchy.tokens';

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
  // YYYY-MM; defaults to the current month in the tenant timezone when omitted.
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

const canonicalHierarchySnapshot = z
  .string()
  .max(40)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    'snapshotAt must be a canonical ISO timestamp',
  );

const opaqueMemberHierarchyReference = z
  .string()
  .min(1)
  .max(HIERARCHY_TOKEN_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);

/** Strict public member tree query: no caller-controlled root, depth, or focus. */
export const memberTreeChildrenQuerySchema = z
  .object({
    parentRef: opaqueMemberHierarchyReference,
    cursor: opaqueMemberHierarchyReference.optional(),
    snapshotAt: canonicalHierarchySnapshot,
  })
  .strict();
export type MemberTreeChildrenQuery = z.infer<
  typeof memberTreeChildrenQuerySchema
>;

/** Body-only direct-recruit search; its cursor carries the snapshot binding. */
export const memberTreeDirectSearchSchema = z
  .object({
    query: z.string().trim().min(2).max(120),
    cursor: opaqueMemberHierarchyReference.optional(),
  })
  .strict();
export type MemberTreeDirectSearchInput = z.infer<
  typeof memberTreeDirectSearchSchema
>;
