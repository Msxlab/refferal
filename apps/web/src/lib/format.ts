/** integer cent (string) → para gosterimi. Tutarlar API'den string gelir (BigInt). */
export function money(cents: string | number | bigint, currency = 'USD'): string {
  const n = Number(cents);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n / 100);
}

export function bps(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}

export function dateShort(value: string | Date | null): string {
  if (!value) return '—';
  // Yalniz-tarih (YYYY-MM-DD) string'i UTC gece-yarisi olarak parse edilir; US tz'leri
  // UTC'nin gerisinde oldugu icin bir gun geri kayardi. Yerel gece-yarisi olarak parse et.
  const d = typeof value === 'string'
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
    : value;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
