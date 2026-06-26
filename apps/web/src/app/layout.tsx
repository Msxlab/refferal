import type { Metadata, Viewport } from 'next';
import { Inter, Sora } from 'next/font/google';
import './globals.css';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { OfflineBanner } from '@/components/OfflineBanner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppToaster } from '@/components/AppToaster';
import { APP_NAME } from '@/lib/brand';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const sora = Sora({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-sora', display: 'swap' });

export const metadata: Metadata = {
  title: `${APP_NAME} — Referral commission platform`,
  description: 'Grow your referral network, distribute commissions automatically.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: APP_NAME },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#05060a',
  width: 'device-width',
  initialScale: 1,
};

// FOUC'suz tema: ilk boyamadan once data-theme'i ayarla (localStorage / sistem tercihi, varsayilan dark).
const themeInit = `(function(){try{var t=localStorage.getItem('refearn.theme');if(t!=='light'&&t!=='dark'){t='dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${sora.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <TooltipProvider delayDuration={250} skipDelayDuration={400}>
          <OfflineBanner />
          {children}
          <AppToaster />
          <ServiceWorkerRegister />
        </TooltipProvider>
      </body>
    </html>
  );
}
