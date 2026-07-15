import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, ApiError, getCsv, postBlob, setActiveCompanyToken } from './api';
import { getSession, setSession, type Session } from './auth';

const SESSION_KEY = 'refearn.session';

function makeSession(accessToken = 'access-token', refreshToken = 'refresh-token'): Session {
  return {
    accessToken,
    refreshToken,
    user: {
      id: 'user-1',
      email: 'member@example.test',
      fullName: 'Member Example',
      locale: 'tr',
      emailVerified: true,
    },
    activeMembershipId: null,
    memberships: [],
  };
}

function makeWorkspaceSession(
  accessToken: string,
  refreshToken: string,
  userId: string,
  membershipId: string,
  tenantId: string,
): Session {
  return {
    ...makeSession(accessToken, refreshToken),
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function installBrowser(): {
  storage: Map<string, string>;
  removeCalls: () => number;
  location: { pathname: string; href: string };
  restore: () => void;
} {
  const storage = new Map<string, string>();
  const location = { pathname: '/app', href: '/app' };
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
    value: { localStorage, location },
  });

  return {
    storage,
    removeCalls: () => removals,
    location,
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

function installRefreshLockQueue(): {
  requests: Array<{ name: string; mode: string | undefined }>;
  requested: Promise<void>;
  releaseNext: () => boolean;
  rejectNext: (reason?: unknown) => boolean;
  restore: () => void;
} {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const requested = deferred();
  const requests: Array<{ name: string; mode: string | undefined }> = [];
  const pending: Array<{ release: () => void; reject: (reason?: unknown) => void }> = [];
  const locks = {
    request<T>(
      name: string,
      options: { mode?: string },
      callback: () => T | PromiseLike<T>,
    ): Promise<T> {
      requests.push({ name, mode: options.mode });
      requested.resolve();
      return new Promise<T>((resolve, reject) => {
        pending.push({
          release: () => {
            Promise.resolve(callback()).then(resolve, reject);
          },
          reject,
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
      const next = pending.shift();
      if (!next) return false;
      next.release();
      return true;
    },
    rejectNext: (reason) => {
      const next = pending.shift();
      if (!next) return false;
      next.reject(reason);
      return true;
    },
    restore: () => {
      if (previous) Object.defineProperty(globalThis, 'navigator', previous);
      else Reflect.deleteProperty(globalThis, 'navigator');
    },
  };
}

function authorization(init?: RequestInit): string | null {
  return new Headers(init?.headers).get('Authorization');
}

function assertExpired(result: PromiseSettledResult<unknown>): void {
  assert.equal(result.status, 'rejected');
  if (result.status === 'rejected') {
    assert.ok(result.reason instanceof ApiError);
    assert.equal(result.reason.status, 401);
    assert.equal(result.reason.message, 'oturum suresi doldu');
  }
}

test('concurrent JSON, CSV, and blob requests share one rotating refresh token request', async () => {
  const browser = installBrowser();
  const expired = makeSession('expired-access', 'rotating-refresh');
  const fresh = makeSession('fresh-access', 'next-refresh');
  setSession(expired);
  const allUnauthorized = deferred();
  let unauthorizedCalls = 0;
  let refreshCalls = 0;
  const refreshBodies: unknown[] = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshBodies.push(JSON.parse(String(init?.body)) as unknown);
      await allUnauthorized.promise;
      return Response.json(fresh);
    }
    if (bearer === 'Bearer expired-access') {
      unauthorizedCalls += 1;
      if (unauthorizedCalls === 3) allUnauthorized.resolve();
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/resource') && bearer === 'Bearer fresh-access') return Response.json({ ok: true });
    if (path.endsWith('/report.csv') && bearer === 'Bearer fresh-access') return new Response('csv-data');
    if (path.endsWith('/report.pdf') && bearer === 'Bearer fresh-access') return new Response('pdf-data');
    throw new Error(`unexpected request: ${path} (${bearer})`);
  });

  try {
    const [json, csv, blob] = await Promise.all([
      api.get<{ ok: boolean }>('/resource'),
      getCsv('/report.csv'),
      postBlob('/report.pdf'),
    ]);

    assert.deepEqual(json, { ok: true });
    assert.equal(csv, 'csv-data');
    assert.equal(await blob.text(), 'pdf-data');
    assert.equal(refreshCalls, 1);
    assert.deepEqual(refreshBodies, [{ refreshToken: 'rotating-refresh' }]);
    assert.equal(getSession()?.accessToken, 'fresh-access');
  } finally {
    allUnauthorized.resolve();
    restoreFetch();
    browser.restore();
  }
});

test('refresh network failure clears the owning session once and rejects as unauthorized', async () => {
  const browser = installBrowser();
  setSession(makeSession('expired-access', 'refresh-owner'));
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh')) throw new Error('network unavailable');
    if (authorization(init) === 'Bearer expired-access') return new Response(null, { status: 401 });
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const [result] = await Promise.allSettled([api.get('/protected')]);

    assertExpired(result);
    assert.equal(browser.removeCalls(), 1);
    assert.equal(getSession(), null);
    assert.equal(browser.location.href, '/login');
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('refresh rejects a different-user response without persisting or replaying it', async () => {
  const browser = installBrowser();
  const owner = makeWorkspaceSession('owner-expired', 'owner-refresh', 'owner', 'membership-a', 'tenant-a');
  const mismatched = makeWorkspaceSession('intruder-access', 'intruder-refresh', 'intruder', 'membership-b', 'tenant-b');
  setSession(owner);
  const replayAuthorizations: Array<string | null> = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) return Response.json(mismatched);
    if (path.endsWith('/owned-resource') && bearer === 'Bearer owner-expired') {
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/owned-resource')) {
      replayAuthorizations.push(bearer);
      return Response.json({ replayed: true });
    }
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const [result] = await Promise.allSettled([api.get('/owned-resource')]);

    assertExpired(result);
    assert.deepEqual(replayAuthorizations, []);
    assert.equal(browser.removeCalls(), 1);
    assert.equal(getSession(), null);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('an in-flight refresh cannot overwrite or replay after the session is replaced', async () => {
  const browser = installBrowser();
  const owner = makeWorkspaceSession('owner-expired', 'owner-refresh', 'owner', 'membership-a', 'tenant-a');
  const ownerFresh = { ...owner, accessToken: 'owner-fresh', refreshToken: 'owner-next-refresh' };
  const replacement = makeWorkspaceSession('replacement-access', 'replacement-refresh', 'replacement', 'membership-b', 'tenant-b');
  setSession(owner);
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const replayAuthorizations: Array<string | null> = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) {
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json(ownerFresh);
    }
    if (path.endsWith('/owned-resource') && bearer === 'Bearer owner-expired') {
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/owned-resource')) {
      replayAuthorizations.push(bearer);
      return Response.json({ replayed: true });
    }
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const pending = api.get('/owned-resource');
    await refreshStarted.promise;
    setSession(replacement);
    releaseRefresh.resolve();
    const [result] = await Promise.allSettled([pending]);

    assertExpired(result);
    assert.deepEqual(replayAuthorizations, []);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getSession()?.accessToken, 'replacement-access');
  } finally {
    releaseRefresh.resolve();
    restoreFetch();
    browser.restore();
  }
});

test('a late 401 reuses a same-workspace session that already advanced', async () => {
  const browser = installBrowser();
  const owner = makeWorkspaceSession('expired-access', 'expired-refresh', 'user-a', 'membership-a', 'tenant-a');
  const advanced = { ...owner, accessToken: 'advanced-access', refreshToken: 'advanced-refresh' };
  setSession(owner);
  const requestStarted = deferred();
  const releaseUnauthorized = deferred();
  let refreshCalls = 0;
  const requestTokens: Array<string | null> = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return Response.json({ ...advanced, accessToken: 'unexpected-refresh' });
    }
    if (path.endsWith('/late-resource')) {
      requestTokens.push(bearer);
      if (bearer === 'Bearer expired-access') {
        requestStarted.resolve();
        await releaseUnauthorized.promise;
        return new Response(null, { status: 401 });
      }
      if (bearer === 'Bearer advanced-access') return Response.json({ advanced: true });
    }
    throw new Error(`unexpected request: ${path} (${bearer})`);
  });

  try {
    const pending = api.get<{ advanced: boolean }>('/late-resource');
    await requestStarted.promise;
    setSession(advanced);
    releaseUnauthorized.resolve();
    const result = await pending;

    assert.deepEqual(result, { advanced: true });
    assert.equal(refreshCalls, 0);
    assert.deepEqual(requestTokens, ['Bearer expired-access', 'Bearer advanced-access']);
  } finally {
    releaseUnauthorized.resolve();
    restoreFetch();
    browser.restore();
  }
});

test('the cross-tab refresh lock reuses a same-workspace session advanced while waiting', async () => {
  const browser = installBrowser();
  const locks = installRefreshLockQueue();
  const owner = makeWorkspaceSession('expired-access', 'expired-refresh', 'user-a', 'membership-a', 'tenant-a');
  const advanced = { ...owner, accessToken: 'advanced-access', refreshToken: 'advanced-refresh' };
  setSession(owner);
  const refreshObserved = deferred();
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshObserved.resolve();
      return Response.json(advanced);
    }
    if (path.endsWith('/cross-tab-resource') && bearer === 'Bearer expired-access') {
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/cross-tab-resource') && bearer === 'Bearer advanced-access') {
      return Response.json({ crossTab: true });
    }
    throw new Error(`unexpected request: ${path} (${bearer})`);
  });

  try {
    const pending = api.get<{ crossTab: boolean }>('/cross-tab-resource');
    const observed = await Promise.race([
      locks.requested.then(() => 'lock' as const),
      refreshObserved.promise.then(() => 'refresh' as const),
    ]);
    if (observed === 'lock') {
      setSession(advanced);
      assert.equal(locks.releaseNext(), true);
    }
    const result = await pending;

    assert.equal(observed, 'lock');
    assert.deepEqual(locks.requests, [{ name: 'refearn.auth.refresh', mode: 'exclusive' }]);
    assert.equal(refreshCalls, 0);
    assert.deepEqual(result, { crossTab: true });
  } finally {
    locks.releaseNext();
    restoreFetch();
    locks.restore();
    browser.restore();
  }
});

