/** integer cent (string) → para gosterimi. Tutarlar API'den string gelir (BigInt). */
export function money(cents: string | number | bigint, currency = 'USD'): string {
  const n = typeof cents === 'bigint' ? Number(cents) : Number(cents);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n / 100);
}

export function bps(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}

export function dateShort(value: string | Date | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
