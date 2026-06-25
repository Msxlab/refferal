import { clearSession, getSession, setSession, type Session } from './auth';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

/** SSE/EventSource gibi fetch disi tuketiciler icin API kok adresi. */
export const API_BASE = BASE;

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(typeof body === 'object' && body && 'message' in body ? String((body as { message: unknown }).message) : `HTTP ${status}`);
  }
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
let refreshInFlight: Promise<Session | null> | null = null;
function refresh(session: Session): Promise<Session | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const current = getSession() ?? session;
      const res = await rawFetch('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (!res.ok) {
        clearSession();
        return null;
      }
      const next = (await res.json()) as Session;
      setSession(next);
      return next;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const session = getSession();
  const res = await rawFetch(path, init, session?.accessToken);

  if (res.status === 401 && session && retry) {
    const refreshed = await refresh(session);
    if (refreshed) return request<T>(path, init, false);
    // refresh basarisiz -> oturum temizlendi; bayat ekranda kalmak yerine login'e dondur
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiError(401, { message: 'oturum suresi doldu' });
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

/** Binary (PDF) indirme: POST + Bearer -> Blob. 401'de bir kez refresh dener. */
export async function postBlob(path: string, body?: unknown): Promise<Blob> {
  const session = getSession();
  const init: RequestInit = { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined };
  let res = await rawFetch(path, init, session?.accessToken);
  if (res.status === 401 && session) {
    const refreshed = await refresh(session);
    if (!refreshed) throw new ApiError(401, { message: 'oturum suresi doldu' });
    res = await rawFetch(path, init, refreshed.accessToken);
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
  const session = getSession();
  let res = await rawFetch(path, {}, session?.accessToken);
  if (res.status === 401 && session) {
    const refreshed = await refresh(session);
    if (!refreshed) throw new ApiError(401, { message: 'oturum suresi doldu' });
    res = await rawFetch(path, {}, refreshed.accessToken);
  }
  if (!res.ok) throw new ApiError(res.status, { message: 'CSV indirilemedi' });
  return res.text();
}
