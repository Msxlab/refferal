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
const IMP_KEY = 'refearn.session.impersonator';
const SESSION_MUTATION_LOCK = 'refearn.auth.session-mutation';

export type SessionChangeOrigin = 'local' | 'storage';
export type SessionChangeReason = 'mutation' | 'transition' | 'external';
export type SessionChangeAction = 'update' | 'reload' | 'defer-to-caller';
type LocalSessionChangeReason = Exclude<SessionChangeReason, 'external'> | 'storage-cleanup';
type PublishedSessionChangeReason = SessionChangeReason | 'storage-cleanup';
type LocalSessionChangeListener = (
  oldValue: string | null,
  newValue: string | null,
  reason: LocalSessionChangeReason,
) => void;
const localSessionChangeListeners = new Set<LocalSessionChangeListener>();

interface SessionLockManager {
  request<T>(
    name: string,
    options: { mode: 'exclusive' },
    callback: () => T | PromiseLike<T>,
  ): Promise<T>;
}

type SynchronousResult<T> = T extends PromiseLike<unknown> ? never : T;

export interface LockedSessionStore {
  read(): SessionReadResult;
  set(session: Session, reason?: LocalSessionChangeReason): void;
  clear(reason?: LocalSessionChangeReason): void;
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
      typeof membership.tenantSlug === 'string' &&
      isNonEmptyString(membership.tenantName) &&
      isNonEmptyString(membership.role) &&
      isNonEmptyString(membership.referralCode) &&
      Number.isInteger(membership.depth),
  );
}

export type SessionReadResult =
  | { ok: true; session: Session | null }
  | { ok: false; session: null; error: unknown };

export interface SessionStorageChange {
  action: SessionChangeAction;
  session: Session | null;
  reload: boolean;
  origin: SessionChangeOrigin;
  reason: SessionChangeReason;
}

function currentRawMainSession(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function publishLocalSessionChange(
  oldValue: string | null,
  newValue: string | null,
  reason: LocalSessionChangeReason,
): void {
  for (const listener of [...localSessionChangeListeners]) {
    try { listener(oldValue, newValue, reason); } catch { /* subscriber isolation */ }
  }
}

function rawSetSession(session: Session, reason: LocalSessionChangeReason = 'mutation'): void {
  if (!isSession(session)) throw new InvalidSessionError();
  const oldValue = currentRawMainSession();
  const newValue = JSON.stringify(session);
  window.localStorage.setItem(KEY, newValue);
  publishLocalSessionChange(oldValue, newValue, reason);
}

function rawClearMainSession(reason: LocalSessionChangeReason = 'mutation'): void {
  const oldValue = currentRawMainSession();
  try {
    window.localStorage.removeItem(KEY);
    publishLocalSessionChange(oldValue, null, reason);
  } finally {
    setActiveCompanyToken(null);
  }
}

function rawImpersonator(): string | null {
  return window.localStorage.getItem(IMP_KEY);
}

function rawClearImpersonator(): void {
  if (rawImpersonator() !== null) window.localStorage.removeItem(IMP_KEY);
}

function rawClearSessionState(reason: LocalSessionChangeReason = 'mutation'): void {
  const errors: unknown[] = [];
  try { rawClearMainSession(reason); } catch (error) { errors.push(error); }
  try { rawClearImpersonator(); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'session and impersonator cleanup failed');
}

function restoreRawImpersonator(raw: string | null): void {
  if (raw === null) window.localStorage.removeItem(IMP_KEY);
  else window.localStorage.setItem(IMP_KEY, raw);
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

function sessionFromStorageValue(raw: string | null): Session | null {
  if (raw === null) return null;
  try {
    const candidate: unknown = JSON.parse(raw);
    return isSession(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/** Session degisimini owner/workspace sinirinda shell state'ine tasir. */
export function subscribeToSessionStorageChanges(
  onChange: (change: SessionStorageChange) => void,
  acceptsSession: (session: Session) => boolean = () => true,
): () => void {
  if (typeof window === 'undefined') return () => {};
  let active = true;
  const pendingDeliveries = new Set<ReturnType<typeof setTimeout>>();
  const deliver = (change: SessionStorageChange) => {
    const run = () => {
      if (!active) return;
      try { onChange(change); } catch { /* subscriber isolation */ }
    };
    if (change.action === 'reload' && change.origin === 'local') {
      let timer: ReturnType<typeof setTimeout>;
      timer = setTimeout(() => {
        pendingDeliveries.delete(timer);
        run();
      }, 0);
      pendingDeliveries.add(timer);
      return;
    }
    run();
  };
  const handleSessionChange = (
    oldValue: string | null,
    newValue: string | null,
    reason: PublishedSessionChangeReason = 'mutation',
    origin: SessionChangeOrigin = 'local',
  ) => {
    if (reason === 'storage-cleanup') return;
    if (origin === 'local' && reason === 'transition') {
      setActiveCompanyToken(null);
      deliver({
        action: 'defer-to-caller',
        session: null,
        reload: false,
        origin,
        reason,
      });
      return;
    }
    const previous = sessionFromStorageValue(oldValue);
    const next = sessionFromStorageValue(newValue);
    let compatible = false;
    try {
      compatible = Boolean(previous && next && sameSessionFamily(previous, next) && acceptsSession(next));
    } catch {
      compatible = false;
    }
    if (compatible && next) {
      deliver({ action: 'update', session: next, reload: false, origin, reason });
      return;
    }
    setActiveCompanyToken(null);
    deliver({ action: 'reload', session: null, reload: true, origin, reason });
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    if (event.newValue !== null && !sessionFromStorageValue(event.newValue)) {
      void tryClearInvalidSession(event.newValue, 'storage-cleanup').then(handleStorageChange, handleStorageChange);
      return;
    }
    handleStorageChange();

    function handleStorageChange(): void {
      if (!active) return;
      handleSessionChange(event.oldValue, event.newValue, 'external', 'storage');
    }
  };
  localSessionChangeListeners.add(handleSessionChange);
  window.addEventListener('storage', onStorage);
  return () => {
    active = false;
    localSessionChangeListeners.delete(handleSessionChange);
    window.removeEventListener('storage', onStorage);
    for (const timer of pendingDeliveries) clearTimeout(timer);
    pendingDeliveries.clear();
  };
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
        try { rawClearSessionState(); } catch { /* best effort */ }
      });
    },
    set: (session, reason) => {
      assertActive();
      rawSetSession(session, reason);
    },
    clear: (reason) => {
      assertActive();
      rawClearSessionState(reason);
    },
  };
  return { store, release: () => { active = false; } };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  ) && typeof (value as { then?: unknown }).then === 'function';
}