test('a refresh-token-only replacement is preserved without replaying the same expired access token', async () => {
  const browser = installBrowser();
  const locks = installRefreshLockQueue();
  const owner = makeWorkspaceSession('expired-access', 'old-refresh', 'user-a', 'membership-a', 'tenant-a');
  const replacement = { ...owner, refreshToken: 'already-rotated-refresh' };
  setSession(owner);
  let protectedCalls = 0;
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return Response.json({ ...replacement, accessToken: 'unexpected-refresh' });
    }
    if (path.endsWith('/protected') && authorization(init) === 'Bearer expired-access') {
      protectedCalls += 1;
      return new Response(null, { status: 401 });
    }
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const pending = Promise.allSettled([api.get('/protected')]);
    await locks.requested;
    setSession(replacement);
    assert.equal(locks.releaseNext(), true);
    const [result] = await pending;

    assertExpired(result);
    assert.equal(protectedCalls, 1);
    assert.equal(refreshCalls, 0);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getSession()?.refreshToken, 'already-rotated-refresh');
  } finally {
    locks.releaseNext();
    restoreFetch();
    locks.restore();
    browser.restore();
  }
});

test('a rejected cross-tab refresh lock clears its owner once and rejects all local waiters', async () => {
  const browser = installBrowser();
  const locks = installRefreshLockQueue();
  const owner = makeWorkspaceSession('expired-access', 'expired-refresh', 'user-a', 'membership-a', 'tenant-a');
  setSession(owner);
  const bothUnauthorized = deferred();
  const refreshObserved = deferred();
  let unauthorizedCalls = 0;
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshObserved.resolve();
      return Response.json({ ...owner, accessToken: 'fresh-access', refreshToken: 'fresh-refresh' });
    }
    if (bearer === 'Bearer expired-access') {
      unauthorizedCalls += 1;
      if (unauthorizedCalls === 2) bothUnauthorized.resolve();
      await bothUnauthorized.promise;
      return new Response(null, { status: 401 });
    }
    return Response.json({ replayed: path });
  });

  try {
    const pending = Promise.allSettled([api.get('/first-resource'), getCsv('/second-report.csv')]);
    const observed = await Promise.race([
      locks.requested.then(() => 'lock' as const),
      refreshObserved.promise.then(() => 'refresh' as const),
    ]);
    if (observed === 'lock') {
      assert.equal(locks.rejectNext(new Error('lock manager unavailable')), true);
    }
    const results = await pending;

    assert.equal(observed, 'lock');
    assert.deepEqual(locks.requests, [{ name: 'refearn.auth.refresh', mode: 'exclusive' }]);
    assert.equal(refreshCalls, 0);
    assert.equal(browser.removeCalls(), 1);
    assert.equal(getSession(), null);
    results.forEach(assertExpired);
  } finally {
    bothUnauthorized.resolve();
    locks.rejectNext(new Error('test cleanup'));
    restoreFetch();
    locks.restore();
    browser.restore();
  }
});

