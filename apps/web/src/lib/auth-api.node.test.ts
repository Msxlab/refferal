import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  api,
  ApiError,
  getActiveCompanyToken,
  getCsv,
  postBlob,
  setActiveCompanyToken,
} from './api';
import {
  applyTenantSwitch,
  clearSession,
  getSession,
  setSession,
  startImpersonation,
  stopImpersonation,
  updateSession,
  type Session,
} from './auth';

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

interface StorageFailures {
  getItem?: unknown;
  setItem?: unknown;
  removeItem?: unknown;
}

function installBrowser(failures: StorageFailures = {}): {
  storage: Map<string, string>;
  setCalls: () => number;
  removeCalls: () => number;
  location: { pathname: string; href: string };
  restore: () => void;
} {
  const storage = new Map<string, string>();
  const location = { pathname: '/app', href: '/app' };
  let writes = 0;
  let removals = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const localStorage = {
    getItem(key: string): string | null {
      if (Object.hasOwn(failures, 'getItem')) throw failures.getItem;
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      writes += 1;
      if (Object.hasOwn(failures, 'setItem')) throw failures.setItem;
      storage.set(key, value);
    },
    removeItem(key: string): void {
      removals += 1;
      if (Object.hasOwn(failures, 'removeItem')) throw failures.removeItem;
      storage.delete(key);
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage, location },
  });

  return {
    storage,
    setCalls: () => writes,
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
  let mutationTail: Promise<void> = Promise.resolve();
  const locks = {
    request<T>(
      name: string,
      options: { mode?: string },
      callback: () => T | PromiseLike<T>,
    ): Promise<T> {
      requests.push({ name, mode: options.mode });
      if (name !== 'refearn.auth.refresh') {
        const run = mutationTail.then(() => callback());
        mutationTail = run.then(() => undefined, () => undefined);
        return run;
      }
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

function installCoordinatedLockManager(): {
  requests: Array<{ name: string; mode: string | undefined }>;
  holdNext: (name: string) => { requested: Promise<void>; release: () => void };
  requestCount: (name: string) => number;
  waitForRequestCount: (name: string, count: number) => Promise<void>;
  restore: () => void;
} {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const requests: Array<{ name: string; mode: string | undefined }> = [];
  const tails = new Map<string, Promise<void>>();
  const gates = new Map<string, Array<{ requested: ReturnType<typeof deferred>; released: ReturnType<typeof deferred> }>>();
  const waiters: Array<{ name: string; count: number; ready: ReturnType<typeof deferred> }> = [];

  function notifyWaiters(): void {
    for (const waiter of waiters) {
      if (requests.filter((request) => request.name === waiter.name).length >= waiter.count) {
        waiter.ready.resolve();
      }
    }
  }

  const locks = {
    request<T>(
      name: string,
      options: { mode?: string },
      callback: () => T | PromiseLike<T>,
    ): Promise<T> {
      requests.push({ name, mode: options.mode });
      notifyWaiters();
      const gate = gates.get(name)?.shift();
      const previousTail = tails.get(name) ?? Promise.resolve();
      const run = previousTail.then(async () => {
        if (gate) {
          gate.requested.resolve();
          await gate.released.promise;
        }
        return callback();
      });
      tails.set(name, run.then(() => undefined, () => undefined));
      return run;
    },
  };

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks },
  });

  return {
    requests,
    holdNext: (name) => {
      const gate = { requested: deferred(), released: deferred() };
      const queued = gates.get(name) ?? [];
      queued.push(gate);
      gates.set(name, queued);
      return { requested: gate.requested.promise, release: gate.released.resolve };
    },
    requestCount: (name) => requests.filter((request) => request.name === name).length,
    waitForRequestCount: (name, count) => {
      if (requests.filter((request) => request.name === name).length >= count) return Promise.resolve();
      const ready = deferred();
      waiters.push({ name, count, ready });
      return ready.promise;
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
  await setSession(expired);
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

test('refresh network failure clears the owning session and active-company state once', async () => {
  const browser = installBrowser();
  await setSession(makeSession('expired-access', 'refresh-owner'));
  setActiveCompanyToken('active-company-token');
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
    assert.equal(getActiveCompanyToken(), null);
    assert.equal(browser.location.href, '/login');
  } finally {
    setActiveCompanyToken(null);
    restoreFetch();
    browser.restore();
  }
});

test('refresh rejects a different-user response without persisting or replaying it', async () => {
  const browser = installBrowser();
  const owner = makeWorkspaceSession('owner-expired', 'owner-refresh', 'owner', 'membership-a', 'tenant-a');
  const mismatched = makeWorkspaceSession('intruder-access', 'intruder-refresh', 'intruder', 'membership-b', 'tenant-b');
  await setSession(owner);
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
  await setSession(owner);
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
    await setSession(replacement);
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
  await setSession(owner);
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
    await setSession(advanced);
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
  await setSession(owner);
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
      await setSession(advanced);
      assert.equal(locks.releaseNext(), true);
    }
    const result = await pending;

    assert.equal(observed, 'lock');
    assert.deepEqual(
      locks.requests.filter((request) => request.name === 'refearn.auth.refresh'),
      [{ name: 'refearn.auth.refresh', mode: 'exclusive' }],
    );
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
  await setSession(owner);
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
    await setSession(replacement);
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
  await setSession(owner);
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
    assert.deepEqual(
      locks.requests.filter((request) => request.name === 'refearn.auth.refresh'),
      [{ name: 'refearn.auth.refresh', mode: 'exclusive' }],
    );
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
  await setSession(workspaceA);
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
    await setSession(workspaceB);
    const pendingB = api.get('/workspace-b');
    await workspaceBUnauthorized.promise;
    await setSession(workspaceA);
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
  await setSession(makeSession('user-access', 'user-refresh'));
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

test('session getItem failures fail closed without mutating unread storage', async () => {
  const failures: StorageFailures = { getItem: new Error('storage read denied') };
  const browser = installBrowser(failures);
  const storedRaw = JSON.stringify(makeSession('stored-access', 'stored-refresh'));
  browser.storage.set(SESSION_KEY, storedRaw);
  setActiveCompanyToken('active-company-token');
  let fetchCalls = 0;
  const restoreFetch = installFetch(async () => {
    fetchCalls += 1;
    return Response.json({ unexpected: true });
  });

  try {
    const results = await Promise.allSettled([
      api.get('/protected-json'),
      getCsv('/protected.csv'),
      postBlob('/protected.pdf'),
    ]);

    results.forEach(assertExpired);
    assert.equal(fetchCalls, 0);
    assert.equal(browser.storage.get(SESSION_KEY), storedRaw);
    assert.equal(browser.setCalls(), 0);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getActiveCompanyToken(), null);
  } finally {
    setActiveCompanyToken(null);
    restoreFetch();
    browser.restore();
  }
});

test('a getItem failure preserves an independent replacement for a later successful read', async () => {
  const failures: StorageFailures = { getItem: new Error('transient storage read failure') };
  const browser = installBrowser(failures);
  const replacement = makeWorkspaceSession(
    'replacement-access',
    'replacement-refresh',
    'replacement',
    'membership-b',
    'tenant-b',
  );
  const replacementRaw = JSON.stringify(replacement);
  browser.storage.set(SESSION_KEY, replacementRaw);
  setActiveCompanyToken('replacement-company-token');
  let fetchCalls = 0;
  const restoreFetch = installFetch(async () => {
    fetchCalls += 1;
    return Response.json({ unexpected: true });
  });

  try {
    const [result] = await Promise.allSettled([api.get('/protected')]);

    assertExpired(result);
    assert.equal(fetchCalls, 0);
    assert.equal(browser.storage.get(SESSION_KEY), replacementRaw);
    assert.equal(browser.setCalls(), 0);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getActiveCompanyToken(), null);

    delete failures.getItem;
    assert.deepEqual(getSession(), replacement);
  } finally {
    delete failures.getItem;
    setActiveCompanyToken(null);
    restoreFetch();
    browser.restore();
  }
});

test('public setSession rethrows persistence failures', async () => {
  const writeError = new Error('storage write denied');
  const failures: StorageFailures = { setItem: writeError };
  const browser = installBrowser(failures);

  try {
    await assert.rejects(
      setSession(makeSession('new-access', 'new-refresh')),
      (error: unknown) => error === writeError,
    );
    assert.equal(browser.setCalls(), 1);
    assert.equal(browser.storage.has(SESSION_KEY), false);
  } finally {
    delete failures.setItem;
    browser.restore();
  }
});

test('public clearSession rethrows removal failures after clearing active-company state', async () => {
  const removalError = new Error('storage removal denied');
  const failures: StorageFailures = { removeItem: removalError };
  const browser = installBrowser(failures);
  browser.storage.set(SESSION_KEY, JSON.stringify(makeSession('stored-access', 'stored-refresh')));
  setActiveCompanyToken('active-company-token');

  try {
    await assert.rejects(clearSession(), (error: unknown) => error === removalError);
    assert.equal(browser.removeCalls(), 1);
    assert.equal(browser.storage.has(SESSION_KEY), true);
    assert.equal(getActiveCompanyToken(), null);
  } finally {
    delete failures.removeItem;
    setActiveCompanyToken(null);
    browser.restore();
  }
});

test('public clearSession clears active-company state when the mutation lock rejects', async () => {
  const browser = installBrowser();
  const lockError = new Error('session mutation lock unavailable');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  browser.storage.set(SESSION_KEY, JSON.stringify(makeSession('stored-access', 'stored-refresh')));
  setActiveCompanyToken('active-company-token');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request<T>(): Promise<T> {
          return Promise.reject(lockError);
        },
      },
    },
  });

  try {
    await assert.rejects(clearSession(), (error: unknown) => error === lockError);
    assert.equal(browser.storage.has(SESSION_KEY), true);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getActiveCompanyToken(), null);
  } finally {
    setActiveCompanyToken(null);
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
    browser.restore();
  }
});