function invokeLocked<T>(operation: (store: LockedSessionStore) => T): T {
  const locked = lockedStore();
  try {
    const result = operation(locked.store);
    if (isThenable(result)) throw new Error('session mutation callback must be synchronous');
    return result;
  } finally {
    locked.release();
  }
}

let fallbackMutationActive = false;
const fallbackMutationQueue: Array<() => void> = [];

function runFallbackMutation<T>(operation: (store: LockedSessionStore) => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      fallbackMutationActive = true;
      try {
        resolve(invokeLocked(operation));
      } catch (error) {
        reject(error);
      } finally {
        const next = fallbackMutationQueue.shift();
        if (next) next();
        else fallbackMutationActive = false;
      }
    };
    if (fallbackMutationActive) fallbackMutationQueue.push(run);
    else run();
  });
}

class SessionMutationCallbackFailure extends Error {
  constructor(readonly cause: unknown) {
    super('session mutation callback failed');
    this.name = 'SessionMutationCallbackFailure';
  }
}

function rejectLockRequest<T>(error: unknown): Promise<T> {
  setActiveCompanyToken(null);
  return Promise.reject(error);
}

/** Tum uretim session mutation'lari bu tek kilit protokolunden gecer. */
export function withSessionMutation<T>(
  operation: (store: LockedSessionStore) => SynchronousResult<T>,
): Promise<T> {
  const locks =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as unknown as { locks?: SessionLockManager }).locks;
  const synchronousOperation = operation as (store: LockedSessionStore) => T;
  if (!locks || typeof locks.request !== 'function') return runFallbackMutation(synchronousOperation);
  try {
    return locks
      .request(SESSION_MUTATION_LOCK, { mode: 'exclusive' }, () => {
        try {
          return invokeLocked(synchronousOperation);
        } catch (error) {
          return Promise.reject(new SessionMutationCallbackFailure(error));
        }
      })
      .catch((error: unknown) => {
        if (error instanceof SessionMutationCallbackFailure) throw error.cause;
        return rejectLockRequest<T>(error);
      });
  } catch (error) {
    return rejectLockRequest(error);
  }
}

