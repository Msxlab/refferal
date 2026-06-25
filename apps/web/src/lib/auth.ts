// Admin SPA oturumu: token'lar localStorage'da (MVP tercihi — bkz. DECISIONS).
// Uretimde httpOnly cookie'ye gecilebilir.

export interface MembershipSummary {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: string;
  referralCode: string;
  depth: number;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; fullName: string; locale: string; emailVerified: boolean; isPlatformAdmin?: boolean };
  activeMembershipId: string | null;
  memberships: MembershipSummary[];
}

const KEY = 'refearn.session';

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export function setSession(s: Session): void {
  window.localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession(): void {
  window.localStorage.removeItem(KEY);
}

export function activeMembership(s: Session): MembershipSummary | null {
  return s.memberships.find((m) => m.id === s.activeMembershipId) ?? s.memberships[0] ?? null;
}

/** Kullanicinin belirli bir sirketteki (tenant) uyeligi — platform'dan isyerine gecis icin. */
export function membershipForTenant(s: Session, tenantId: string): MembershipSummary | null {
  return s.memberships.find((m) => m.tenantId === tenantId) ?? null;
}

/** switch-tenant sonucunu oturuma uygula: token o tenant'a scoped, aktif uyelik guncellenir. */
export function applyTenantSwitch(accessToken: string, activeMembershipId: string): void {
  const s = getSession();
  if (!s) return;
  setSession({ ...s, accessToken, activeMembershipId });
}

const ADMIN_ROLES = new Set(['tenant_owner', 'tenant_admin', 'tenant_staff']);

export function isAdminRole(role: string | undefined): boolean {
  return role !== undefined && ADMIN_ROLES.has(role);
}

const GOD_TIERS = new Set(['platform_admin', 'tenant_owner']);

interface AccessClaims {
  role?: string;
  perms?: string[];
  tid?: string;
  mid?: string;
  imp?: string;
}

/* ---- impersonation: admin'in uye oturumunu gecici devralmasi (salt-okunur) ---- */
const IMP_KEY = 'refearn.session.impersonator';

/** Mevcut (admin) oturumu yedekle, uye imp oturumuna gec. */
export function startImpersonation(impSession: Session): void {
  const current = getSession();
  if (current) window.localStorage.setItem(IMP_KEY, JSON.stringify(current));
  setSession(impSession);
}

export function isImpersonating(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage.getItem(IMP_KEY);
}

/** Yedeklenen admin oturumunu dondur ve imp bayragini temizle (yoksa null). */
export function stopImpersonation(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(IMP_KEY);
  window.localStorage.removeItem(IMP_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

/** Access JWT govdesini cozer (imza dogrulamasi sunucuda; burada yalniz UI gosterimi icin). */
export function accessClaims(s: Session | null): AccessClaims {
  if (!s?.accessToken) return {};
  try {
    const part = s.accessToken.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as AccessClaims;
  } catch {
    return {};
  }
}

/** Ince yetki kontrolu (UI). owner/platform her zaman gecer; backend ayrica zorlar. */
export function can(s: Session | null, permission: string): boolean {
  const c = accessClaims(s);
  if (c.role && GOD_TIERS.has(c.role)) return true;
  return c.perms?.includes(permission) ?? false;
}

/** Rol bazli varsayilan inis: admin roller /admin, uye /app (SPEC 4.3). */
export function landingPath(role: string | undefined): string {
  return isAdminRole(role) ? '/admin' : '/app';
}

/** Oturum bazli inis: platform admin'in bir isyeri (uyelik) varsa dogrudan /admin,
 *  yoksa /platform (sirket listesi). Diger roller role gore (admin → /admin, uye → /app). */
export function landingForSession(s: Session): string {
  if (s.user.isPlatformAdmin) {
    return activeMembership(s) ? '/admin' : '/platform';
  }
  return landingPath(activeMembership(s)?.role);
}
