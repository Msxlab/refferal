import { BPS_DENOMINATOR } from './constants';

/**
 * Money rules (SPEC 3.5):
 * - All amounts are integer cents (bigint). Floats are never used.
 * - Level amount is floor(amount_cents * rate_bps / 10000); remainder cents stay with the company.
 */
export function bpsAmount(amountCents: bigint, rateBps: number): bigint {
  if (amountCents < 0n) {
    throw new RangeError(`amountCents cannot be negative: ${amountCents}`);
  }
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > BPS_DENOMINATOR) {
    throw new RangeError(`rateBps must be an integer in 0..${BPS_DENOMINATOR}: ${rateBps}`);
  }
  // Non-negative bigint division already floors.
  return (amountCents * BigInt(rateBps)) / BigInt(BPS_DENOMINATOR);
}

/** Display helper: 123456n -> "1234.56". UI currency formatting happens in the i18n layer. */
export function centsToDecimalString(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${sign}${whole.toString()}.${frac}`;
}
