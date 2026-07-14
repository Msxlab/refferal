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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSession(value: unknown): value is Session {
  if (!isRecord(value) || !isNonEmptyString(value.accessToken) || !isRecord(value.user)) return false;
  const user = value.user;
  if (
    !isNonEmptyString(user.id) ||
    !isNonEmptyString(user.email) ||
    !isNonEmptyString(user.fullName) ||
    !isNonEmptyString(user.locale) ||
    typeof user.emailVerified !== 'boolean' ||
    (user.isPlatformAdmin !== undefined && typeof user.isPlatformAdmin !== 'boolean') ||
    (value.refreshToken !== undefined && !isNonEmptyString(value.refreshToken)) ||
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

async function rawFetch(path: string, init: RequestInit, token?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${BASE}${path}`, { ...init, credentials: 'include', headers });
}

interface RefreshFlight {
  ownerAccessToken: string;
  generation: number;
  promise: Promise<Session | null>;
}

let refreshInFlight: RefreshFlight | null = null;
let refreshGeneration = 0;

function sessionMatches(accessToken: string): boolean {
  return getSession()?.accessToken === accessToken;
}

function ownsRefresh(ownerAccessToken: string, generation: number): boolean {
  return refreshGeneration === generation && sessionMatches(ownerAccessToken);
}

function sameSessionIdentity(captured: Session, current: Session): boolean {
  if (captured.user.id !== current.user.id || captured.activeMembershipId !== current.activeMembershipId) return false;
  if (captured.activeMembershipId === null) return true;
  const capturedMembership = captured.memberships.find((membership) => membership.id === captured.activeMembershipId);
  const currentMembership = current.memberships.find((membership) => membership.id === current.activeMembershipId);
  return Boolean(capturedMembership && currentMembership && capturedMembership.tenantId === currentMembership.tenantId);
}

function advancedSessionFor(captured: Session, generation: number): Session | null {
  if (generation !== refreshGeneration) return null;
  const current = getSession();
  if (
    !current ||
    !isSession(current) ||
    current.accessToken === captured.accessToken ||
    !sameSessionIdentity(captured, current)
  ) {
    return null;
  }
  return current;
}

/** Refresh once after an expired access token; clear the session if refresh fails. */
async function performRefresh(ownerAccessToken: string, generation: number): Promise<Session | null> {
  let next: Session | null = null;
  try {
    const res = await rawFetch('/auth/refresh', {
      method: 'POST',
    });
    if (res.ok) {
      const candidate: unknown = await res.json();
      if (isSession(candidate)) next = candidate;
    }
  } catch {
    // Refresh transport, parsing, and session persistence failures all fail closed.
  }
  if (!next) {
    if (ownsRefresh(ownerAccessToken, generation)) clearSession();
    return null;
  }
  if (!ownsRefresh(ownerAccessToken, generation)) return null;
  try {
    setSession(next);
    return next;
  } catch {
    clearSession();
    return null;
  }
}

function refresh(owner: Session, generation: number): Promise<Session | null> {
  if (!ownsRefresh(owner.accessToken, generation)) return Promise.resolve(null);
  if (refreshInFlight) {
    return refreshInFlight.ownerAccessToken === owner.accessToken && refreshInFlight.generation === generation
      ? refreshInFlight.promise
      : Promise.resolve(null);
  }
  let flight: RefreshFlight;
  const current = performRefresh(owner.accessToken, generation).finally(() => {
    if (refreshInFlight === flight) refreshInFlight = null;
  });
  flight = { ownerAccessToken: owner.accessToken, generation, promise: current };
  refreshInFlight = flight;
  return current;
}

async function sessionForRetry(captured: Session, generation: number): Promise<Session | null> {
  const advanced = advancedSessionFor(captured, generation);
  if (advanced) return advanced;
  const refreshed = await refresh(captured, generation);
  if (refreshed && sessionMatches(refreshed.accessToken)) return refreshed;
  return advancedSessionFor(captured, generation);
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
  session = getSession(),
  generation = refreshGeneration,
): Promise<T> {
  const res = await rawFetch(path, init, session?.accessToken);

  if (res.status === 401 && session && retry) {
    const retrySession = await sessionForRetry(session, generation);
    if (retrySession) return request<T>(path, init, false, retrySession, generation);
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
    refreshGeneration += 1;
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
  const generation = refreshGeneration;
  const session = getSession();
  return session ? refresh(session, generation) : null;
}

/** CSV download returns raw text and includes the bearer token. */
export async function getCsv(path: string): Promise<string> {
  const generation = refreshGeneration;
  const session = getSession();
  let res = await rawFetch(path, {}, session?.accessToken);
  if (res.status === 401 && session) {
    const retrySession = await sessionForRetry(session, generation);
    if (!retrySession) throw new ApiError(401, { message: 'session expired' });
    res = await rawFetch(path, {}, retrySession.accessToken);
  }
  if (!res.ok) throw new ApiError(res.status, { message: 'CSV download failed' });
  return res.text();
}