test('public getSession rethrows storage access failures without writing', () => {
  const readError = new Error('storage read denied');
  const failures: StorageFailures = { getItem: readError };
  const browser = installBrowser(failures);
  const storedRaw = JSON.stringify(makeSession('stored-access', 'stored-refresh'));
  browser.storage.set(SESSION_KEY, storedRaw);

  try {
    assert.throws(() => getSession(), (error: unknown) => error === readError);
    assert.equal(browser.storage.get(SESSION_KEY), storedRaw);
    assert.equal(browser.setCalls(), 0);
    assert.equal(browser.removeCalls(), 0);
  } finally {
    delete failures.getItem;
    browser.restore();
  }
});

test('public getSession rethrows parse and invalid-shape failures', () => {
  const browser = installBrowser();

  try {
    browser.storage.set(SESSION_KEY, '{not-json');
    assert.throws(() => getSession(), SyntaxError);

    browser.storage.set(
      SESSION_KEY,
      JSON.stringify({ accessToken: 'unsafe-access', refreshToken: 'unsafe-refresh', user: null }),
    );
    assert.throws(() => getSession(), /invalid session/i);
  } finally {
    browser.restore();
  }
});

test('startImpersonation aborts before any write when the current session read fails', async () => {
  const readError = new Error('storage read denied');
  const failures: StorageFailures = { getItem: readError };
  const browser = installBrowser(failures);

  try {
    await assert.rejects(
      Promise.resolve().then(() => startImpersonation(makeSession('imp-access', ''))),
      (error: unknown) => error === readError,
    );
    assert.equal(browser.setCalls(), 0);
    assert.equal(browser.removeCalls(), 0);
  } finally {
    delete failures.getItem;
    browser.restore();
  }
});

