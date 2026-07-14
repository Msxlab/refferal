import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, refreshSession } from './api';
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

function installBrowser(): { storage: Map<string, string>; restore: () => void } {
  const storage = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const localStorage = {
    getItem(key: string): string | null {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      storage.set(key, value);
    },
    removeItem(key: string): void {
      storage.delete(key);
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  });

  return {
    storage,
    restore: () => {
      if (previous) Object.defineProperty(globalThis, 'window', previous);
      else Reflect.deleteProperty(globalThis, 'window');
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
