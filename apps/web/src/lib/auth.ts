// Admin SPA oturumu: token'lar localStorage'da (MVP tercihi — bkz. DECISIONS).
// Uretimde httpOnly cookie'ye gecilebilir.

import { getActiveCompanyToken, setActiveCompanyToken } from './active-company';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isSession(value: unknown): value is Session {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.accessToken) ||
    !isNonEmptyString(value.refreshToken) ||
    !isRecord(value.user)
  ) {
    return false;
  }
  const user = value.user;
  if (
    !isNonEmptyString(user.id) ||
    !isNonEmptyString(user.email) ||
    !isNonEmptyString(user.fullName) ||
    !isNonEmptyString(user.locale) ||
    typeof user.emailVerified !== 'boolean' ||
    (user.isPlatformAdmin !== undefined && typeof user.isPlatformAdmin !== 'boolean') ||
    (value.activeMembershipId !== null && !isNonEmptyString(value.activeMembershipId)) ||
    !Array.isArray(value.memberships)
  ) {
    return false;
  }
  return value.memberships.every(
    (membership) =>
      isRecord(membership) &&
      isNonEmptyString(membership.id) &&
      isNonEmptyString(membership.tenantId) &&
      isNonEmptyString(membership.tenantSlug) &&
      isNonEmptyString(membership.tenantName) &&
      isNonEmptyString(membership.role) &&
      isNonEmptyString(membership.referralCode) &&
      Number.isInteger(membership.depth),
  );
}

export type SessionReadResult =
  | { ok: true; session: Session | null }
  | { ok: false; session: null };

/** localStorage erisimini ve Session dogrulamasini tek, no-throw sinirda toplar. */
export function readSession(): SessionReadResult {
  if (typeof window === 'undefined') return { ok: true, session: null };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Okuma basarisizsa depodaki oturumun sahibi bilinemez; yalnizca bellek durumunu kapat.
    setActiveCompanyToken(null);
    return { ok: false, session: null };
  }
  if (raw === null) return { ok: true, session: null };
  try {
    const candidate: unknown = JSON.parse(raw);
    if (isSession(candidate)) return { ok: true, session: candidate };
  } catch {
    // Gecersiz JSON da gecersiz Session ile ayni guvenli-kapali yola iner.
  }
  tryClearSession();
  return { ok: false, session: null };
}

export function getSession(): Session | null {
  return readSession().session;
}

export function setSession(s: Session): void {
  window.localStorage.setItem(KEY, JSON.stringify(s));
}

export function trySetSession(s: Session): boolean {
  try {
    setSession(s);
    return true;
  } catch {
    return false;
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } finally {
    // HQ drill-in act-as god token bellekte tutulur; oturum bitince onu da temizle
    // ki request() artik /admin/* cagrilarina bayat token eklemesin.
    setActiveCompanyToken(null);
  }
}

export function tryClearSession(): boolean {
  try {
    clearSession();
    return true;
  } catch {
    return false;
  }
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

/** Ham bir access JWT govdesini cozer (imza dogrulamasi sunucuda; burada yalniz UI icin). */
function decodeClaims(token: string | undefined): AccessClaims {
  if (!token) return {};
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as AccessClaims;
  } catch {
    return {};
  }
}

/** Access JWT govdesini cozer (imza dogrulamasi sunucuda; burada yalniz UI gosterimi icin). */
export function accessClaims(s: Session | null): AccessClaims {
  return decodeClaims(s?.accessToken);
}

/** Ince yetki kontrolu (UI). owner/platform her zaman gecer; backend ayrica zorlar.
 *  HQ drill-in'de aktif sirket (act-as) token'i varsa onun haklari degerlendirilir. */
export function can(s: Session | null, permission: string): boolean {
  const tok = getActiveCompanyToken();
  const c = tok ? decodeClaims(tok) : accessClaims(s);
  if (c.role && GOD_TIERS.has(c.role)) return true;
  return c.perms?.includes(permission) ?? false;
}

/** Rol bazli varsayilan inis: admin roller /admin, uye /app (SPEC 4.3). */
export function landingPath(role: string | undefined): string {
  return isAdminRole(role) ? '/admin' : '/app';
}

/** Oturum bazli inis: platform admin HQ'ya iner.
 *  Diger roller role gore (admin → /admin, uye → /app). */
export function landingForSession(s: Session): string {
  if (s.user.isPlatformAdmin) return '/hq';
  return landingPath(activeMembership(s)?.role);
}