export async function setSession(session: Session): Promise<void> {
  await withSessionMutation((store) => {
    store.set(session, 'transition');
    rawClearImpersonator();
  });
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
    await withSessionMutation((store) => { store.clear('transition'); });
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

async function tryClearInvalidSession(
  expectedRaw: string,
  reason: LocalSessionChangeReason = 'mutation',
): Promise<boolean> {
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
        store.clear(reason);
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

function sameSessionSnapshot(expected: Session, current: Session): boolean {
  return JSON.stringify(expected) === JSON.stringify(current);
}

function exactCurrentSession(store: LockedSessionStore, expected: Session): Session {
  const current = sessionOrThrow(store.read());
  if (!current || !sameSessionSnapshot(expected, current)) throw new Error('session owner changed');
  return current;
}

function matchesSessionSnapshot(expected: Session | null, current: Session | null): boolean {
  if (!expected || !current) return expected === current;
  return sameSessionSnapshot(expected, current);
}

export function replaceSessionIfCurrent(expected: Session | null, next: Session): Promise<Session> {
  return withSessionMutation((store) => {
    const current = sessionOrThrow(store.read());
    if (!matchesSessionSnapshot(expected, current)) throw new Error('session owner changed');
    store.set(next, 'transition');
    rawClearImpersonator();
    return next;
  });
}

export function updateSession(
  expected: Session,
  updater: (session: Session) => Session,
  reason: LocalSessionChangeReason = 'mutation',
): Promise<Session> {
  return withSessionMutation((store) => {
    const current = exactCurrentSession(store, expected);
    const next = updater(current);
    store.set(next, reason);
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
export function applyTenantSwitch(
  expected: Session,
  accessToken: string,
  activeMembershipId: string,
): Promise<Session> {
  return updateSession(
    expected,
    (session) => ({ ...session, accessToken, activeMembershipId }),
    'transition',
  );
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
  sid?: string;
  imp?: string;
}

/** Mevcut (admin) oturumu yedekle, uye imp oturumuna gec. */
export async function startImpersonation(expectedAdmin: Session, impSession: Session): Promise<void> {
  await withSessionMutation((store) => {
    if (!isSession(impSession)) throw new InvalidSessionError();
    const current = exactCurrentSession(store, expectedAdmin);
    if (accessClaims(impSession).imp !== current.user.id) throw new Error('impersonation owner mismatch');
    const previousBackup = rawImpersonator();
    window.localStorage.setItem(IMP_KEY, JSON.stringify(current));
    try {
      store.set(impSession, 'transition');
    } catch (error) {
      try {
        restoreRawImpersonator(previousBackup);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'impersonation session write and backup rollback failed');
      }
      throw error;
    }
  });
}

export function isImpersonating(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const current = getSession();
    const raw = rawImpersonator();
    if (!current || !raw) return false;
    const candidate: unknown = JSON.parse(raw);
    return isSession(candidate) && accessClaims(current).imp === candidate.user.id;
  } catch {
    return false;
  }
}

/** Yedeklenen admin oturumunu dondur ve imp bayragini temizle (yoksa null). */
export function stopImpersonation(): Promise<Session | null> {
  return withSessionMutation((store) => {
    if (typeof window === 'undefined') return null;
    const current = sessionOrThrow(store.read());
    const currentImp = accessClaims(current).imp;
    const currentIsImpersonation = typeof currentImp === 'string';
    const raw = rawImpersonator();
    if (!raw) {
      if (currentIsImpersonation) store.clear('transition');
      return null;
    }
    const rejectBackup = () => {
      if (currentIsImpersonation) store.clear('transition');
      else window.localStorage.removeItem(IMP_KEY);
      return null;
    };
    let candidate: unknown;
    try {
      candidate = JSON.parse(raw);
    } catch {
      return rejectBackup();
    }
    if (!current || !isSession(candidate) || currentImp !== candidate.user.id) {
      return rejectBackup();
    }
    store.set(candidate, 'transition');
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

/** Non-empty refresh-family claim plus the same user and active workspace. */
export function sameSessionFamily(previous: Session, next: Session): boolean {
  const previousFamily = accessClaims(previous).sid;
  const nextFamily = accessClaims(next).sid;
  if (
    typeof previousFamily !== 'string' ||
    previousFamily.length === 0 ||
    previousFamily !== nextFamily ||
    previous.user.id !== next.user.id ||
    previous.activeMembershipId !== next.activeMembershipId
  ) {
    return false;
  }
  if (previous.activeMembershipId === null) return true;
  const previousMembership = previous.memberships.find(({ id }) => id === previous.activeMembershipId);
  const nextMembership = next.memberships.find(({ id }) => id === next.activeMembershipId);
  return Boolean(previousMembership && nextMembership && previousMembership.tenantId === nextMembership.tenantId);
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
