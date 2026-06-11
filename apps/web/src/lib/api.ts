import { clearSession, getSession, setSession, type Session } from './auth';

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
  return fetch(`${BASE}${path}`, { ...init, headers });
}

/** access token suresi dolmussa bir kez refresh dener; basarisizsa oturum kapatir. */
async function refresh(session: Session): Promise<Session | null> {
  const res = await rawFetch('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  if (!res.ok) {
    clearSession();
    return null;
  }
  const next = (await res.json()) as Session;
  setSession(next);
  return next;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const session = getSession();
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
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
};

/** Login ozel: token henuz yok. */
export async function login(email: string, password: string): Promise<Session> {
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
  return (await res.json()) as Session;
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
