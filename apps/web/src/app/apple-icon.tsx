import { ImageResponse } from 'next/og';

// iOS PWA "Add to Home Screen" ikonu (apple-touch-icon). iOS SVG kabul etmez → 180x180 PNG.
// Next.js bunu /apple-icon olarak servis eder + <link rel="apple-touch-icon"> otomatik ekler.
// Tasarim public/icon.svg ile ayni: koyu zemin + altin yuvarlak-kare + koyu "R".
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#05060a',
        }}
      >
        <div
          style={{
            width: 150,
            height: 150,
            borderRadius: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #f5d27a, #d4a017)',
            color: '#1a1404',
            fontSize: 108,
            fontWeight: 800,
          }}
        >
          R
        </div>
      </div>
    ),
    { ...size },
  );
}
