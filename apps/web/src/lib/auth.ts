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
const SESSION_MUTATION_LOCK = 'refearn.auth.session-mutation';

interface SessionLockManager {
  request<T>(
    name: string,
    options: { mode: 'exclusive' },
    callback: () => T | PromiseLike<T>,
  ): Promise<T>;
}

export interface LockedSessionStore {
  read(): SessionReadResult;
  set(session: Session): void;
  clear(): void;
}

export class InvalidSessionError extends Error {
  constructor() {
    super('invalid session');
    this.name = 'InvalidSessionError';
  }
}

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
    typeof value.refreshToken !== 'string' ||
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
  | { ok: false; session: null; error: unknown };

function rawSetSession(session: Session): void {
  window.localStorage.setItem(KEY, JSON.stringify(session));
}

function rawClearSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } finally {
    setActiveCompanyToken(null);
  }
}

function readStoredSession(onKnownInvalid: (raw: string) => void): SessionReadResult {
  if (typeof window === 'undefined') return { ok: true, session: null };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch (error) {
    // Okuma basarisizsa depodaki oturumun sahibi bilinemez; yalnizca bellek durumunu kapat.
    setActiveCompanyToken(null);
    return { ok: false, session: null, error };
  }
  if (raw === null) return { ok: true, session: null };
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch (error) {
    onKnownInvalid(raw);
    return { ok: false, session: null, error };
  }
  if (!isSession(candidate)) {
    onKnownInvalid(raw);
    return { ok: false, session: null, error: new InvalidSessionError() };
  }
  return { ok: true, session: candidate };
}

/** localStorage erisimini ve Session dogrulamasini tek, no-throw sinirda toplar. */
export function readSession(): SessionReadResult {
  return readStoredSession((raw) => { void tryClearInvalidSession(raw); });
}

export function getSession(): Session | null {
  const result = readSession();
  if (!result.ok) throw result.error;
  return result.session;
}

function lockedStore(): { store: LockedSessionStore; release: () => void } {
  let active = true;
  const assertActive = () => {
    if (!active) throw new Error('session mutation store used outside its lock');
  };
  const store: LockedSessionStore = {
    read: () => {
      assertActive();
      return readStoredSession(() => {
        try { rawClearSession(); } catch { /* best effort */ }
      });
    },
    set: (session) => {
      assertActive();
      rawSetSession(session);
    },
    clear: () => {
      assertActive();
      rawClearSession();
    },
  };
  return { store, release: () => { active = false; } };
}

async function invokeLocked<T>(operation: (store: LockedSessionStore) => T | PromiseLike<T>): Promise<T> {
  const locked = lockedStore();
  try {
    return await operation(locked.store);
  } finally {
    locked.release();
  }
}

let fallbackMutationActive = false;
const fallbackMutationQueue: Array<() => void> = [];

function runFallbackMutation<T>(operation: (store: LockedSessionStore) => T | PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      fallbackMutationActive = true;
      invokeLocked(operation)
        .then(resolve, reject)
        .finally(() => {
          const next = fallbackMutationQueue.shift();
          if (next) next();
          else fallbackMutationActive = false;
        });
    };
    if (fallbackMutationActive) fallbackMutationQueue.push(run);
    else run();
  });
}

/** Tum uretim session mutation'lari bu tek kilit protokolunden gecer. */
export function withSessionMutation<T>(
  operation: (store: LockedSessionStore) => T | PromiseLike<T>,
): Promise<T> {
  const locks =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as unknown as { locks?: SessionLockManager }).locks;
  if (!locks || typeof locks.request !== 'function') return runFallbackMutation(operation);
  return locks.request(SESSION_MUTATION_LOCK, { mode: 'exclusive' }, () => invokeLocked(operation));
}

export async function setSession(session: Session): Promise<void> {
  await withSessionMutation((store) => { store.set(session); });
}

export async function trySetSession(session: Session): Promise<boolean> {
  try {
    await setSession(session);
    return true;
  } catch {
    return false;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await withSessionMutation((store) => { store.clear(); });
  } finally {
    // Kilit callback'i calismadan reject olsa bile bellek token'i guvenli-kapali temizlenir.
    setActiveCompanyToken(null);
  }
}

export async function tryClearSession(): Promise<boolean> {
  try {
    await clearSession();
    return true;
  } catch {
    return false;
  }
}

async function tryClearInvalidSession(expectedRaw: string): Promise<boolean> {
  try {
    return await withSessionMutation((store) => {
      let currentRaw: string | null;
      try {
        currentRaw = window.localStorage.getItem(KEY);
      } catch {
        setActiveCompanyToken(null);
        return false;
      }
      if (currentRaw !== expectedRaw) return false;
      try {
        store.clear();
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function sessionOrThrow(result: SessionReadResult): Session | null {
  if (!result.ok) throw result.error;
  return result.session;
}

export function updateSession(
  updater: (session: Session) => Session,
): Promise<Session | null> {
  return withSessionMutation((store) => {
    const current = sessionOrThrow(store.read());
    if (!current) return null;
    const next = updater(current);
    store.set(next);
    return next;
  });
}

export function activeMembership(s: Session): MembershipSummary | null {
  return s.memberships.find((m) => m.id === s.activeMembershipId) ?? s.memberships[0] ?? null;
}

/** Kullanicinin belirli bir sirketteki (tenant) uyeligi — platform'dan isyerine gecis icin. */
export function membershipForTenant(s: Session, tenantId: string): MembershipSummary | null {
  return s.memberships.find((m) => m.tenantId === tenantId) ?? null;
}

/** switch-tenant sonucunu oturuma uygula: token o tenant'a scoped, aktif uyelik guncellenir. */
export async function applyTenantSwitch(accessToken: string, activeMembershipId: string): Promise<void> {
  await updateSession((session) => ({ ...session, accessToken, activeMembershipId }));
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
export async function startImpersonation(impSession: Session): Promise<void> {
  await withSessionMutation((store) => {
    const current = sessionOrThrow(store.read());
    if (current) window.localStorage.setItem(IMP_KEY, JSON.stringify(current));
    store.set(impSession);
  });
}

export function isImpersonating(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage.getItem(IMP_KEY);
}

/** Yedeklenen admin oturumunu dondur ve imp bayragini temizle (yoksa null). */
export function stopImpersonation(): Promise<Session | null> {
  return withSessionMutation((store) => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(IMP_KEY);
    if (!raw) {
      window.localStorage.removeItem(IMP_KEY);
      return null;
    }
    const candidate: unknown = JSON.parse(raw);
    if (!isSession(candidate)) throw new InvalidSessionError();
    store.set(candidate);
    window.localStorage.removeItem(IMP_KEY);
    return candidate;
  });
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
