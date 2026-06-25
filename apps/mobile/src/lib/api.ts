import { clearSession, loadSession, saveSession, type Session } from './auth';

/**
 * API taban adresi:
 *  - EXPO_PUBLIC_API_URL ile gecersiz kilinabilir (.env / app config)
 *  - Android emulatoru host makineye 10.0.2.2 ile ulasir (lokal API :3101)
 *  - Gercek cihazda LAN IP'nizi verin: EXPO_PUBLIC_API_URL=http://192.168.x.x:3101/v1
 */
const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3101/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(
      typeof body === 'object' && body && 'message' in body
        ? String((body as { message: unknown }).message)
        : `HTTP ${status}`,
    );
  }
}

async function rawFetch(path: string, init: RequestInit, token?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${BASE}${path}`, { ...init, headers });
}

/** access suresi dolmussa bir kez refresh dener; basarisizsa oturumu temizler. */
async function refresh(session: Session): Promise<Session | null> {
  const res = await rawFetch('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  if (!res.ok) {
    await clearSession();
    return null;
  }
  const next = (await res.json()) as Session;
  await saveSession(next);
  return next;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const session = await loadSession();
  const res = await rawFetch(path, init, session?.accessToken);

  if (res.status === 401 && session && retry) {
    const refreshed = await refresh(session);
    if (refreshed) return request<T>(path, init, false);
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
};

export interface MfaChallenge {
  mfaRequired: true;
  challengeToken: string;
  expiresAt: string;
}

export function isMfaChallenge(value: Session | MfaChallenge): value is MfaChallenge {
  return 'mfaRequired' in value && value.mfaRequired === true;
}

/** Login ozel: token henuz yok. */
export async function login(email: string, password: string): Promise<Session | MfaChallenge> {
  const res = await rawFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = { message: res.statusText };
    }
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as Session | MfaChallenge;
}

export async function loginMfa(challengeToken: string, code: string): Promise<Session> {
  const res = await rawFetch('/auth/login/2fa', {
    method: 'POST',
    body: JSON.stringify({ challengeToken, code }),
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = { message: res.statusText };
    }
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as Session;
}