test('applyTenantSwitch aborts before any write when the current session read fails', async () => {
  const readError = new Error('storage read denied');
  const failures: StorageFailures = { getItem: readError };
  const browser = installBrowser(failures);

  try {
    await assert.rejects(
      Promise.resolve().then(() => applyTenantSwitch('switched-access', 'membership-b')),
      (error: unknown) => error === readError,
    );
    assert.equal(browser.setCalls(), 0);
    assert.equal(browser.removeCalls(), 0);
  } finally {
    delete failures.getItem;
    browser.restore();
  }
});

test('profile-style updateSession aborts before write or success after a read failure', async () => {
  const readError = new Error('storage read denied');
  const failures: StorageFailures = { getItem: readError };
  const browser = installBrowser(failures);
  let completed = false;

  try {
    await assert.rejects(
      Promise.resolve()
        .then(() => updateSession((session) => ({
          ...session,
          user: { ...session.user, fullName: 'Updated Name' },
        })))
        .then(() => { completed = true; }),
      (error: unknown) => error === readError,
    );
    assert.equal(completed, false);
    assert.equal(browser.setCalls(), 0);
    assert.equal(browser.removeCalls(), 0);
  } finally {
    delete failures.getItem;
    browser.restore();
  }
});

test('invalid stored JSON is cleared and normalized to unauthorized before fetch', async () => {
  const browser = installBrowser();
  browser.storage.set(SESSION_KEY, '{not-json');
  setActiveCompanyToken('active-company-token');
  let fetchCalls = 0;
  const restoreFetch = installFetch(async () => {
    fetchCalls += 1;
    return Response.json({ unexpected: true });
  });

  try {
    const [result] = await Promise.allSettled([api.get('/protected')]);

    assertExpired(result);
    assert.equal(fetchCalls, 0);
    assert.equal(browser.storage.has(SESSION_KEY), false);
    assert.equal(browser.removeCalls(), 1);
    assert.equal(getActiveCompanyToken(), null);
  } finally {
    setActiveCompanyToken(null);
    restoreFetch();
    browser.restore();
  }
});

