import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Refearn Yonetim',
  description: 'Referans komisyon sistemi — tenant yonetimi',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
