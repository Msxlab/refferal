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