test('a malformed stored Session is rejected and cleared before fetch', async () => {
  const browser = installBrowser();
  browser.storage.set(
    SESSION_KEY,
    JSON.stringify({ accessToken: 'unsafe-access', refreshToken: 'unsafe-refresh', user: null }),
  );
  let fetchCalls = 0;
  const restoreFetch = installFetch(async () => {
    fetchCalls += 1;
    return Response.json({ unexpected: true });
  });

  try {
    const [result] = await Promise.allSettled([api.get('/protected')]);

    assertExpired(result);
    assert.equal(fetchCalls, 0);
    assert.equal(browser.storage.has(SESSION_KEY), false);
    assert.equal(browser.removeCalls(), 1);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('an HTTP refresh failure normalizes to 401 and clears the owner and active-company token', async () => {
  const browser = installBrowser();
  await setSession(makeSession('expired-access', 'refresh-owner'));
  setActiveCompanyToken('active-company-token');
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh')) {
      return Response.json({ message: 'refresh unavailable' }, { status: 503 });
    }
    if (authorization(init) === 'Bearer expired-access') return new Response(null, { status: 401 });
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const [result] = await Promise.allSettled([api.get('/protected')]);

    assertExpired(result);
    assert.equal(browser.storage.has(SESSION_KEY), false);
    assert.equal(browser.removeCalls(), 1);
    assert.equal(getActiveCompanyToken(), null);
  } finally {
    setActiveCompanyToken(null);
    restoreFetch();
    browser.restore();
  }
});

test('invalid JSON from refresh normalizes to 401 and clears the owner', async () => {
  const browser = installBrowser();
  await setSession(makeSession('expired-access', 'refresh-owner'));
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh')) {
      return new Response('{not-json', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (authorization(init) === 'Bearer expired-access') return new Response(null, { status: 401 });
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const [result] = await Promise.allSettled([api.get('/protected')]);

    assertExpired(result);
    assert.equal(browser.storage.has(SESSION_KEY), false);
    assert.equal(browser.removeCalls(), 1);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('a malformed refresh Session normalizes to 401 and is never persisted or replayed', async () => {
  const browser = installBrowser();
  await setSession(makeSession('expired-access', 'refresh-owner'));
  const replayTokens: Array<string | null> = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) {
      return Response.json({ accessToken: 'malformed-access', refreshToken: 'malformed-refresh' });
    }
    if (bearer === 'Bearer expired-access') return new Response(null, { status: 401 });
    replayTokens.push(bearer);
    return Response.json({ unexpected: true });
  });

  try {
    const [result] = await Promise.allSettled([api.get('/protected')]);

    assertExpired(result);
    assert.deepEqual(replayTokens, []);
    assert.equal(browser.storage.has(SESSION_KEY), false);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('refresh uses no-throw cleanup when setItem fails and normalizes to 401', async () => {
  const failures: StorageFailures = {};
  const browser = installBrowser(failures);
  const owner = makeSession('expired-access', 'refresh-owner');
  const fresh = makeSession('fresh-access', 'fresh-refresh');
  await setSession(owner);
  setActiveCompanyToken('active-company-token');
  failures.setItem = new Error('storage write denied');
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh')) return Response.json(fresh);
    if (authorization(init) === 'Bearer expired-access') return new Response(null, { status: 401 });
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const [result] = await Promise.allSettled([api.get('/protected')]);

    assertExpired(result);
    assert.equal(browser.storage.has(SESSION_KEY), false);
    assert.equal(browser.removeCalls(), 1);
    assert.equal(getActiveCompanyToken(), null);
  } finally {
    setActiveCompanyToken(null);
    restoreFetch();
    browser.restore();
  }
});

test('refresh uses no-throw cleanup when removeItem fails and normalizes to 401', async () => {
  const failures: StorageFailures = {};
  const browser = installBrowser(failures);
  await setSession(makeSession('expired-access', 'refresh-owner'));
  setActiveCompanyToken('active-company-token');
  failures.removeItem = new Error('storage removal denied');
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh')) {
      return Response.json({ message: 'refresh unavailable' }, { status: 503 });
    }
    if (authorization(init) === 'Bearer expired-access') return new Response(null, { status: 401 });
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const [result] = await Promise.allSettled([api.get('/protected')]);

    assertExpired(result);
    assert.equal(browser.storage.has(SESSION_KEY), true);
    assert.equal(browser.removeCalls(), 1);
    assert.equal(getActiveCompanyToken(), null);
  } finally {
    delete failures.removeItem;
    setActiveCompanyToken(null);
    restoreFetch();
    browser.restore();
  }
});

test('a same-user refresh response for a different membership and tenant is rejected', async () => {
  const browser = installBrowser();
  const owner = makeWorkspaceSession('expired-access', 'refresh-owner', 'same-user', 'membership-a', 'tenant-a');
  const wrongWorkspace = makeWorkspaceSession('wrong-access', 'wrong-refresh', 'same-user', 'membership-b', 'tenant-b');
  await setSession(owner);
  const replayTokens: Array<string | null> = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) return Response.json(wrongWorkspace);
    if (bearer === 'Bearer expired-access') return new Response(null, { status: 401 });
    replayTokens.push(bearer);
    return Response.json({ unexpected: true });
  });

  try {
    const [result] = await Promise.allSettled([api.get('/protected')]);

    assertExpired(result);
    assert.deepEqual(replayTokens, []);
    assert.equal(browser.storage.has(SESSION_KEY), false);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('a workspace replacement while waiting on the Web Lock is preserved without refresh', async () => {
  const browser = installBrowser();
  const locks = installRefreshLockQueue();
  const owner = makeWorkspaceSession('expired-access', 'owner-refresh', 'owner', 'membership-a', 'tenant-a');
  const replacement = makeWorkspaceSession(
    'replacement-access',
    'replacement-refresh',
    'replacement',
    'membership-b',
    'tenant-b',
  );
  await setSession(owner);
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return Response.json({ ...owner, accessToken: 'unexpected-refresh' });
    }
    if (authorization(init) === 'Bearer expired-access') return new Response(null, { status: 401 });
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const pending = Promise.allSettled([api.get('/protected')]);
    await locks.requested;
    await setSession(replacement);
    setActiveCompanyToken('replacement-company-token');
    assert.equal(locks.releaseNext(), true);
    const [result] = await pending;

    assertExpired(result);
    assert.equal(refreshCalls, 0);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getSession()?.accessToken, 'replacement-access');
    assert.equal(getActiveCompanyToken(), 'replacement-company-token');
  } finally {
    locks.releaseNext();
    setActiveCompanyToken(null);
    restoreFetch();
    locks.restore();
    browser.restore();
  }
});