test('same-token workspace ABA never lets a second workspace join the first refresh flight', async () => {
  const browser = installBrowser();
  const workspaceA = makeWorkspaceSession('shared-access', 'shared-refresh', 'user-a', 'membership-a', 'tenant-a');
  const workspaceB = makeWorkspaceSession('shared-access', 'shared-refresh', 'user-a', 'membership-b', 'tenant-b');
  const refreshedA = { ...workspaceA, accessToken: 'workspace-a-fresh', refreshToken: 'workspace-a-next' };
  setSession(workspaceA);
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const workspaceBUnauthorized = deferred();
  const workspaceBReplays: Array<string | null> = [];
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json(refreshedA);
    }
    if (path.endsWith('/workspace-a') && bearer === 'Bearer shared-access') {
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/workspace-a') && bearer === 'Bearer workspace-a-fresh') {
      return Response.json({ workspace: 'a' });
    }
    if (path.endsWith('/workspace-b') && bearer === 'Bearer shared-access') {
      workspaceBUnauthorized.resolve();
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/workspace-b')) {
      workspaceBReplays.push(bearer);
      return Response.json({ crossWorkspaceReplay: true });
    }
    throw new Error(`unexpected request: ${path} (${bearer})`);
  });

  try {
    const pendingA = api.get<{ workspace: string }>('/workspace-a');
    await refreshStarted.promise;
    setSession(workspaceB);
    const pendingB = api.get('/workspace-b');
    await workspaceBUnauthorized.promise;
    setSession(workspaceA);
    releaseRefresh.resolve();
    const [resultA, resultB] = await Promise.all([
      pendingA,
      Promise.allSettled([pendingB]).then(([result]) => result),
    ]);

    assert.deepEqual(resultA, { workspace: 'a' });
    assertExpired(resultB);
    assert.equal(refreshCalls, 1);
    assert.deepEqual(workspaceBReplays, []);
    assert.equal(getSession()?.activeMembershipId, 'membership-a');
  } finally {
    releaseRefresh.resolve();
    restoreFetch();
    browser.restore();
  }
});

test('an HQ override 401 never consumes the user refresh token', async () => {
  const browser = installBrowser();
  setSession(makeSession('user-access', 'user-refresh'));
  setActiveCompanyToken('hq-override');
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return Response.json(makeSession('unexpected-access', 'unexpected-refresh'));
    }
    assert.equal(authorization(init), 'Bearer hq-override');
    return Response.json({ message: 'override expired' }, { status: 401 });
  });

  try {
    const [result] = await Promise.allSettled([api.get('/admin/dashboard')]);

    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof ApiError);
      assert.equal(result.reason.status, 401);
    }
    assert.equal(refreshCalls, 0);
    assert.equal(getSession()?.accessToken, 'user-access');
  } finally {
    setActiveCompanyToken(null);
    restoreFetch();
    browser.restore();
  }
});
