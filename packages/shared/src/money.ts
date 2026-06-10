import { BPS_DENOMINATOR } from './constants';

/**
 * Para kurallari (SPEC 3.5):
 * - Tum tutarlar integer cent (bigint). Float ASLA kullanilmaz.
 * - Seviye tutari floor(amount_cents * rate_bps / 10000); kalan kuruslar sirkette kalir.
 */
export function bpsAmount(amountCents: bigint, rateBps: number): bigint {
  if (amountCents < 0n) {
    throw new RangeError(`amountCents negatif olamaz: ${amountCents}`);
  }
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > BPS_DENOMINATOR) {
    throw new RangeError(`rateBps 0..${BPS_DENOMINATOR} araliginda tamsayi olmali: ${rateBps}`);
  }
  // Negatif olmayan bigint bolmesi zaten floor davranisindadir.
  return (amountCents * BigInt(rateBps)) / BigInt(BPS_DENOMINATOR);
}

/** Gosterim amacli: 123456n -> "1234.56" (UI formatlamasi i18n katmaninda yapilir) */
export function centsToDecimalString(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${sign}${whole.toString()}.${frac}`;
}
