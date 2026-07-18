import { z } from 'zod';

export const payoutComplianceKeySchema = z.enum(['address', 'kyc', 'fraud', 'sanctions', 'payment_method']);
export type PayoutComplianceKeyInput = z.infer<typeof payoutComplianceKeySchema>;

const MAX_EXPECTED_VERSION = 2_147_483_646;
const expectedVersion = z.number().int().min(0).max(MAX_EXPECTED_VERSION);
const isoDateTime = z.string().datetime({ offset: true });
const ASSIGNED_ISO_3166_ALPHA_2 = new Set(
  `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(' '),
);
const ASSIGNED_ISO_4217 = new Set(
  `AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VES VND VUV WST XAD XAF XAG XAU XBA XBB XBC XBD XCD XCG XDR XOF XPD XPF XPT XSU XTS XUA XXX YER ZAR ZMW ZWG`.split(' '),
);

export const payoutComplianceDecisionSchema = z.object({
  status: z.enum(['ready', 'blocked']),
  reasonCode: z.string().regex(/^[a-z0-9_:-]{2,80}$/, 'must be a controlled lowercase identifier'),
  expiresAt: isoDateTime.nullish(),
  expectedVersion,
});
export type PayoutComplianceDecisionInput = z.infer<typeof payoutComplianceDecisionSchema>;

export const payoutDestinationSchema = z.object({
  providerReference: z.string().trim().min(1).max(500),
  last4: z.string().regex(/^\d{4}$/).nullable().optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, 'must be an ISO-3166 alpha-2 code')
    .refine((value) => ASSIGNED_ISO_3166_ALPHA_2.has(value), 'must be an assigned ISO-3166 alpha-2 code'),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'must be an ISO-4217 alpha-3 code')
    .refine((value) => ASSIGNED_ISO_4217.has(value), 'must be an assigned ISO-4217 alpha-3 code'),
  verifiedAt: isoDateTime,
  expectedVersion,
});
export type PayoutDestinationInput = z.infer<typeof payoutDestinationSchema>;

const month = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'must use YYYY-MM format');

export const payoutScopeSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('selected'),
    membershipIds: z.array(z.string().uuid()).min(1).max(100),
  }),
  z.object({
    mode: z.literal('all_eligible'),
    filters: z.object({
      period: month.optional(),
      method: z.enum(['manual', 'csv']),
    }),
  }),
]);
export type PayoutScope = z.infer<typeof payoutScopeSchema>;

export const previewPayoutBatchSchema = z.object({ scope: payoutScopeSchema });
export type PreviewPayoutBatchInput = z.infer<typeof previewPayoutBatchSchema>;

export const startPayoutBatchSchema = z.object({
  scope: payoutScopeSchema,
  previewToken: z.string().min(32),
});
export type StartPayoutBatchInput = z.infer<typeof startPayoutBatchSchema>;

export type PayoutBatchPreview = {
  previewToken: string;
  expiresAt: string;
  eligibleCount: number;
  excludedCount: number;
  totals: Array<{ currency: string; amountCents: string }>;
  normalizedScope: PayoutScope;
};

// Compatibility contract for the legacy /run endpoint: it now reserves processing only.
export const runPayoutSchema = startPayoutBatchSchema;
export type RunPayoutInput = StartPayoutBatchInput;

export const listPayoutsSchema = z.object({
  status: z.enum(['requested', 'processing', 'paid', 'rejected', 'failed']).optional(),
  period: month.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListPayoutsInput = z.infer<typeof listPayoutsSchema>;

export const exportPayoutsSchema = z.object({
  period: month,
});
export type ExportPayoutsInput = z.infer<typeof exportPayoutsSchema>;

export const approvePayoutRequestSchema = z.object({
  method: z.enum(['manual', 'csv']).default('manual'),
}).default({ method: 'manual' });
export type ApprovePayoutRequestInput = z.infer<typeof approvePayoutRequestSchema>;

export const rejectPayoutRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RejectPayoutRequestInput = z.infer<typeof rejectPayoutRequestSchema>;

export const settlePayoutBatchSchema = z.object({
  settlementReference: z.string().trim().min(1).max(240),
  settlementEvidence: z.string().trim().min(1).max(2000),
});
export type SettlePayoutBatchInput = z.infer<typeof settlePayoutBatchSchema>;

export const failPayoutBatchSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type FailPayoutBatchInput = z.infer<typeof failPayoutBatchSchema>;

export const reconcilePayoutsSchema = z.object({
  // banka ekstresi satirlari: tutar (cent) + opsiyonel banka referansi
  rows: z
    .array(z.object({ amountCents: z.number().int().positive(), ref: z.string().trim().max(140).optional() }))
    .min(1)
    .max(5000),
});
export type ReconcilePayoutsInput = z.infer<typeof reconcilePayoutsSchema>;

export const decidePayoutSchema = z.object({
  action: z.enum(['approve', 'reject']),
  // approve: banka/havale referansi; reject: red sebebi
  ref: z.string().trim().min(1).max(500).optional(),
});
export type DecidePayoutInput = z.infer<typeof decidePayoutSchema>;
