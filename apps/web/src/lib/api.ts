import { clearSession, isSession, readSession, setSession, type Session } from './auth';
import { getActiveCompanyToken } from './active-company';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';
const AUTH_REFRESH_LOCK = 'refearn.auth.refresh';

/** SSE/EventSource gibi fetch disi tuketiciler icin API kok adresi. */
export const API_BASE = BASE;

// HQ drill-in: sahip bir sirkete indiginde /admin/* cagrilari bu token'i kullanir.
// Token bagimsiz './active-company' modulunde tutulur (api.ts <-> auth.ts dairesel
// bagimliligini kirar); mevcut import'lar bozulmasin diye buradan re-export edilir.
export { setActiveCompanyToken, getActiveCompanyToken } from './active-company';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(typeof body === 'object' && body && 'message' in body ? String((body as { message: unknown }).message) : `HTTP ${status}`);
  }
}

function expiredSessionError(): ApiError {
  return new ApiError(401, { message: 'oturum suresi doldu' });
}

function sessionForRequest(): Session | null {
  const result = readSession();
  if (!result.ok) throw expiredSessionError();
  return result.session;
}

async function rawFetch(path: string, init: RequestInit, token?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${BASE}${path}`, { ...init, headers });
}

/** access token suresi dolmussa bir kez refresh dener; basarisizsa oturum kapatir.
 *  Tek-ucus (single-flight): es zamanli 401'ler ayni refresh token'i AYNI ANDA gondermesin —
 *  aksi halde sunucu rotasyonlu refresh'i reuse-detection ile TUM oturumu iptal eder (ani cikis). */
interface RefreshFlight {
  owner: Session;
  promise: Promise<Session | null>;
}

interface RefreshLockManager {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T>;
}

let refreshInFlight: RefreshFlight | null = null;

function sameSessionIdentity(captured: Session, current: Session): boolean {
  if (captured.user.id !== current.user.id || captured.activeMembershipId !== current.activeMembershipId) return false;
  if (captured.activeMembershipId === null) return true;
  const capturedMembership = captured.memberships.find((membership) => membership.id === captured.activeMembershipId);
  const currentMembership = current.memberships.find((membership) => membership.id === current.activeMembershipId);
  return Boolean(capturedMembership && currentMembership && capturedMembership.tenantId === currentMembership.tenantId);
}

function sameRefreshOwner(captured: Session, current: Session): boolean {
  return (
    captured.accessToken === current.accessToken &&
    captured.refreshToken === current.refreshToken &&
    sameSessionIdentity(captured, current)
  );
}

function currentSession(): Session | null {
  const result = readSession();
  return result.ok ? result.session : null;
}

function ownsRefresh(owner: Session): boolean {
  const current = currentSession();
  return Boolean(current && sameRefreshOwner(owner, current));
}

function clearRefreshOwner(owner: Session): void {
  if (ownsRefresh(owner)) clearSession();
}

function advancedSessionFor(captured: Session): Session | null {
  const current = currentSession();
  if (
    !current ||
    current.accessToken === captured.accessToken ||
    !sameSessionIdentity(captured, current)
  ) {
    return null;
  }
  return current;
}

async function performRefresh(owner: Session): Promise<Session | null> {
  let next: Session | null = null;
  try {
    const res = await rawFetch('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: owner.refreshToken }),
    });
    if (res.ok) {
      const candidate: unknown = await res.json();
      if (isSession(candidate) && sameSessionIdentity(owner, candidate)) next = candidate;
    }
  } catch {
    // Ag, JSON ve localStorage hatalari ayni guvenli-kapali davranisa iner.
  }
  if (!next) {
    clearRefreshOwner(owner);
    return null;
  }
  if (!ownsRefresh(owner)) return null;
  if (!setSession(next)) {
    clearRefreshOwner(owner);
    return null;
  }
  return next;
}

async function refreshWithCurrentSession(owner: Session): Promise<Session | null> {
  const current = currentSession();
  if (!current || !sameSessionIdentity(owner, current)) return null;
  if (current.accessToken !== owner.accessToken) return current;
  if (current.refreshToken !== owner.refreshToken) return null;
  if (!ownsRefresh(owner)) return null;
  return performRefresh(owner);
}

function coordinatedRefresh(owner: Session): Promise<Session | null> {
  const locks =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as unknown as { locks?: RefreshLockManager }).locks;
  if (!locks || typeof locks.request !== 'function') return performRefresh(owner);
  return locks
    .request(AUTH_REFRESH_LOCK, { mode: 'exclusive' }, () => refreshWithCurrentSession(owner))
    .catch(() => {
      clearRefreshOwner(owner);
      return null;
    });
}

function refresh(owner: Session): Promise<Session | null> {
  if (!ownsRefresh(owner)) return Promise.resolve(null);
  if (refreshInFlight) {
    return sameRefreshOwner(refreshInFlight.owner, owner) ? refreshInFlight.promise : Promise.resolve(null);
  }
  let flight: RefreshFlight;
  const promise = coordinatedRefresh(owner).finally(() => {
    if (refreshInFlight === flight) refreshInFlight = null;
  });
  flight = { owner, promise };
  refreshInFlight = flight;
  return promise;
}

function retrySessionFor(captured: Session, candidate: Session | null): Session | null {
  return candidate && sameSessionIdentity(captured, candidate) && ownsRefresh(candidate) ? candidate : null;
}

async function sessionForRetry(captured: Session): Promise<Session | null> {
  const advanced = retrySessionFor(captured, advancedSessionFor(captured));
  if (advanced) return advanced;
  const refreshed = retrySessionFor(captured, await refresh(captured));
  if (refreshed) return refreshed;
  return retrySessionFor(captured, advancedSessionFor(captured));
}

async function request<T>(path: string, init: RequestInit = {}, retry = true, session?: Session | null): Promise<T> {
  if (session === undefined) session = sessionForRequest();
  const activeCompanyToken = getActiveCompanyToken();
  const overrideForAdmin = activeCompanyToken && path.startsWith('/admin') ? activeCompanyToken : null;
  const token = overrideForAdmin ?? session?.accessToken;
  const res = await rawFetch(path, init, token);

  // Drill-in override token kisa omurlu ve refresh edilemez (yeniden act-as ile basilir);
  // bu yuzden 401-refresh yolu yalnizca normal oturum token'i kullanildiginda calisir.
  if (res.status === 401 && !overrideForAdmin && session && retry) {
    const retrySession = await sessionForRetry(session);
    if (retrySession) return request<T>(path, init, false, retrySession);
    // refresh basarisiz -> oturum temizlendi; bayat ekranda kalmak yerine login'e dondur
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw expiredSessionError();
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = { message: res.statusText };
    }
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body !== undefined ? JSON.stringify(body) : undefined }),
};

/** Aktif sirketi (tenant) degistir: yeni access token secilen uyeligin tenant'ina scoped doner. */
export function switchTenant(membershipId: string): Promise<{ accessToken: string; activeMembershipId: string }> {
  return api.post('/me/switch-tenant', { membershipId });
}

/** Login ozel: token henuz yok. */
/** 2FA etkin hesapta login 1. adimin donusu (tam oturum YERINE). */
export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
}

async function readOrThrow(res: Response): Promise<unknown> {
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = { message: res.statusText };
    }
    throw new ApiError(res.status, body);
  }
  return res.json();
}

export async function login(email: string, password: string): Promise<Session | MfaChallenge> {
  const res = await rawFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  return (await readOrThrow(res)) as Session | MfaChallenge;
}

/** Login 2. adim: challenge token + TOTP/kurtarma kodu -> tam oturum. */
export async function loginTwoFactor(mfaToken: string, code: string): Promise<Session> {
  const res = await rawFetch('/auth/login/2fa', { method: 'POST', body: JSON.stringify({ mfaToken, code }) });
  return (await readOrThrow(res)) as Session;
}

/** Markali subdomain girisi (Alt-proje B): giristen ONCE kimliksiz marka bilgisi. */
export interface TenantBrand {
  name: string;
  branding: { logoText?: string; tagline?: string; primaryColor?: string; accentColor?: string };
}
export function getTenantBrand(slug: string): Promise<TenantBrand> {
  return api.get<TenantBrand>(`/auth/tenant-brand/${encodeURIComponent(slug)}`);
}

/** Binary (PDF) indirme: POST + Bearer -> Blob. 401'de bir kez refresh dener. */
export async function postBlob(path: string, body?: unknown): Promise<Blob> {
  const session = sessionForRequest();
  const init: RequestInit = { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined };
  let res = await rawFetch(path, init, session?.accessToken);
  if (res.status === 401 && session) {
    const retrySession = await sessionForRetry(session);
    if (!retrySession) throw expiredSessionError();
    res = await rawFetch(path, init, retrySession.accessToken);
  }
  if (!res.ok) {
    let body2: unknown = null;
    try { body2 = await res.json(); } catch { body2 = { message: res.statusText }; }
    throw new ApiError(res.status, body2);
  }
  return res.blob();
}

/** CSV indirme: metin doner, Bearer ekler. */
export async function getCsv(path: string): Promise<string> {
  const session = sessionForRequest();
  let res = await rawFetch(path, {}, session?.accessToken);
  if (res.status === 401 && session) {
    const retrySession = await sessionForRetry(session);
    if (!retrySession) throw expiredSessionError();
    res = await rawFetch(path, {}, retrySession.accessToken);
  }
  if (!res.ok) throw new ApiError(res.status, { message: 'CSV indirilemedi' });
  return res.text();
}
