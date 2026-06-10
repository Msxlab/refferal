/**
 * "Ay" hesaplari tenant timezone'una gore yapilir (SPEC 10 — Zaman).
 * en-CA locale'i yil-ay'i "YYYY-MM" olarak formatlar; ek bagimlilik gerekmez.
 */
export function monthKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(date);
}
