/** integer cent (string) → para gosterimi. Tutarlar API'den string gelir (BigInt). */
export function money(cents: string | number | bigint, currency = 'USD'): string {
  const n = Number(cents);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n / 100);
}

export function bps(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}

/**
 * Komisyon seviyesi → okunur etiket. Sentetik seviyeler (engine):
 * 1000 fast-start, 1001 matching, 1002 rütbe override; 0 = saticinin kendi (direkt); n = unilevel.
 */
export function levelLabel(level: number, short = false): string {
  switch (level) {
    case 1000: return short ? 'Fast' : 'Fast-start';
    case 1001: return short ? 'Match' : 'Matching';
    case 1002: return short ? 'Rank' : 'Rank override';
    case 0: return short ? 'L0' : 'Direct (L0)';
    default: return short ? `L${level}` : `Level ${level}`;
  }
}

/** Ledger entry type → human label. */
export function ledgerTypeLabel(type: string): string {
  switch (type) {
    case 'commission': return 'Commission';
    case 'reversal': return 'Reversal';
    case 'adjustment': return 'Adjustment';
    default: return type;
  }
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
