import { clearSession, loadSession, saveSession, type Session } from './auth';

/**
 * API base URL:
 *  - EXPO_PUBLIC_API_URL can override this (.env / app config).
 *  - Android emulators reach the host machine at 10.0.2.2 (local API :3101).
 *  - On a real device, provide your LAN IP: EXPO_PUBLIC_API_URL=http://192.168.x.x:3101/v1.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSession(value: unknown): value is Session {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.accessToken) ||
    !isNonEmptyString(value.refreshToken) ||
    !isRecord(value.user) ||
    !Array.isArray(value.memberships)
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
    (value.activeMembershipId !== null && !isNonEmptyString(value.activeMembershipId))
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
  return fetch(`${BASE}${path}`, { ...init, headers });
}

interface RefreshFlight {
  owner: Session;
  promise: Promise<Session | null>;
}

interface CompletedRefresh {
  owner: Session;
  refreshed: Session;
}

let refreshInFlight: RefreshFlight | null = null;
let completedRefresh: CompletedRefresh | null = null;

function sameSessionIdentity(captured: Session, current: Session): boolean {
  if (captured.user.id !== current.user.id || captured.activeMembershipId !== current.activeMembershipId) return false;
  if (captured.activeMembershipId === null) return true;
  const capturedMembership = captured.memberships.find((membership) => membership.id === captured.activeMembershipId);
  const currentMembership = current.memberships.find((membership) => membership.id === current.activeMembershipId);
  return Boolean(capturedMembership && currentMembership && capturedMembership.tenantId === currentMembership.tenantId);
}

function sameSessionOwner(captured: Session, current: Session): boolean {
  return (
    captured.accessToken === current.accessToken &&
    captured.refreshToken === current.refreshToken &&
    sameSessionIdentity(captured, current)
  );
}

function sameSessionSnapshot(captured: Session, current: Session): boolean {
  return (
    sameSessionOwner(captured, current) &&
    captured.user.email === current.user.email &&
    captured.user.fullName === current.user.fullName &&
    captured.user.locale === current.user.locale &&
    captured.user.emailVerified === current.user.emailVerified &&
    captured.user.isPlatformAdmin === current.user.isPlatformAdmin &&
    captured.memberships.length === current.memberships.length &&
    captured.memberships.every((membership, index) => {
      const other = current.memberships[index];
      return Boolean(
        other &&
          membership.id === other.id &&
          membership.tenantId === other.tenantId &&
          membership.tenantSlug === other.tenantSlug &&
          membership.tenantName === other.tenantName &&
          membership.role === other.role &&
          membership.referralCode === other.referralCode &&
          membership.depth === other.depth,
      );
    })
  );
}

async function ownsSession(owner: Session): Promise<boolean> {
  try {
    const current = await loadSession();
    return Boolean(current && isSession(current) && sameSessionSnapshot(owner, current));
  } catch {
    return false;
  }
}

async function clearRefreshSessions(...sessions: Session[]): Promise<void> {
  try {
    const current = await loadSession();
    if (current && isSession(current) && sessions.some((session) => sameSessionSnapshot(session, current))) {
      await clearSession();
    }
  } catch {
    // Storage failures must not leak transport or persistence errors to refresh waiters.
  }
}

async function completedSessionFor(captured: Session): Promise<Session | null> {
  const completed = completedRefresh;
  if (!completed || !sameSessionSnapshot(captured, completed.owner)) return null;
  try {
    const current = await loadSession();
    if (current && isSession(current) && sameSessionSnapshot(completed.refreshed, current)) {
      return completed.refreshed;
    }
  } catch {
    // A storage read failure makes the advancement unusable.
  }
  if (completedRefresh === completed) completedRefresh = null;
  return null;
}

/** If the access token expired, try one refresh; clear the session if it fails. */
async function performRefresh(owner: Session): Promise<Session | null> {
  if (!(await ownsSession(owner))) return null;
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
    // Refresh transport and parsing failures are normalized below.
  }
  if (!next) {
    await clearRefreshSessions(owner);
    return null;
  }
  if (!(await ownsSession(owner))) return null;
  try {
    await saveSession(next);
  } catch {
    await clearRefreshSessions(owner, next);
    return null;
  }
  return (await ownsSession(next)) ? next : null;
}

function refresh(owner: Session): Promise<Session | null> {
  if (refreshInFlight) {
    return sameSessionSnapshot(refreshInFlight.owner, owner) ? refreshInFlight.promise : Promise.resolve(null);
  }
  let flight: RefreshFlight;
  const current = performRefresh(owner)
    .then((refreshed) => {
      if (refreshed) completedRefresh = { owner, refreshed };
      return refreshed;
    })
    .finally(() => {
      if (refreshInFlight === flight) refreshInFlight = null;
    });
  flight = { owner, promise: current };
  refreshInFlight = flight;
  return current;
}

async function retrySessionFor(captured: Session, candidate: Session | null): Promise<Session | null> {
  if (!candidate || !sameSessionIdentity(captured, candidate)) return null;
  return (await ownsSession(candidate)) ? candidate : null;
}

async function sessionForRetry(captured: Session): Promise<Session | null> {
  const completed = await completedSessionFor(captured);
  if (completed) return completed;
  return retrySessionFor(captured, await refresh(captured));
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
  capturedSession?: Session | null,
): Promise<T> {
  const session = capturedSession === undefined ? await loadSession() : capturedSession;
  const res = await rawFetch(path, init, session?.accessToken);

  if (res.status === 401 && session && retry) {
    const refreshed = await sessionForRetry(session);
    if (refreshed) return request<T>(path, init, false, refreshed);
    throw new ApiError(401, { message: 'session expired' });
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

/** Login is special: there is no token yet. */
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
