/**
 * Formats integer cents without first coercing API BigInt strings to Number.
 * Browser Number values lose precision above 2^53 - 1, while balances and
 * settlement totals are deliberately represented as cent strings by the API.
 */
export function money(cents: string | number | bigint | null | undefined, currency = 'USD'): string {
  const raw = centsText(cents);
  const negative = raw.startsWith('-');
  const absolute = (negative ? raw.slice(1) : raw).replace(/^0+(?=\d)/, '') || '0';
  const whole = absolute.length > 2 ? absolute.slice(0, -2) : '0';
  const fraction = absolute.slice(-2).padStart(2, '0');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  try {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const rendered = formatter
      .formatToParts(0)
      .map((part) => {
        if (part.type === 'integer') return groupedWhole;
        if (part.type === 'fraction') return fraction;
        return part.value;
      })
      .join('');
    return negative ? `-${rendered}` : rendered;
  } catch {
    return `${negative ? '-' : ''}${currency} ${groupedWhole}.${fraction}`;
  }
}

function centsText(cents: string | number | bigint | null | undefined): string {
  if (typeof cents === 'bigint') return cents.toString();
  if (typeof cents === 'number') {
    if (!Number.isFinite(cents)) return '0';
    return String(Math.trunc(cents));
  }
  const value = typeof cents === 'string' ? cents.trim() : '';
  return /^-?\d+$/.test(value) ? value : '0';
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
