import type { MetadataRoute } from 'next';

/**
 * PWA manifest (Next 15 app router -> /manifest.webmanifest, link otomatik eklenir).
 * Uye/admin mobil deneyimi icin installable. Ikonlar SVG (Chrome/Android/desktop kabul eder);
 * iOS tam destek icin 180x180 PNG apple-touch-icon eklenebilir (tasarim islerine birakildi).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Refearn — Referral Commissions',
    short_name: 'Refearn',
    description: 'Track sales, commissions and payouts across your referral network.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#05060a',
    theme_color: '#05060a',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
