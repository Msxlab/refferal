/** integer cent (string) → para gosterimi (API tutarlari string cent doner). */
export function money(cents: string | number, currency = 'USD'): string {
  const n = Number(cents);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n / 100);
}

export function dateShort(value: string | Date | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString('tr-TR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