test('a rejected Web Lock preserves a replacement session and its active-company token', async () => {
  const browser = installBrowser();
  const locks = installRefreshLockQueue();
  const owner = makeWorkspaceSession('expired-access', 'owner-refresh', 'owner', 'membership-a', 'tenant-a');
  const replacement = makeWorkspaceSession(
    'replacement-access',
    'replacement-refresh',
    'replacement',
    'membership-b',
    'tenant-b',
  );
  await setSession(owner);
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh')) throw new Error('refresh must not run');
    if (authorization(init) === 'Bearer expired-access') return new Response(null, { status: 401 });
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const pending = Promise.allSettled([api.get('/protected')]);
    await locks.requested;
    await setSession(replacement);
    setActiveCompanyToken('replacement-company-token');
    assert.equal(locks.rejectNext(new Error('lock manager unavailable')), true);
    const [result] = await pending;

    assertExpired(result);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getSession()?.accessToken, 'replacement-access');
    assert.equal(getActiveCompanyToken(), 'replacement-company-token');
  } finally {
    locks.rejectNext(new Error('test cleanup'));
    setActiveCompanyToken(null);
    restoreFetch();
    locks.restore();
    browser.restore();
  }
});

test('a mismatched refresh response preserves an independently installed replacement session', async () => {
  const browser = installBrowser();
  const owner = makeWorkspaceSession('expired-access', 'owner-refresh', 'owner', 'membership-a', 'tenant-a');
  const mismatched = makeWorkspaceSession('wrong-access', 'wrong-refresh', 'other', 'membership-c', 'tenant-c');
  const replacement = makeWorkspaceSession(
    'replacement-access',
    'replacement-refresh',
    'replacement',
    'membership-b',
    'tenant-b',
  );
  await setSession(owner);
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh')) {
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json(mismatched);
    }
    if (authorization(init) === 'Bearer expired-access') return new Response(null, { status: 401 });
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const pending = Promise.allSettled([api.get('/protected')]);
    await refreshStarted.promise;
    await setSession(replacement);
    setActiveCompanyToken('replacement-company-token');
    releaseRefresh.resolve();
    const [result] = await pending;

    assertExpired(result);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getSession()?.accessToken, 'replacement-access');
    assert.equal(getActiveCompanyToken(), 'replacement-company-token');
  } finally {
    releaseRefresh.resolve();
    setActiveCompanyToken(null);
    restoreFetch();
    browser.restore();
  }
});

