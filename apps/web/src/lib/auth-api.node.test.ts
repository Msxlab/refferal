import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, ApiError, getCsv, refreshSession } from './api';
import { getSession, setSession, type Session } from './auth';

const SESSION_KEY = 'refearn.session';

function makeSession(accessToken = 'access-token', refreshToken = 'legacy-refresh-token'): Session {
  return {
    accessToken,
    refreshToken,
    user: {
      id: 'user-1',
      email: 'member@example.test',
      fullName: 'Member Example',
      locale: 'en',
      emailVerified: true,
    },
    activeMembershipId: null,
    memberships: [],
  };
}

function makeWorkspaceSession(
  accessToken: string,
  userId: string,
  membershipId: string,
  tenantId: string,
): Session {
  return {
    ...makeSession(accessToken),
    user: {
      ...makeSession().user,
      id: userId,
      email: `${userId}@example.test`,
    },
    activeMembershipId: membershipId,
    memberships: [
      {
        id: membershipId,
        tenantId,
        tenantSlug: tenantId,
        tenantName: tenantId,
        role: 'member',
        referralCode: `${membershipId}-referral`,
        depth: 1,
      },
    ],
  };
}

function installBrowser(): { storage: Map<string, string>; removeCalls: () => number; restore: () => void } {
  const storage = new Map<string, string>();
  let removals = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const localStorage = {
    getItem(key: string): string | null {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      storage.set(key, value);
    },
    removeItem(key: string): void {
      removals += 1;
      storage.delete(key);
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  });

  return {
    storage,
    removeCalls: () => removals,
    restore: () => {
      if (previous) Object.defineProperty(globalThis, 'window', previous);
      else Reflect.deleteProperty(globalThis, 'window');
    },
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function installRefreshLockQueue(): {
  requests: Array<{ name: string; mode: string | undefined }>;
  requested: Promise<void>;
  releaseNext: () => boolean;
  restore: () => void;
} {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const requested = deferred();
  const requests: Array<{ name: string; mode: string | undefined }> = [];
  const pending: Array<() => void> = [];
  const locks = {
    request<T>(
      name: string,
      options: { mode?: string },
      callback: () => T | PromiseLike<T>,
    ): Promise<T> {
      requests.push({ name, mode: options.mode });
      requested.resolve();
      return new Promise<T>((resolve, reject) => {
        pending.push(() => {
          Promise.resolve(callback()).then(resolve, reject);
        });
      });
    },
  };

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks },
  });

  return {
    requests,
    requested: requested.promise,
    releaseNext: () => {
      const release = pending.shift();
      if (!release) return false;
      release();
      return true;
    },
    restore: () => {
      if (previous) Object.defineProperty(globalThis, 'navigator', previous);
      else Reflect.deleteProperty(globalThis, 'navigator');
    },
  };
}

function installFetch(fakeFetch: typeof fetch): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fakeFetch });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'fetch', previous);
    else Reflect.deleteProperty(globalThis, 'fetch');
  };
}

test('setSession never persists a refresh token', () => {
  const browser = installBrowser();
  try {
    setSession(makeSession());

    const persisted = JSON.parse(browser.storage.get(SESSION_KEY) ?? '{}') as Record<string, unknown>;
    assert.equal('refreshToken' in persisted, false);
    assert.equal('refreshToken' in (getSession() ?? {}), false);
  } finally {
    browser.restore();
  }
});

test('getSession immediately removes a legacy refresh token from storage', () => {
  const browser = installBrowser();
  try {
    browser.storage.set(SESSION_KEY, JSON.stringify(makeSession()));

    const session = getSession();
    const persisted = JSON.parse(browser.storage.get(SESSION_KEY) ?? '{}') as Record<string, unknown>;
    assert.equal(session?.refreshToken, undefined);
    assert.equal('refreshToken' in persisted, false);
  } finally {
    browser.restore();
  }
});

