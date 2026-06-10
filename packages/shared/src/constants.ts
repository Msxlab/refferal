/** Varsayilan havuz orani: %10 (SPEC 3.1) */
export const DEFAULT_POOL_RATE_BPS = 1000;

/** Axtra standart plani: satici %5, 1.ust %2, 2.ust %1.5, 3.ust %1, 4.ust %0.5 */
export const DEFAULT_LEVEL_RATES_BPS = [500, 200, 150, 100, 50] as const;

/** Plan derinligi siniri (SPEC 3.2) */
export const MIN_PLAN_DEPTH = 1;
export const MAX_PLAN_DEPTH = 8;

/** bps paydasi: 10000 bps = %100 */
export const BPS_DENOMINATOR = 10_000;

/** Payout varsayilanlari (docs/DECISIONS.md) */
export const DEFAULT_PAYOUT_MIN_CENTS = 100_000n; // $1.000

/** ABD-only sistem; tenant timezone varsayilani */
export const DEFAULT_TENANT_TIMEZONE = 'America/New_York';

export const DEFAULT_CURRENCY = 'USD';
