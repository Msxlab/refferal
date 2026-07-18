/** Default pool rate: 10% (SPEC 3.1). */
export const DEFAULT_POOL_RATE_BPS = 1000;

/** Standard Axtra plan: seller 5%, 1st upline 2%, 2nd 1.5%, 3rd 1%, 4th 0.5%. */
export const DEFAULT_LEVEL_RATES_BPS = [500, 200, 150, 100, 50] as const;

/** Plan depth bounds (SPEC 3.2). */
export const MIN_PLAN_DEPTH = 1;
export const MAX_PLAN_DEPTH = 8;

/** Basis-point denominator: 10000 bps = 100%. */
export const BPS_DENOMINATOR = 10_000;

/** Payout defaults (docs/DECISIONS.md). */
export const DEFAULT_PAYOUT_MIN_CENTS = 100_000n; // $1.000

/** US-only system; default tenant timezone. */
export const DEFAULT_TENANT_TIMEZONE = 'America/New_York';

export const DEFAULT_CURRENCY = 'USD';
