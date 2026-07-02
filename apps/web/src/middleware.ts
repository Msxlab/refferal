import { NextRequest, NextResponse } from 'next/server';
import { slugFromHost, ROOT_DOMAIN } from '@/lib/subdomain';

// Yalnis kapiyi engelleyen ince route guard (Alt-proje B). DB/API cagrisi YOK — edge-safe.
// ROOT_DOMAIN bossa tamamen no-op: mevcut tek-domain uretim (earn.oppeinnj.com) etkilenmez.
//
// hq.{ROOT_DOMAIN}'de /app ve /admin BILEREK engellenmiyor: HQ drill-in'in onceden var olan
// "View as member" akisi (MembersPageContent.viewAsMember -> /app) ve impersonation cikisi
// (app/layout.tsx exitImpersonation -> /admin) tam bu host'tan bu path'lere gecis yapiyor.
// Bu path'leri burada engellemek o akisi kilitli kalitiya (dead-end) sokardi — /app ve /admin
// zaten kendi client-side + API-seviyeli yetki kontrollerini bagimsiz yapiyor, host'a gore
// ekstra bir guvenlik sinirina ihtiyac yok (bkz. audit bulgusu, 2026-07-01).
export function middleware(req: NextRequest) {
  if (!ROOT_DOMAIN) return NextResponse.next();

  const host = req.headers.get('host') ?? '';
  const { pathname } = req.nextUrl;

  if (slugFromHost(host)) {
    // tenant subdomain'inde sahip kapisi sizmaz
    if (pathname === '/hq' || pathname.startsWith('/hq/')) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon.ico).*)'],
};
