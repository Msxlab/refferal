// Markali subdomain cozumleme (Alt-proje B). ROOT_DOMAIN bossa TUM fonksiyonlar no-op
// doner — bugunku tek-domain davranisi degismez (bkz. docs/superpowers/specs/
// 2026-07-01-branded-subdomains-design.md).

export const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? '').toLowerCase();

const HQ_LABEL = 'hq';

// Host header buyuk/kucuk harf DUYARSIZDIR (RFC 4343); tarayici window.location.host'u zaten
// kucultur ama middleware'in okudugu HAM HTTP Host header'i icin bu garanti degildir.
function stripPort(host: string): string {
  return host.toLowerCase().replace(/:\d+$/, '');
}

/** Saf fonksiyon: bir `host` (port'lu olabilir) icin tenant slug'i, yoksa null.
 *  `hq` etiketi ve bos/`www` apex slug SAYILMAZ. */
export function slugFromHost(host: string): string | null {
  if (!ROOT_DOMAIN) return null;
  const bare = stripPort(host);
  if (bare === ROOT_DOMAIN || bare === `www.${ROOT_DOMAIN}`) return null;
  if (!bare.endsWith(`.${ROOT_DOMAIN}`)) return null;
  const label = bare.slice(0, -(ROOT_DOMAIN.length + 1));
  if (!label || label.includes('.') || label === HQ_LABEL) return null;
  return label;
}

/** Saf fonksiyon: bu host sahip (`hq.{ROOT_DOMAIN}`) kapisi mi? */
export function isHqFromHost(host: string): boolean {
  if (!ROOT_DOMAIN) return false;
  return stripPort(host) === `${HQ_LABEL}.${ROOT_DOMAIN}`;
}

/** Client-only sarmalayici: mevcut tarayici host'undan slug okur. */
export function currentSlug(): string | null {
  if (typeof window === 'undefined') return null;
  return slugFromHost(window.location.host);
}

/** Client-only sarmalayici: mevcut tarayici sahip kapisinda mi? */
export function isHqHost(): boolean {
  if (typeof window === 'undefined') return false;
  return isHqFromHost(window.location.host);
}