test('all production session mutation helpers use the shared mutation lock', async () => {
  const browser = installBrowser();
  const locks = installCoordinatedLockManager();
  const owner = makeWorkspaceSession('owner-access', 'owner-refresh', 'owner', 'membership-a', 'tenant-a');
  const impersonated = makeWorkspaceSession('imp-access', 'imp-refresh', 'member', 'membership-b', 'tenant-b');

  try {
    await setSession(owner);
    await applyTenantSwitch('switched-access', 'membership-a');
    await updateSession((session) => ({
      ...session,
      user: { ...session.user, fullName: 'Updated Owner' },
    }));
    await startImpersonation(impersonated);
    await stopImpersonation();
    await clearSession();

    const mutationRequests = locks.requests.filter((request) => request.name === 'refearn.auth.session-mutation');
    assert.equal(mutationRequests.length, 6);
    assert.ok(mutationRequests.every((request) => request.mode === 'exclusive'));
  } finally {
    locks.restore();
    browser.restore();
  }
});

test('a refreshless impersonation session remains readable and restores the admin session', async () => {
  const browser = installBrowser();
  const locks = installCoordinatedLockManager();
  const admin = makeWorkspaceSession('admin-access', 'admin-refresh', 'admin', 'membership-a', 'tenant-a');
  const impersonated = makeWorkspaceSession('imp-access', '', 'member', 'membership-b', 'tenant-b');

  try {
    await setSession(admin);
    await startImpersonation(impersonated);
    assert.equal(getSession()?.accessToken, 'imp-access');

    const restored = await stopImpersonation();
    assert.equal(restored?.accessToken, 'admin-access');
    assert.equal(getSession()?.accessToken, 'admin-access');
  } finally {
    locks.restore();
    browser.restore();
  }
});