test('refresh migrates a legacy stored token through a cookie-only request', async () => {
  const browser = installBrowser();
  const legacySession = makeSession('expired-access-token');
  browser.storage.set(SESSION_KEY, JSON.stringify(legacySession));
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const restoreFetch = installFetch(async (input, init) => {
    calls.push({ input, init });
    return Response.json(makeSession('fresh-access-token', 'rotated-refresh-token'));
  });

  try {
    const refreshed = await refreshSession();

    assert.equal(refreshed?.accessToken, 'fresh-access-token');
    assert.equal(calls.length, 1);
    assert.equal(String(calls[0]?.input), 'http://localhost:3001/v1/auth/refresh');
    assert.equal(calls[0]?.init?.credentials, 'include');
    assert.equal(calls[0]?.init?.body, undefined);
    const persisted = JSON.parse(browser.storage.get(SESSION_KEY) ?? '{}') as Record<string, unknown>;
    assert.equal('refreshToken' in persisted, false);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('logout revokes the cookie session before clearing browser storage', async () => {
  const browser = installBrowser();
  setSession(makeSession());
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  let resolveRequest: ((response: Response) => void) | undefined;
  const restoreFetch = installFetch((input, init) => {
    calls.push({ input, init });
    return new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
  });

  try {
    const logout = (api as typeof api & { logout?: () => Promise<void> }).logout;
    assert.equal(typeof logout, 'function');
    if (!logout) return;

    const loggingOut = logout();
    assert.equal(String(calls[0]?.input), 'http://localhost:3001/v1/auth/logout');
    assert.equal(calls[0]?.init?.credentials, 'include');
    assert.equal(calls[0]?.init?.body, undefined);
    assert.equal(browser.storage.has(SESSION_KEY), true);

    resolveRequest?.(new Response(null, { status: 204 }));
    await loggingOut;
    assert.equal(browser.storage.has(SESSION_KEY), false);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('concurrent unauthorized requests share one refresh and retry with the same new access token', async () => {
  const browser = installBrowser();
  setSession(makeSession('expired-access-token'));
  const bothUnauthorized = deferred();
  const calls: Array<{ path: string; authorization: string | null }> = [];
  let unauthorizedCalls = 0;
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const authorization = new Headers(init?.headers).get('Authorization');
    calls.push({ path, authorization });

    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      await bothUnauthorized.promise;
      return Response.json(makeSession('fresh-access-token'));
    }
    if (authorization === 'Bearer expired-access-token') {
      unauthorizedCalls += 1;
      if (unauthorizedCalls === 2) bothUnauthorized.resolve();
      return new Response(null, { status: 401 });
    }
    return Response.json({ path });
  });

  try {
    const [first, second] = await Promise.all([
      api.get<{ path: string }>('/first-resource'),
      api.get<{ path: string }>('/second-resource'),
    ]);

    assert.equal(refreshCalls, 1);
    assert.deepEqual([first.path, second.path], [
      'http://localhost:3001/v1/first-resource',
      'http://localhost:3001/v1/second-resource',
    ]);
    const retries = calls.filter((call) => !call.path.endsWith('/auth/refresh') && call.authorization === 'Bearer fresh-access-token');
    assert.deepEqual(retries.map((call) => call.path), [
      'http://localhost:3001/v1/first-resource',
      'http://localhost:3001/v1/second-resource',
    ]);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('concurrent refresh failure clears the session once and rejects every waiter as unauthorized', async () => {
  const browser = installBrowser();
  setSession(makeSession('expired-access-token'));
  const bothUnauthorized = deferred();
  let unauthorizedCalls = 0;
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      await bothUnauthorized.promise;
      return Response.json({ message: 'refresh rejected' }, { status: 401 });
    }
    if (new Headers(init?.headers).get('Authorization') === 'Bearer expired-access-token') {
      unauthorizedCalls += 1;
      if (unauthorizedCalls === 2) bothUnauthorized.resolve();
      return new Response(null, { status: 401 });
    }
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const results = await Promise.allSettled([api.get('/first-resource'), api.get('/second-resource')]);

    assert.equal(refreshCalls, 1);
    assert.equal(browser.removeCalls(), 1);
    assert.equal(getSession(), null);
    for (const result of results) {
      assert.equal(result.status, 'rejected');
      if (result.status === 'rejected') {
        assert.ok(result.reason instanceof ApiError);
        assert.equal(result.reason.status, 401);
        assert.equal(result.reason.message, 'session expired');
      }
    }
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('concurrent refresh network failure clears the session once and rejects every waiter as unauthorized', async () => {
  const browser = installBrowser();
  setSession(makeSession('expired-access-token'));
  const bothUnauthorized = deferred();
  let unauthorizedCalls = 0;
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      await bothUnauthorized.promise;
      throw new TypeError('refresh network unavailable');
    }
    if (new Headers(init?.headers).get('Authorization') === 'Bearer expired-access-token') {
      unauthorizedCalls += 1;
      if (unauthorizedCalls === 2) bothUnauthorized.resolve();
      return new Response(null, { status: 401 });
    }
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const results = await Promise.allSettled([api.get('/first-resource'), api.get('/second-resource')]);

    assert.equal(refreshCalls, 1);
    assert.equal(browser.removeCalls(), 1);
    assert.equal(getSession(), null);
    for (const result of results) {
      assert.equal(result.status, 'rejected');
      if (result.status === 'rejected') {
        assert.ok(result.reason instanceof ApiError);
        assert.equal(result.reason.status, 401);
        assert.equal(result.reason.message, 'session expired');
      }
    }
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('explicit refresh and CSV retry share the active refresh result', async () => {
  const browser = installBrowser();
  setSession(makeSession('expired-access-token'));
  const csvUnauthorized = deferred();
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const authorization = new Headers(init?.headers).get('Authorization');
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      await csvUnauthorized.promise;
      return Response.json(makeSession('fresh-access-token'));
    }
    if (path.endsWith('/report.csv') && authorization === 'Bearer expired-access-token') {
      csvUnauthorized.resolve();
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/report.csv') && authorization === 'Bearer fresh-access-token') {
      return new Response('csv-data');
    }
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const [session, csv] = await Promise.all([refreshSession(), getCsv('/report.csv')]);

    assert.equal(refreshCalls, 1);
    assert.equal(session?.accessToken, 'fresh-access-token');
    assert.equal(csv, 'csv-data');
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('stale JSON and CSV operations never replay after the session changes during refresh', async () => {
  const browser = installBrowser();
  setSession(makeSession('user-a-expired-token'));
  const bothUnauthorized = deferred();
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const replayAuthorizations: Array<string | null> = [];
  let unauthorizedCalls = 0;
  let refreshCalls = 0;
  const userBSession: Session = {
    ...makeSession('user-b-current-token'),
    user: { ...makeSession().user, id: 'user-2', email: 'user-b@example.test' },
  };
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const authorization = new Headers(init?.headers).get('Authorization');
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json({ ...userBSession, accessToken: 'user-b-refreshed-token' });
    }
    if (
      (path.endsWith('/owned-resource') || path.endsWith('/owned-report.csv')) &&
      authorization === 'Bearer user-a-expired-token'
    ) {
      unauthorizedCalls += 1;
      if (unauthorizedCalls === 2) bothUnauthorized.resolve();
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/owned-resource') || path.endsWith('/owned-report.csv')) {
      replayAuthorizations.push(authorization);
      return path.endsWith('.csv') ? new Response('cross-session-csv') : Response.json({ crossSession: true });
    }
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const pending = Promise.allSettled([api.get('/owned-resource'), getCsv('/owned-report.csv')]);
    await Promise.all([bothUnauthorized.promise, refreshStarted.promise]);
    setSession(userBSession);
    releaseRefresh.resolve();
    const results = await pending;

    assert.equal(refreshCalls, 1);
    assert.deepEqual(replayAuthorizations, []);
    assert.equal(getSession()?.accessToken, 'user-b-current-token');
    for (const result of results) {
      assert.equal(result.status, 'rejected');
      if (result.status === 'rejected') {
        assert.ok(result.reason instanceof ApiError);
        assert.equal(result.reason.status, 401);
        assert.equal(result.reason.message, 'session expired');
      }
    }
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('logout invalidates an in-flight refresh so it cannot restore or replay the session', async () => {
  const browser = installBrowser();
  setSession(makeSession('expired-access-token'));
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const replayAuthorizations: Array<string | null> = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const authorization = new Headers(init?.headers).get('Authorization');
    if (path.endsWith('/auth/refresh')) {
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json(makeSession('resurrected-access-token'));
    }
    if (path.endsWith('/auth/logout')) return new Response(null, { status: 204 });
    if (path.endsWith('/owned-resource') && authorization === 'Bearer expired-access-token') {
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/owned-resource')) {
      replayAuthorizations.push(authorization);
      return Response.json({ resurrected: true });
    }
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const pending = api.get('/owned-resource');
    await refreshStarted.promise;
    await api.logout();
    assert.equal(getSession(), null);
    releaseRefresh.resolve();
    const result = await Promise.allSettled([pending]);

    assert.equal(result[0]?.status, 'rejected');
    if (result[0]?.status === 'rejected') {
      assert.ok(result[0].reason instanceof ApiError);
      assert.equal(result[0].reason.status, 401);
      assert.equal(result[0].reason.message, 'session expired');
    }
    assert.deepEqual(replayAuthorizations, []);
    assert.equal(browser.removeCalls(), 1);
    assert.equal(getSession(), null);
  } finally {
    releaseRefresh.resolve();
    restoreFetch();
    browser.restore();
  }
});

test('malformed successful refresh clears once and rejects every waiter as unauthorized', async () => {
  const browser = installBrowser();
  setSession(makeSession('expired-access-token'));
  const bothUnauthorized = deferred();
  const retryAuthorizations: Array<string | null> = [];
  let unauthorizedCalls = 0;
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const authorization = new Headers(init?.headers).get('Authorization');
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      await bothUnauthorized.promise;
      return Response.json({});
    }
    if (authorization === 'Bearer expired-access-token') {
      unauthorizedCalls += 1;
      if (unauthorizedCalls === 2) bothUnauthorized.resolve();
      return new Response(null, { status: 401 });
    }
    retryAuthorizations.push(authorization);
    return Response.json({ malformedRefreshWasUsed: true });
  });

  try {
    const results = await Promise.allSettled([api.get('/first-resource'), api.get('/second-resource')]);

    assert.equal(refreshCalls, 1);
    assert.equal(browser.removeCalls(), 1);
    assert.equal(getSession(), null);
    assert.deepEqual(retryAuthorizations, []);
    for (const result of results) {
      assert.equal(result.status, 'rejected');
      if (result.status === 'rejected') {
        assert.ok(result.reason instanceof ApiError);
        assert.equal(result.reason.status, 401);
        assert.equal(result.reason.message, 'session expired');
      }
    }
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('late JSON and CSV 401 responses reuse the already advanced token for the same workspace', async () => {
  const browser = installBrowser();
  const originalSession: Session = {
    ...makeSession('workspace-expired-token'),
    activeMembershipId: 'membership-1',
    memberships: [
      {
        id: 'membership-1',
        tenantId: 'tenant-1',
        tenantSlug: 'tenant-one',
        tenantName: 'Tenant One',
        role: 'member',
        referralCode: 'MEMBER1',
        depth: 1,
      },
    ],
  };
  const refreshedSession = { ...originalSession, accessToken: 'workspace-fresh-token' };
  setSession(originalSession);
  const releaseLateUnauthorized = deferred();
  const requestTokens = new Map<string, Array<string | null>>();
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const authorization = new Headers(init?.headers).get('Authorization');
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return Response.json(refreshedSession);
    }
    const calls = requestTokens.get(path) ?? [];
    calls.push(authorization);
    requestTokens.set(path, calls);
    if (path.endsWith('/fast-resource') && authorization === 'Bearer workspace-expired-token') {
      return new Response(null, { status: 401 });
    }
    if (
      (path.endsWith('/slow-resource') || path.endsWith('/slow-report.csv')) &&
      authorization === 'Bearer workspace-expired-token'
    ) {
      await releaseLateUnauthorized.promise;
      return new Response(null, { status: 401 });
    }
    if (authorization === 'Bearer workspace-fresh-token') {
      return path.endsWith('.csv') ? new Response('late-csv-data') : Response.json({ path });
    }
    throw new Error(`unexpected authorization for ${path}: ${authorization}`);
  });

  try {
    const fast = api.get<{ path: string }>('/fast-resource');
    const late = Promise.allSettled([
      api.get<{ path: string }>('/slow-resource'),
      getCsv('/slow-report.csv'),
    ]);

    assert.equal((await fast).path, 'http://localhost:3001/v1/fast-resource');
    assert.equal(getSession()?.accessToken, 'workspace-fresh-token');
    releaseLateUnauthorized.resolve();
    const lateResults = await late;

    assert.equal(refreshCalls, 1);
    assert.equal(lateResults[0]?.status, 'fulfilled');
    assert.equal(lateResults[1]?.status, 'fulfilled');
    if (lateResults[0]?.status === 'fulfilled') {
      assert.equal(lateResults[0].value.path, 'http://localhost:3001/v1/slow-resource');
    }
    if (lateResults[1]?.status === 'fulfilled') assert.equal(lateResults[1].value, 'late-csv-data');
    for (const path of [
      'http://localhost:3001/v1/fast-resource',
      'http://localhost:3001/v1/slow-resource',
      'http://localhost:3001/v1/slow-report.csv',
    ]) {
      assert.deepEqual(requestTokens.get(path), [
        'Bearer workspace-expired-token',
        'Bearer workspace-fresh-token',
      ]);
    }
  } finally {
    releaseLateUnauthorized.resolve();
    restoreFetch();
    browser.restore();
  }
});

test('JSON refresh rejects a different-user session without persisting or replaying it', async () => {
  const browser = installBrowser();
  const owner = makeWorkspaceSession('user-a-expired-token', 'user-a', 'membership-a', 'tenant-a');
  const mismatched = makeWorkspaceSession('user-b-refresh-token', 'user-b', 'membership-b', 'tenant-b');
  setSession(owner);
  const replayAuthorizations: Array<string | null> = [];
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const authorization = new Headers(init?.headers).get('Authorization');
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return Response.json(mismatched);
    }
    if (path.endsWith('/owned-resource') && authorization === 'Bearer user-a-expired-token') {
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/owned-resource')) {
      replayAuthorizations.push(authorization);
      return Response.json({ replayed: true });
    }
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const result = await Promise.allSettled([api.get('/owned-resource')]);

    assert.equal(refreshCalls, 1);
    assert.equal(result[0]?.status, 'rejected');
    if (result[0]?.status === 'rejected') {
      assert.ok(result[0].reason instanceof ApiError);
      assert.equal(result[0].reason.status, 401);
      assert.equal(result[0].reason.message, 'session expired');
    }
    assert.deepEqual(replayAuthorizations, []);
    assert.equal(browser.removeCalls(), 1);
    assert.equal(getSession(), null);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('CSV refresh rejects a different-workspace session without persisting or replaying it', async () => {
  const browser = installBrowser();
  const owner = makeWorkspaceSession('tenant-a-expired-token', 'user-a', 'membership-a', 'tenant-a');
  const mismatched = makeWorkspaceSession('tenant-b-refresh-token', 'user-a', 'membership-b', 'tenant-b');
  setSession(owner);
  const replayAuthorizations: Array<string | null> = [];
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const authorization = new Headers(init?.headers).get('Authorization');
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return Response.json(mismatched);
    }
    if (path.endsWith('/owned-report.csv') && authorization === 'Bearer tenant-a-expired-token') {
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/owned-report.csv')) {
      replayAuthorizations.push(authorization);
      return new Response('cross-workspace-csv');
    }
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const result = await Promise.allSettled([getCsv('/owned-report.csv')]);

    assert.equal(refreshCalls, 1);
    assert.equal(result[0]?.status, 'rejected');
    if (result[0]?.status === 'rejected') {
      assert.ok(result[0].reason instanceof ApiError);
      assert.equal(result[0].reason.status, 401);
      assert.equal(result[0].reason.message, 'session expired');
    }
    assert.deepEqual(replayAuthorizations, []);
    assert.equal(browser.removeCalls(), 1);
    assert.equal(getSession(), null);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('mismatched refresh response never clears an independently replaced session', async () => {
  const browser = installBrowser();
  const owner = makeWorkspaceSession('owner-expired-token', 'owner', 'membership-a', 'tenant-a');
  const replacement = makeWorkspaceSession('replacement-token', 'replacement', 'membership-c', 'tenant-c');
  const mismatched = makeWorkspaceSession('mismatched-token', 'mismatched', 'membership-b', 'tenant-b');
  setSession(owner);
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const replayAuthorizations: Array<string | null> = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const authorization = new Headers(init?.headers).get('Authorization');
    if (path.endsWith('/auth/refresh')) {
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json(mismatched);
    }
    if (path.endsWith('/owned-resource') && authorization === 'Bearer owner-expired-token') {
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/owned-resource')) {
      replayAuthorizations.push(authorization);
      return Response.json({ replayed: true });
    }
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const pending = api.get('/owned-resource');
    await refreshStarted.promise;
    setSession(replacement);
    releaseRefresh.resolve();
    const result = await Promise.allSettled([pending]);

    assert.equal(result[0]?.status, 'rejected');
    if (result[0]?.status === 'rejected') {
      assert.ok(result[0].reason instanceof ApiError);
      assert.equal(result[0].reason.status, 401);
    }
    assert.deepEqual(replayAuthorizations, []);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getSession()?.accessToken, 'replacement-token');
  } finally {
    releaseRefresh.resolve();
    restoreFetch();
    browser.restore();
  }
});

test('cross-tab refresh lock reuses a same-workspace session advanced while JSON and CSV retries wait', async () => {
  const browser = installBrowser();
  const locks = installRefreshLockQueue();
  const owner = makeWorkspaceSession('workspace-expired-token', 'user-a', 'membership-a', 'tenant-a');
  const advanced = { ...owner, accessToken: 'workspace-fresh-token' };
  setSession(owner);
  const refreshObserved = deferred();
  const requestTokens = new Map<string, Array<string | null>>();
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const authorization = new Headers(init?.headers).get('Authorization');
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshObserved.resolve();
      return Response.json(advanced);
    }
    const tokens = requestTokens.get(path) ?? [];
    tokens.push(authorization);
    requestTokens.set(path, tokens);
    if (authorization === 'Bearer workspace-expired-token') return new Response(null, { status: 401 });
    if (authorization === 'Bearer workspace-fresh-token') {
      return path.endsWith('.csv') ? new Response('cross-tab-csv') : Response.json({ crossTab: true });
    }
    throw new Error(`unexpected authorization for ${path}: ${authorization}`);
  });

  try {
    const pending = Promise.all([
      api.get<{ crossTab: boolean }>('/cross-tab-resource'),
      getCsv('/cross-tab-report.csv'),
    ]);
    const observed = await Promise.race([
      locks.requested.then(() => 'lock' as const),
      refreshObserved.promise.then(() => 'refresh' as const),
    ]);
    if (observed === 'lock') {
      setSession(advanced);
      assert.equal(locks.releaseNext(), true);
    }
    const [json, csv] = await pending;

    assert.equal(observed, 'lock');
    assert.deepEqual(locks.requests, [{ name: 'refearn.auth.refresh', mode: 'exclusive' }]);
    assert.equal(refreshCalls, 0);
    assert.deepEqual(json, { crossTab: true });
    assert.equal(csv, 'cross-tab-csv');
    assert.deepEqual(requestTokens.get('http://localhost:3001/v1/cross-tab-resource'), [
      'Bearer workspace-expired-token',
      'Bearer workspace-fresh-token',
    ]);
    assert.deepEqual(requestTokens.get('http://localhost:3001/v1/cross-tab-report.csv'), [
      'Bearer workspace-expired-token',
      'Bearer workspace-fresh-token',
    ]);
    assert.equal(getSession()?.accessToken, 'workspace-fresh-token');
  } finally {
    locks.releaseNext();
    restoreFetch();
    locks.restore();
    browser.restore();
  }
});

test('cross-tab refresh lock fails closed when the workspace changes while waiting', async () => {
  const browser = installBrowser();
  const locks = installRefreshLockQueue();
  const owner = makeWorkspaceSession('tenant-a-expired-token', 'user-a', 'membership-a', 'tenant-a');
  const ownerRefresh = { ...owner, accessToken: 'tenant-a-fresh-token' };
  const replacement = makeWorkspaceSession('tenant-a-expired-token', 'user-a', 'membership-b', 'tenant-b');
  setSession(owner);
  const refreshObserved = deferred();
  const replayAuthorizations: Array<string | null> = [];
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const authorization = new Headers(init?.headers).get('Authorization');
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshObserved.resolve();
      return Response.json(ownerRefresh);
    }
    if (path.endsWith('/workspace-resource') && authorization === 'Bearer tenant-a-expired-token') {
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/workspace-resource')) {
      replayAuthorizations.push(authorization);
      return Response.json({ replayed: true });
    }
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const pending = Promise.allSettled([api.get('/workspace-resource')]);
    const observed = await Promise.race([
      locks.requested.then(() => 'lock' as const),
      refreshObserved.promise.then(() => 'refresh' as const),
    ]);
    if (observed === 'lock') {
      setSession(replacement);
      assert.equal(locks.releaseNext(), true);
    }
    const result = await pending;

    assert.equal(observed, 'lock');
    assert.deepEqual(locks.requests, [{ name: 'refearn.auth.refresh', mode: 'exclusive' }]);
    assert.equal(refreshCalls, 0);
    assert.equal(result[0]?.status, 'rejected');
    if (result[0]?.status === 'rejected') {
      assert.ok(result[0].reason instanceof ApiError);
      assert.equal(result[0].reason.status, 401);
      assert.equal(result[0].reason.message, 'session expired');
    }
    assert.deepEqual(replayAuthorizations, []);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getSession()?.activeMembershipId, 'membership-b');
  } finally {
    locks.releaseNext();
    restoreFetch();
    locks.restore();
    browser.restore();
  }
});
