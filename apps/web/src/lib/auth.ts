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
  user: { id: string; email: string; fullName: string; locale: string; emailVerified: boolean };
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