test('a coordinated replacement between refresh ownership check and success commit wins without stale replay', async () => {
  const browser = installBrowser();
  const locks = installCoordinatedLockManager();
  const owner = makeWorkspaceSession('owner-expired', 'owner-refresh', 'owner', 'membership-a', 'tenant-a');
  const ownerFresh = { ...owner, accessToken: 'owner-fresh', refreshToken: 'owner-next' };
  const replacement = makeWorkspaceSession(
    'replacement-access',
    'replacement-refresh',
    'replacement',
    'membership-b',
    'tenant-b',
  );
  browser.storage.set(SESSION_KEY, JSON.stringify(owner));
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const replayTokens: Array<string | null> = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) {
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json(ownerFresh);
    }
    if (path.endsWith('/protected') && bearer === 'Bearer owner-expired') {
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/protected')) {
      replayTokens.push(bearer);
      return Response.json({ unexpectedReplay: true });
    }
    throw new Error(`unexpected request: ${path}`);
  });
  const mutationGate = locks.holdNext('refearn.auth.session-mutation');

  try {
    const pending = Promise.allSettled([api.get('/protected')]);
    await refreshStarted.promise;
    const replacementWrite = Promise.resolve(setSession(replacement));
    await Promise.resolve();
    const replacementWasCoordinated = locks.requestCount('refearn.auth.session-mutation') === 1;

    releaseRefresh.resolve();
    if (replacementWasCoordinated) {
      await mutationGate.requested;
      await locks.waitForRequestCount('refearn.auth.session-mutation', 2);
    }
    mutationGate.release();
    await replacementWrite;
    const [result] = await pending;

    assert.equal(replacementWasCoordinated, true);
    assertExpired(result);
    assert.deepEqual(replayTokens, []);
    assert.equal(getSession()?.accessToken, 'replacement-access');
  } finally {
    releaseRefresh.resolve();
    mutationGate.release();
    restoreFetch();
    locks.restore();
    browser.restore();
  }
});

test('a coordinated replacement between refresh ownership check and failure cleanup is never removed', async () => {
  const browser = installBrowser();
  const locks = installCoordinatedLockManager();
  const owner = makeWorkspaceSession('owner-expired', 'owner-refresh', 'owner', 'membership-a', 'tenant-a');
  const replacement = makeWorkspaceSession(
    'replacement-access',
    'replacement-refresh',
    'replacement',
    'membership-b',
    'tenant-b',
  );
  browser.storage.set(SESSION_KEY, JSON.stringify(owner));
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh')) {
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json({ message: 'refresh unavailable' }, { status: 503 });
    }
    if (authorization(init) === 'Bearer owner-expired') return new Response(null, { status: 401 });
    throw new Error(`unexpected request: ${path}`);
  });
  const mutationGate = locks.holdNext('refearn.auth.session-mutation');

  try {
    const pending = Promise.allSettled([api.get('/protected')]);
    await refreshStarted.promise;
    const replacementWrite = Promise.resolve(setSession(replacement));
    await Promise.resolve();
    const replacementWasCoordinated = locks.requestCount('refearn.auth.session-mutation') === 1;

    releaseRefresh.resolve();
    if (replacementWasCoordinated) {
      await mutationGate.requested;
      await locks.waitForRequestCount('refearn.auth.session-mutation', 2);
    }
    mutationGate.release();
    await replacementWrite;
    const [result] = await pending;

    assert.equal(replacementWasCoordinated, true);
    assertExpired(result);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getSession()?.accessToken, 'replacement-access');
  } finally {
    releaseRefresh.resolve();
    mutationGate.release();
    restoreFetch();
    locks.restore();
    browser.restore();
  }
});

test('refresh mutation-lock rejection preserves storage bytes and clears active-company memory', async () => {
  const browser = installBrowser();
  const owner = makeWorkspaceSession('owner-expired', 'owner-refresh', 'owner', 'membership-a', 'tenant-a');
  const ownerFresh = { ...owner, accessToken: 'owner-fresh', refreshToken: 'owner-next' };
  const lockError = new Error('session mutation lock unavailable');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const ownerRaw = JSON.stringify(owner);
  browser.storage.set(SESSION_KEY, ownerRaw);
  setActiveCompanyToken('active-company-token');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request<T>(
          name: string,
          _options: { mode?: string },
          callback: () => T | PromiseLike<T>,
        ): Promise<T> {
          if (name === 'refearn.auth.session-mutation') return Promise.reject(lockError);
          return Promise.resolve(callback());
        },
      },
    },
  });
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh')) return Response.json(ownerFresh);
    if (authorization(init) === 'Bearer owner-expired') return new Response(null, { status: 401 });
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const [result] = await Promise.allSettled([api.get('/protected')]);

    assertExpired(result);
    assert.equal(browser.storage.get(SESSION_KEY), ownerRaw);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getActiveCompanyToken(), null);
  } finally {
    setActiveCompanyToken(null);
    restoreFetch();
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
    browser.restore();
  }
});
