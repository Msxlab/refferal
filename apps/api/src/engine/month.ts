/**
 * Month calculations use the tenant timezone (SPEC 10).
 * The en-CA locale formats year-month as "YYYY-MM", so no extra dependency is needed.
 */
export function monthKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(date);
}
