import { clearSession, getSession, requiresMfaSetup, setSession, type Session } from './auth';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

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
  return fetch(`${BASE}${path}`, { ...init, credentials: 'include', headers });
}

let refreshInFlight: Promise<Session | null> | null = null;

/** Refresh once after an expired access token; clear the session if refresh fails. */
async function performRefresh(): Promise<Session | null> {
  try {
    const res = await rawFetch('/auth/refresh', {
      method: 'POST',
    });
    if (res.ok) {
      const next = (await res.json()) as Session;
      setSession(next);
      return next;
    }
  } catch {
    // Refresh transport, parsing, and session persistence failures all fail closed.
  }
  clearSession();
  return null;
}

function refresh(): Promise<Session | null> {
  if (refreshInFlight) return refreshInFlight;
  const current = performRefresh().finally(() => {
    if (refreshInFlight === current) refreshInFlight = null;
  });
  refreshInFlight = current;
  return current;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const session = getSession();
  const res = await rawFetch(path, init, session?.accessToken);

  if (res.status === 401 && session && retry) {
    const refreshed = await refresh();
    if (refreshed) return request<T>(path, init, false);
    throw new ApiError(401, { message: 'session expired' });
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = { message: res.statusText };
    }
    if (
      res.status === 403 &&
      session &&
      requiresMfaSetup(session) &&
      typeof window !== 'undefined' &&
      window.location.pathname !== '/mfa-setup'
    ) {
      window.location.assign('/mfa-setup');
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
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body !== undefined ? JSON.stringify(body) : undefined }),
  logout: async (): Promise<void> => {
    try {
      await rawFetch('/auth/logout', { method: 'POST' });
    } finally {
      clearSession();
    }
  },
};

export interface MfaChallenge {
  mfaRequired: true;
  challengeToken: string;
  expiresAt: string;
}

export function isMfaChallenge(value: Session | MfaChallenge): value is MfaChallenge {
  return 'mfaRequired' in value && value.mfaRequired === true;
}

/** Login is special: no bearer token exists yet. */
export async function login(email: string, password: string): Promise<Session | MfaChallenge> {
  const res = await rawFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
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
  const res = await rawFetch('/auth/login/2fa', { method: 'POST', body: JSON.stringify({ challengeToken, code }) });
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

export async function refreshSession(): Promise<Session | null> {
  const session = getSession();
  return session ? refresh() : null;
}

/** CSV download returns raw text and includes the bearer token. */
export async function getCsv(path: string): Promise<string> {
  const session = getSession();
  let res = await rawFetch(path, {}, session?.accessToken);
  if (res.status === 401 && session) {
    const refreshed = await refresh();
    if (!refreshed) throw new ApiError(401, { message: 'session expired' });
    res = await rawFetch(path, {}, refreshed.accessToken);
  }
  if (!res.ok) throw new ApiError(res.status, { message: 'CSV download failed' });
  return res.text();
}
