import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  api,
  apiForSession,
  ApiError,
  getActiveCompanyToken,
  getCsv,
  postBlob,
  setActiveCompanyToken,
  switchTenant,
} from './api';
import {
  applyTenantSwitch,
  clearSession,
  getSession,
  isImpersonating,
  replaceSessionIfCurrent,
  setSession,
  startImpersonation,
  stopImpersonation,
  subscribeToSessionStorageChanges,
  updateSession,
  withSessionMutation,
  type Session,
} from './auth';

const SESSION_KEY = 'refearn.session';
const IMPERSONATOR_KEY = 'refearn.session.impersonator';

function makeAccessToken(claims: Record<string, unknown>): string {
  return `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
}

function makeFamilyAccessToken(
  sid: string,
  version: string,
  userId = 'user-1',
  membershipId = 'membership-a',
  tenantId = 'tenant-a',
): string {
  return makeAccessToken({
    sub: userId,
    mid: membershipId,
    tid: tenantId,
    role: 'member',
    sid,
    version,
  });
}

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

function makeProductionImpersonationSession(adminUserId: string): Session {
  return {
    accessToken: makeAccessToken({
      sub: 'member-user',
      mid: 'member-membership',
      tid: 'tenant-a',
      role: 'member',
      imp: adminUserId,
    }),
    refreshToken: '',
    user: {
      id: 'member-user',
      email: 'member@example.test',
      fullName: 'Member Example',
      locale: 'en',
      emailVerified: true,
    },
    activeMembershipId: 'member-membership',
    memberships: [
      {
        id: 'member-membership',
        tenantId: 'tenant-a',
        tenantSlug: '',
        tenantName: 'Tenant A',
        role: 'member',
        referralCode: 'MEMBER-REF',
        depth: 0,
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
  setItem?: unknown | ((key: string, value: string, call: number) => unknown);
  removeItem?: unknown | ((key: string, call: number) => unknown);
}

function installBrowser(failures: StorageFailures = {}): {
  storage: Map<string, string>;
  setCalls: () => number;
  removeCalls: () => number;
  location: { pathname: string; href: string };
  dispatchStorage: (key: string | null, oldValue: string | null, newValue: string | null) => void;
  restore: () => void;
} {
  const storage = new Map<string, string>();
  const location = { pathname: '/app', href: '/app' };
  const eventListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
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
      if (typeof failures.setItem === 'function') {
        const error = failures.setItem(key, value, writes);
        if (error !== undefined) throw error;
      } else if (Object.hasOwn(failures, 'setItem')) {
        throw failures.setItem;
      }
      storage.set(key, value);
    },
    removeItem(key: string): void {
      removals += 1;
      if (typeof failures.removeItem === 'function') {
        const error = failures.removeItem(key, removals);
        if (error !== undefined) throw error;
      } else if (Object.hasOwn(failures, 'removeItem')) {
        throw failures.removeItem;
      }
      storage.delete(key);
    },
  };
  const addEventListener = (type: string, listener: EventListenerOrEventListenerObject) => {
    const listeners = eventListeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.add(listener);
    eventListeners.set(type, listeners);
  };
  const removeEventListener = (type: string, listener: EventListenerOrEventListenerObject) => {
    eventListeners.get(type)?.delete(listener);
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage, location, addEventListener, removeEventListener },
  });

  return {
    storage,
    setCalls: () => writes,
    removeCalls: () => removals,
    location,
    dispatchStorage: (key, oldValue, newValue) => {
      const event = { type: 'storage', key, oldValue, newValue } as StorageEvent;
      for (const listener of eventListeners.get('storage') ?? []) {
        if (typeof listener === 'function') listener(event);
        else listener.handleEvent(event);
      }
    },
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

function installRejectedMutationLock(error: unknown): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request<T>(
          name: string,
          _options: { mode?: string },
          callback: () => T | PromiseLike<T>,
        ): Promise<T> {
          if (name === 'refearn.auth.session-mutation') return Promise.reject(error);
          return Promise.resolve(callback());
        },
      },
    },
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else Reflect.deleteProperty(globalThis, 'navigator');
  };
}

if (false) {
  // @ts-expect-error session mutation callbacks must be synchronous
  void withSessionMutation(async () => undefined);
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
    assert.equal(browser.location.href, '/app');
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
      Promise.resolve().then(() =>
        startImpersonation(
          makeWorkspaceSession('admin-access', 'admin-refresh', 'admin-user', 'admin-membership', 'tenant-a'),
          makeProductionImpersonationSession('admin-user'),
        ),
      ),
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
      Promise.resolve().then(() =>
        applyTenantSwitch(makeSession('captured-access', 'captured-refresh'), 'switched-access', 'membership-b'),
      ),
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
        .then(() => updateSession(makeSession('captured-access', 'captured-refresh'), (session) => ({
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
  const impersonated = makeProductionImpersonationSession(owner.user.id);

  try {
    await setSession(owner);
    const replaced = await replaceSessionIfCurrent(owner, {
      ...owner,
      user: { ...owner.user, locale: 'en' },
    });
    const switched = await applyTenantSwitch(replaced, 'switched-access', 'membership-a');
    await updateSession(switched, (session) => ({
      ...session,
      user: { ...session.user, fullName: 'Updated Owner' },
    }));
    const expectedAdmin = getSession();
    assert.ok(expectedAdmin);
    await startImpersonation(expectedAdmin, impersonated);
    await stopImpersonation();
    await clearSession();

    const mutationRequests = locks.requests.filter((request) => request.name === 'refearn.auth.session-mutation');
    assert.equal(mutationRequests.length, 7);
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
  const impersonated = makeProductionImpersonationSession(admin.user.id);

  try {
    await setSession(admin);
    await startImpersonation(admin, impersonated);
    assert.equal(getSession()?.accessToken, impersonated.accessToken);

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

test('the exact production impersonation fixture remains readable with empty tenantSlug and refreshToken', () => {
  const browser = installBrowser();
  const fixture = makeProductionImpersonationSession('admin-user');
  browser.storage.set(SESSION_KEY, JSON.stringify(fixture));

  try {
    assert.deepEqual(getSession(), fixture);
  } finally {
    browser.restore();
  }
});

test('startImpersonation binds the backup and impersonation token to the exact captured admin', async () => {
  const browser = installBrowser();
  const admin = makeWorkspaceSession('admin-access', 'admin-refresh', 'admin-user', 'admin-membership', 'tenant-a');
  const impersonated = makeProductionImpersonationSession(admin.user.id);

  try {
    await setSession(admin);
    await startImpersonation(admin, impersonated);

    assert.deepEqual(getSession(), impersonated);
    assert.equal(browser.storage.get(IMPERSONATOR_KEY), JSON.stringify(admin));
    assert.equal(isImpersonating(), true);
  } finally {
    browser.restore();
  }
});

test('startImpersonation rejects a token whose imp claim does not identify the captured admin', async () => {
  const browser = installBrowser();
  const admin = makeWorkspaceSession('admin-access', 'admin-refresh', 'admin-user', 'admin-membership', 'tenant-a');
  const mismatched = makeProductionImpersonationSession('different-admin');
  browser.storage.set(SESSION_KEY, JSON.stringify(admin));

  try {
    await assert.rejects(startImpersonation(admin, mismatched), /impersonation owner mismatch/);
    assert.equal(browser.storage.get(SESSION_KEY), JSON.stringify(admin));
    assert.equal(browser.storage.has(IMPERSONATOR_KEY), false);
  } finally {
    browser.restore();
  }
});

test('startImpersonation rejects a stale network result when the captured admin snapshot was replaced', async () => {
  const browser = installBrowser();
  const admin = makeWorkspaceSession('admin-access', 'admin-refresh', 'admin-user', 'admin-membership', 'tenant-a');
  const replacement = { ...admin, user: { ...admin.user, fullName: 'Newer Admin Profile' } };
  const impersonated = makeProductionImpersonationSession(admin.user.id);
  browser.storage.set(SESSION_KEY, JSON.stringify(replacement));

  try {
    await assert.rejects(startImpersonation(admin, impersonated), /session owner changed/);
    assert.equal(browser.storage.get(SESSION_KEY), JSON.stringify(replacement));
    assert.equal(browser.storage.has(IMPERSONATOR_KEY), false);
  } finally {
    browser.restore();
  }
});

test('startImpersonation restores the prior backup when the main session write fails', async () => {
  const writeError = new Error('main session write failed');
  const browser = installBrowser({
    setItem: (key: string, _value: string, call: number) =>
      key === SESSION_KEY && call === 2 ? writeError : undefined,
  });
  const admin = makeWorkspaceSession('admin-access', 'admin-refresh', 'admin-user', 'admin-membership', 'tenant-a');
  const priorBackup = makeWorkspaceSession('prior-access', 'prior-refresh', 'prior-admin', 'prior-membership', 'tenant-z');
  const impersonated = makeProductionImpersonationSession(admin.user.id);
  browser.storage.set(SESSION_KEY, JSON.stringify(admin));
  browser.storage.set(IMPERSONATOR_KEY, JSON.stringify(priorBackup));

  try {
    await assert.rejects(startImpersonation(admin, impersonated), writeError);
    assert.equal(browser.storage.get(SESSION_KEY), JSON.stringify(admin));
    assert.equal(browser.storage.get(IMPERSONATOR_KEY), JSON.stringify(priorBackup));
  } finally {
    browser.restore();
  }
});

test('logout then normal login then exit can never restore the old impersonator backup', async () => {
  const browser = installBrowser();
  const admin = makeWorkspaceSession('admin-access', 'admin-refresh', 'admin-user', 'admin-membership', 'tenant-a');
  const impersonated = makeProductionImpersonationSession(admin.user.id);
  const newLogin = makeWorkspaceSession('new-access', 'new-refresh', 'new-user', 'new-membership', 'tenant-b');

  try {
    await setSession(admin);
    await startImpersonation(admin, impersonated);
    await clearSession();
    await setSession(newLogin);

    assert.equal(browser.storage.has(IMPERSONATOR_KEY), false);
    assert.equal(isImpersonating(), false);
    assert.equal(await stopImpersonation(), null);
    assert.deepEqual(getSession(), newLogin);
  } finally {
    browser.restore();
  }
});

test('isImpersonating ignores a stale backup beside an unrelated normal session', () => {
  const browser = installBrowser();
  const staleAdmin = makeWorkspaceSession('admin-access', 'admin-refresh', 'admin-user', 'admin-membership', 'tenant-a');
  const normal = makeWorkspaceSession('normal-access', 'normal-refresh', 'normal-user', 'normal-membership', 'tenant-b');
  browser.storage.set(SESSION_KEY, JSON.stringify(normal));
  browser.storage.set(IMPERSONATOR_KEY, JSON.stringify(staleAdmin));

  try {
    assert.equal(isImpersonating(), false);
  } finally {
    browser.restore();
  }
});

test('stopImpersonation never restores a backup whose admin does not match the current imp claim', async () => {
  const browser = installBrowser();
  const staleAdmin = makeWorkspaceSession('admin-access', 'admin-refresh', 'admin-user', 'admin-membership', 'tenant-a');
  const unrelatedImpersonation = makeProductionImpersonationSession('different-admin');
  browser.storage.set(SESSION_KEY, JSON.stringify(unrelatedImpersonation));
  browser.storage.set(IMPERSONATOR_KEY, JSON.stringify(staleAdmin));

  try {
    assert.equal(await stopImpersonation(), null);
    assert.equal(getSession(), null);
    assert.equal(browser.storage.has(IMPERSONATOR_KEY), false);
  } finally {
    browser.restore();
  }
});

test('stopImpersonation clears an impersonation session whose privileged backup is missing', async () => {
  const browser = installBrowser();
  const impersonated = makeProductionImpersonationSession('admin-user');
  browser.storage.set(SESSION_KEY, JSON.stringify(impersonated));

  try {
    assert.equal(await stopImpersonation(), null);
    assert.equal(getSession(), null);
    assert.equal(browser.storage.has(IMPERSONATOR_KEY), false);
  } finally {
    browser.restore();
  }
});

test('applyTenantSwitch rejects a response when the exact captured session was replaced', async () => {
  const browser = installBrowser();
  const expected = makeWorkspaceSession('old-access', 'refresh', 'user-1', 'membership-a', 'tenant-a');
  const replacement = { ...expected, user: { ...expected.user, fullName: 'Newer Profile' } };
  browser.storage.set(SESSION_KEY, JSON.stringify(replacement));

  try {
    await assert.rejects(
      applyTenantSwitch(expected, 'switched-access', 'membership-a'),
      /session owner changed/,
    );
    assert.deepEqual(getSession(), replacement);
  } finally {
    browser.restore();
  }
});

test('updateSession rejects instead of reporting success when the captured session is missing', async () => {
  const browser = installBrowser();
  const expected = makeSession('old-access', 'old-refresh');

  try {
    await assert.rejects(
      updateSession(expected, (session) => ({ ...session, user: { ...session.user, fullName: 'Updated' } })),
      /session owner changed/,
    );
    assert.equal(browser.setCalls(), 0);
  } finally {
    browser.restore();
  }
});

test('updateSession never applies a stale profile result to a same-user replacement', async () => {
  const browser = installBrowser();
  const expected = makeWorkspaceSession('access', 'refresh', 'user-1', 'membership-a', 'tenant-a');
  const replacement = { ...expected, user: { ...expected.user, locale: 'fr' } };
  browser.storage.set(SESSION_KEY, JSON.stringify(replacement));

  try {
    await assert.rejects(
      updateSession(expected, (session) => ({ ...session, user: { ...session.user, fullName: 'Stale Name' } })),
      /session owner changed/,
    );
    assert.deepEqual(getSession(), replacement);
  } finally {
    browser.restore();
  }
});

test('setSession lock rejection preserves storage and clears active-company memory', async () => {
  const browser = installBrowser();
  const owner = makeSession('owner-access', 'owner-refresh');
  const ownerRaw = JSON.stringify(owner);
  browser.storage.set(SESSION_KEY, ownerRaw);
  browser.storage.set(IMPERSONATOR_KEY, JSON.stringify(makeSession('backup-access', 'backup-refresh')));
  setActiveCompanyToken('active-company-token');
  const lockError = new Error('mutation lock rejected');
  const restoreLock = installRejectedMutationLock(lockError);

  try {
    await assert.rejects(setSession(makeSession('next-access', 'next-refresh')), (error: unknown) => error === lockError);
    assert.equal(browser.storage.get(SESSION_KEY), ownerRaw);
    assert.equal(browser.setCalls(), 0);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getActiveCompanyToken(), null);
  } finally {
    setActiveCompanyToken(null);
    restoreLock();
    browser.restore();
  }
});

test('updateSession lock rejection preserves storage and clears active-company memory', async () => {
  const browser = installBrowser();
  const owner = makeSession('owner-access', 'owner-refresh');
  const ownerRaw = JSON.stringify(owner);
  browser.storage.set(SESSION_KEY, ownerRaw);
  setActiveCompanyToken('active-company-token');
  const lockError = new Error('mutation lock rejected');
  const restoreLock = installRejectedMutationLock(lockError);

  try {
    await assert.rejects(updateSession(owner, (session) => session), (error: unknown) => error === lockError);
    assert.equal(browser.storage.get(SESSION_KEY), ownerRaw);
    assert.equal(browser.setCalls(), 0);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getActiveCompanyToken(), null);
  } finally {
    setActiveCompanyToken(null);
    restoreLock();
    browser.restore();
  }
});

test('startImpersonation lock rejection preserves storage and clears active-company memory', async () => {
  const browser = installBrowser();
  const owner = makeWorkspaceSession('owner-access', 'owner-refresh', 'admin-user', 'membership-a', 'tenant-a');
  const ownerRaw = JSON.stringify(owner);
  browser.storage.set(SESSION_KEY, ownerRaw);
  setActiveCompanyToken('active-company-token');
  const lockError = new Error('mutation lock rejected');
  const restoreLock = installRejectedMutationLock(lockError);

  try {
    await assert.rejects(
      startImpersonation(owner, makeProductionImpersonationSession(owner.user.id)),
      (error: unknown) => error === lockError,
    );
    assert.equal(browser.storage.get(SESSION_KEY), ownerRaw);
    assert.equal(browser.storage.has(IMPERSONATOR_KEY), false);
    assert.equal(browser.setCalls(), 0);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getActiveCompanyToken(), null);
  } finally {
    setActiveCompanyToken(null);
    restoreLock();
    browser.restore();
  }
});

test('stopImpersonation lock rejection preserves storage and clears active-company memory', async () => {
  const browser = installBrowser();
  const admin = makeWorkspaceSession('admin-access', 'admin-refresh', 'admin-user', 'membership-a', 'tenant-a');
  const impersonated = makeProductionImpersonationSession(admin.user.id);
  const impRaw = JSON.stringify(impersonated);
  const adminRaw = JSON.stringify(admin);
  browser.storage.set(SESSION_KEY, impRaw);
  browser.storage.set(IMPERSONATOR_KEY, adminRaw);
  setActiveCompanyToken('active-company-token');
  const lockError = new Error('mutation lock rejected');
  const restoreLock = installRejectedMutationLock(lockError);

  try {
    await assert.rejects(stopImpersonation(), (error: unknown) => error === lockError);
    assert.equal(browser.storage.get(SESSION_KEY), impRaw);
    assert.equal(browser.storage.get(IMPERSONATOR_KEY), adminRaw);
    assert.equal(browser.setCalls(), 0);
    assert.equal(browser.removeCalls(), 0);
    assert.equal(getActiveCompanyToken(), null);
  } finally {
    setActiveCompanyToken(null);
    restoreLock();
    browser.restore();
  }
});

test('withSessionMutation rejects a thenable callback without assimilating it', async () => {
  const browser = installBrowser();
  let thenCalls = 0;
  const thenable = {
    then(resolve: (value: string) => void): void {
      thenCalls += 1;
      resolve('async-result');
    },
  };
  const asyncBoundaryEscape = (() => thenable) as unknown as () => string;

  try {
    await assert.rejects(withSessionMutation(asyncBoundaryEscape), /must be synchronous/);
    assert.equal(thenCalls, 0);
  } finally {
    browser.restore();
  }
});

test('setSession leaves the previous impersonator backup untouched when the main write fails', async () => {
  const writeError = new Error('main write denied');
  const browser = installBrowser({ setItem: writeError });
  const owner = makeSession('owner-access', 'owner-refresh');
  const backup = makeSession('backup-access', 'backup-refresh');
  const ownerRaw = JSON.stringify(owner);
  const backupRaw = JSON.stringify(backup);
  browser.storage.set(SESSION_KEY, ownerRaw);
  browser.storage.set(IMPERSONATOR_KEY, backupRaw);

  try {
    await assert.rejects(setSession(makeSession('new-access', 'new-refresh')), (error: unknown) => error === writeError);
    assert.equal(browser.storage.get(SESSION_KEY), ownerRaw);
    assert.equal(browser.storage.get(IMPERSONATOR_KEY), backupRaw);
  } finally {
    browser.restore();
  }
});

test('clearSession attempts main removal before stale backup cleanup and attempts both on failure', async () => {
  const removalOrder: string[] = [];
  const mainRemovalError = new Error('main removal denied');
  const browser = installBrowser({
    removeItem: (key: string) => {
      removalOrder.push(key);
      return key === SESSION_KEY ? mainRemovalError : undefined;
    },
  });
  const ownerRaw = JSON.stringify(makeSession('owner-access', 'owner-refresh'));
  browser.storage.set(SESSION_KEY, ownerRaw);
  browser.storage.set(IMPERSONATOR_KEY, JSON.stringify(makeSession('backup-access', 'backup-refresh')));

  try {
    await assert.rejects(clearSession());
    assert.deepEqual(removalOrder, [SESSION_KEY, IMPERSONATOR_KEY]);
    assert.equal(browser.storage.get(SESSION_KEY), ownerRaw);
    assert.equal(browser.storage.has(IMPERSONATOR_KEY), false);
  } finally {
    browser.restore();
  }
});

test('a deferred login or invite result cannot replace a session installed after its null snapshot', async () => {
  const browser = installBrowser();
  const incoming = makeSession('incoming-access', 'incoming-refresh');
  const replacement = makeWorkspaceSession('replacement-access', 'replacement-refresh', 'replacement-user', 'membership-b', 'tenant-b');
  browser.storage.set(SESSION_KEY, JSON.stringify(replacement));

  try {
    await assert.rejects(
      Promise.resolve().then(() => replaceSessionIfCurrent(null, incoming)),
      /session owner changed/,
    );
    assert.deepEqual(getSession(), replacement);
  } finally {
    browser.restore();
  }
});

test('branded-login tenant switching authenticates with the newly returned login token', async () => {
  const browser = installBrowser();
  const oldStored = makeSession('old-stored-access', 'old-stored-refresh');
  browser.storage.set(SESSION_KEY, JSON.stringify(oldStored));
  const authorizations: Array<string | null> = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (!path.endsWith('/me/switch-tenant')) throw new Error(`unexpected request: ${path}`);
    authorizations.push(authorization(init));
    return Response.json({ accessToken: 'tenant-access', activeMembershipId: 'target-membership' });
  });

  try {
    const switched = await switchTenant('target-membership', 'new-login-access');

    assert.deepEqual(switched, { accessToken: 'tenant-access', activeMembershipId: 'target-membership' });
    assert.deepEqual(authorizations, ['Bearer new-login-access']);
    assert.deepEqual(getSession(), oldStored);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('branded-login tenant switching never falls back to stored auth for an explicit empty token', async () => {
  const browser = installBrowser();
  const oldStored = makeSession('old-stored-access', 'old-stored-refresh');
  browser.storage.set(SESSION_KEY, JSON.stringify(oldStored));
  let fetchCalls = 0;
  const restoreFetch = installFetch(async () => {
    fetchCalls += 1;
    return Response.json({ accessToken: 'unsafe', activeMembershipId: 'unsafe' });
  });

  try {
    await assert.rejects(switchTenant('target-membership', ''), /invalid access token/);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(getSession(), oldStored);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('owner-bound API calls use the captured session bearer even after storage is replaced', async () => {
  const browser = installBrowser();
  const expected = makeWorkspaceSession('captured-access', 'captured-refresh', 'user-a', 'membership-a', 'tenant-a');
  const replacement = makeWorkspaceSession('replacement-access', 'replacement-refresh', 'user-b', 'membership-b', 'tenant-b');
  browser.storage.set(SESSION_KEY, JSON.stringify(replacement));
  const authorizations: Array<string | null> = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (!path.endsWith('/owner-bound-update')) throw new Error(`unexpected request: ${path}`);
    authorizations.push(authorization(init));
    return Response.json({ ok: true });
  });

  try {
    const result = await apiForSession(expected).patch<{ ok: boolean }>('/owner-bound-update', { value: 'A' });

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(authorizations, ['Bearer captured-access']);
    assert.deepEqual(getSession(), replacement);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('refresh applies server metadata while preserving a concurrent same-owner profile field update', async () => {
  const browser = installBrowser();
  const owner = makeWorkspaceSession('expired-access', 'owner-refresh', 'user-1', 'membership-a', 'tenant-a');
  const refreshed: Session = {
    ...owner,
    accessToken: 'fresh-access',
    refreshToken: 'next-refresh',
    user: {
      ...owner.user,
      email: 'server-updated@example.test',
      fullName: 'Server Profile Name',
      locale: 'en',
      emailVerified: false,
      isPlatformAdmin: true,
    },
    memberships: [{
      ...owner.memberships[0],
      tenantSlug: 'server-tenant-slug',
      tenantName: 'Server Tenant Name',
      role: 'tenant_admin',
      referralCode: 'SERVER-REFERRAL',
      depth: 4,
    }],
  };
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
      return Response.json(refreshed);
    }
    if (path.endsWith('/profile-resource') && bearer === 'Bearer expired-access') {
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/profile-resource')) {
      replayAuthorizations.push(bearer);
      return Response.json({ ok: true });
    }
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const pending = api.get<{ ok: boolean }>('/profile-resource');
    await refreshStarted.promise;
    await updateSession(owner, (session) => ({
      ...session,
      user: { ...session.user, fullName: 'Profile Updated During Refresh' },
    }));
    releaseRefresh.resolve();

    assert.deepEqual(await pending, { ok: true });
    assert.deepEqual(replayAuthorizations, ['Bearer fresh-access']);
    assert.equal(getSession()?.accessToken, 'fresh-access');
    assert.equal(getSession()?.refreshToken, 'next-refresh');
    assert.equal(getSession()?.user.fullName, 'Profile Updated During Refresh');
    assert.equal(getSession()?.user.email, 'server-updated@example.test');
    assert.equal(getSession()?.user.locale, 'en');
    assert.equal(getSession()?.user.emailVerified, false);
    assert.equal(getSession()?.user.isPlatformAdmin, true);
    assert.deepEqual(getSession()?.memberships, refreshed.memberships);
  } finally {
    releaseRefresh.resolve();
    restoreFetch();
    browser.restore();
  }
});

test('a refresh response with an empty refreshToken is cleared and never replayed', async () => {
  const browser = installBrowser();
  const owner = makeWorkspaceSession('expired-access', 'owner-refresh', 'user-1', 'membership-a', 'tenant-a');
  const invalidRotation = { ...owner, accessToken: 'unsafe-fresh-access', refreshToken: '' };
  await setSession(owner);
  const replayAuthorizations: Array<string | null> = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) return Response.json(invalidRotation);
    if (path.endsWith('/empty-rotation') && bearer === 'Bearer expired-access') {
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/empty-rotation')) {
      replayAuthorizations.push(bearer);
      return Response.json({ unsafeReplay: true });
    }
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const [result] = await Promise.allSettled([api.get('/empty-rotation')]);

    assertExpired(result);
    assert.deepEqual(replayAuthorizations, []);
    assert.equal(getSession(), null);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('a local refreshless impersonation 401 never sends an empty refresh credential', async () => {
  const browser = installBrowser();
  const impersonated = makeProductionImpersonationSession('admin-user');
  const admin = makeWorkspaceSession('admin-access', 'admin-refresh', 'admin-user', 'membership-a', 'tenant-a');
  browser.storage.set(SESSION_KEY, JSON.stringify(impersonated));
  browser.storage.set(IMPERSONATOR_KEY, JSON.stringify(admin));
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return Response.json({ message: 'must not be called' }, { status: 500 });
    }
    if (path.endsWith('/impersonated-resource') && authorization(init) === `Bearer ${impersonated.accessToken}`) {
      return new Response(null, { status: 401 });
    }
    throw new Error(`unexpected request: ${path}`);
  });

  try {
    const [result] = await Promise.allSettled([api.get('/impersonated-resource')]);

    assertExpired(result);
    assert.equal(refreshCalls, 0);
    assert.equal(getSession(), null);
    assert.equal(browser.storage.has(IMPERSONATOR_KEY), false);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('setSession rejects a malformed API session before any main or backup write', async () => {
  const browser = installBrowser();
  const current = makeSession('current-access', 'current-refresh');
  const backup = makeSession('backup-access', 'backup-refresh');
  const currentRaw = JSON.stringify(current);
  const backupRaw = JSON.stringify(backup);
  const malformed = { ...makeSession('unsafe-access', 'unsafe-refresh'), user: null } as unknown as Session;
  browser.storage.set(SESSION_KEY, currentRaw);
  browser.storage.set(IMPERSONATOR_KEY, backupRaw);

  try {
    await assert.rejects(setSession(malformed), /invalid session/);
    assert.equal(browser.storage.get(SESSION_KEY), currentRaw);
    assert.equal(browser.storage.get(IMPERSONATOR_KEY), backupRaw);
    assert.equal(browser.setCalls(), 0);
    assert.equal(browser.removeCalls(), 0);
  } finally {
    browser.restore();
  }
});

test('startImpersonation rejects a malformed owner-claimed payload before writing its backup', async () => {
  const browser = installBrowser();
  const admin = makeWorkspaceSession('admin-access', 'admin-refresh', 'admin-user', 'membership-a', 'tenant-a');
  const validFixture = makeProductionImpersonationSession(admin.user.id);
  const malformed: Session = {
    ...validFixture,
    memberships: [{ ...validFixture.memberships[0], tenantName: '' }],
  };
  const adminRaw = JSON.stringify(admin);
  browser.storage.set(SESSION_KEY, adminRaw);

  try {
    await assert.rejects(startImpersonation(admin, malformed), /invalid session/);
    assert.equal(browser.storage.get(SESSION_KEY), adminRaw);
    assert.equal(browser.storage.has(IMPERSONATOR_KEY), false);
    assert.equal(browser.setCalls(), 0);
    assert.equal(browser.removeCalls(), 0);
  } finally {
    browser.restore();
  }
});

test('owner-bound profile updates use the refreshed exact session snapshot for their CAS', async () => {
  const browser = installBrowser();
  const owner = makeWorkspaceSession('expired-profile-access', 'profile-refresh', 'user-1', 'membership-a', 'tenant-a');
  const refreshed: Session = {
    ...owner,
    accessToken: 'fresh-profile-access',
    refreshToken: 'next-profile-refresh',
    user: { ...owner.user, locale: 'en' },
  };
  await setSession(owner);
  const requestAuthorizations: Array<string | null> = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) return Response.json(refreshed);
    if (path.endsWith('/account/profile')) {
      requestAuthorizations.push(bearer);
      if (bearer === 'Bearer expired-profile-access') return new Response(null, { status: 401 });
      if (bearer === 'Bearer fresh-profile-access') {
        return Response.json({ fullName: 'Saved Profile', locale: 'fr' });
      }
    }
    throw new Error(`unexpected request: ${path} (${bearer})`);
  });

  try {
    const ownerApi = apiForSession(owner);
    const profile = await ownerApi.patch<{ fullName: string; locale: string }>('/account/profile', { fullName: 'Saved Profile' });
    const committed = await updateSession(ownerApi.session(), (session) => ({
      ...session,
      user: { ...session.user, fullName: profile.fullName, locale: profile.locale },
    }));

    assert.deepEqual(requestAuthorizations, ['Bearer expired-profile-access', 'Bearer fresh-profile-access']);
    assert.equal(committed.accessToken, 'fresh-profile-access');
    assert.equal(committed.refreshToken, 'next-profile-refresh');
    assert.equal(committed.user.fullName, 'Saved Profile');
    assert.equal(committed.user.locale, 'fr');
    assert.deepEqual(getSession(), committed);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('owner-bound impersonation uses the refreshed admin snapshot as its privileged backup', async () => {
  const browser = installBrowser();
  const admin = makeWorkspaceSession('expired-admin-access', 'admin-refresh', 'admin-user', 'membership-a', 'tenant-a');
  const refreshedAdmin: Session = {
    ...admin,
    accessToken: 'fresh-admin-access',
    refreshToken: 'next-admin-refresh',
    memberships: [{ ...admin.memberships[0], role: 'tenant_admin' }],
  };
  const impersonated = makeProductionImpersonationSession(admin.user.id);
  await setSession(admin);
  const requestAuthorizations: Array<string | null> = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) return Response.json(refreshedAdmin);
    if (path.endsWith('/admin/members/member-membership/impersonate')) {
      requestAuthorizations.push(bearer);
      if (bearer === 'Bearer expired-admin-access') return new Response(null, { status: 401 });
      if (bearer === 'Bearer fresh-admin-access') return Response.json({ ok: true });
    }
    throw new Error(`unexpected request: ${path} (${bearer})`);
  });

  try {
    const ownerApi = apiForSession(admin);
    await ownerApi.post('/admin/members/member-membership/impersonate');
    await startImpersonation(ownerApi.session(), impersonated);

    assert.deepEqual(requestAuthorizations, ['Bearer expired-admin-access', 'Bearer fresh-admin-access']);
    assert.deepEqual(JSON.parse(browser.storage.get(IMPERSONATOR_KEY) ?? 'null'), refreshedAdmin);
    assert.deepEqual(getSession(), impersonated);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('an owner-bound result never authorizes a same-workspace new login installed after the request', async () => {
  const browser = installBrowser();
  const ownerAccess = makeFamilyAccessToken('captured-family', 'expired');
  const newLoginAccess = makeFamilyAccessToken('new-login-family', 'fresh');
  const owner = makeWorkspaceSession(ownerAccess, 'captured-refresh', 'user-1', 'membership-a', 'tenant-a');
  const newLogin = { ...owner, accessToken: newLoginAccess, refreshToken: 'new-login-refresh' };
  await setSession(owner);
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    if (!path.endsWith('/owner-bound-profile')) throw new Error(`unexpected request: ${path}`);
    assert.equal(authorization(init), `Bearer ${ownerAccess}`);
    return Response.json({ fullName: 'Stale Network Result' });
  });

  try {
    const ownerApi = apiForSession(owner);
    await ownerApi.patch('/owner-bound-profile', { fullName: 'Stale Network Result' });
    await setSession(newLogin);

    await assert.rejects(
      Promise.resolve().then(() => updateSession(ownerApi.session(), (session) => ({
        ...session,
        user: { ...session.user, fullName: 'Stale Network Result' },
      }))),
      /session owner changed/,
    );
    assert.deepEqual(getSession(), newLogin);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('an owner-bound late 401 never adopts a same-workspace new login as a token rotation', async () => {
  const browser = installBrowser();
  const owner = makeWorkspaceSession('captured-expired', 'captured-refresh', 'user-1', 'membership-a', 'tenant-a');
  const newLogin = { ...owner, accessToken: 'new-login-access', refreshToken: 'new-login-refresh' };
  await setSession(owner);
  const requestStarted = deferred();
  const releaseUnauthorized = deferred();
  const requestAuthorizations: Array<string | null> = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (!path.endsWith('/bound-late-resource')) throw new Error(`unexpected request: ${path}`);
    requestAuthorizations.push(bearer);
    if (bearer === 'Bearer captured-expired') {
      requestStarted.resolve();
      await releaseUnauthorized.promise;
      return new Response(null, { status: 401 });
    }
    if (bearer === 'Bearer new-login-access') return Response.json({ unsafeReplay: true });
    throw new Error(`unexpected bearer: ${bearer}`);
  });

  try {
    const ownerApi = apiForSession(owner);
    const pending = Promise.allSettled([ownerApi.get('/bound-late-resource')]);
    await requestStarted.promise;
    await setSession(newLogin);
    releaseUnauthorized.resolve();
    const [result] = await pending;

    assertExpired(result);
    assert.deepEqual(requestAuthorizations, ['Bearer captured-expired']);
    assert.deepEqual(getSession(), newLogin);
    assert.equal(browser.location.href, '/app');
  } finally {
    releaseUnauthorized.resolve();
    restoreFetch();
    browser.restore();
  }
});

test('an owner-bound Web Lock waiter never adopts a same-workspace new login as a token rotation', async () => {
  const browser = installBrowser();
  const locks = installRefreshLockQueue();
  const owner = makeWorkspaceSession('captured-expired', 'captured-refresh', 'user-1', 'membership-a', 'tenant-a');
  const newLogin = { ...owner, accessToken: 'new-login-access', refreshToken: 'new-login-refresh' };
  await setSession(owner);
  const requestAuthorizations: Array<string | null> = [];
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return Response.json({ ...owner, accessToken: 'unexpected-refresh' });
    }
    if (!path.endsWith('/bound-web-lock-resource')) throw new Error(`unexpected request: ${path}`);
    requestAuthorizations.push(bearer);
    if (bearer === 'Bearer captured-expired') return new Response(null, { status: 401 });
    if (bearer === 'Bearer new-login-access') return Response.json({ unsafeReplay: true });
    throw new Error(`unexpected bearer: ${bearer}`);
  });

  try {
    const ownerApi = apiForSession(owner);
    const pending = Promise.allSettled([ownerApi.get('/bound-web-lock-resource')]);
    await locks.requested;
    await setSession(newLogin);
    assert.equal(locks.releaseNext(), true);
    const [result] = await pending;

    assertExpired(result);
    assert.deepEqual(requestAuthorizations, ['Bearer captured-expired']);
    assert.equal(refreshCalls, 0);
    assert.deepEqual(getSession(), newLogin);
    assert.equal(browser.location.href, '/app');
  } finally {
    locks.releaseNext();
    restoreFetch();
    locks.restore();
    browser.restore();
  }
});

test('a different exact owner waits for the active refresh flight before starting its own refresh', async () => {
  const browser = installBrowser();
  const ownerA = makeWorkspaceSession('owner-a-expired', 'owner-a-refresh', 'owner-a', 'membership-a', 'tenant-a');
  const ownerAFresh = { ...ownerA, accessToken: 'owner-a-fresh', refreshToken: 'owner-a-next' };
  const ownerB = makeWorkspaceSession('owner-b-expired', 'owner-b-refresh', 'owner-b', 'membership-b', 'tenant-b');
  const ownerBFresh = { ...ownerB, accessToken: 'owner-b-fresh', refreshToken: 'owner-b-next' };
  await setSession(ownerA);
  const ownerARefreshStarted = deferred();
  const releaseOwnerARefresh = deferred();
  const ownerBUnauthorized = deferred();
  const refreshBodies: string[] = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) {
      const body = JSON.parse(String(init?.body)) as { refreshToken: string };
      refreshBodies.push(body.refreshToken);
      if (body.refreshToken === ownerA.refreshToken) {
        ownerARefreshStarted.resolve();
        await releaseOwnerARefresh.promise;
        return Response.json(ownerAFresh);
      }
      if (body.refreshToken === ownerB.refreshToken) return Response.json(ownerBFresh);
    }
    if (path.endsWith('/owner-a') && bearer === 'Bearer owner-a-expired') return new Response(null, { status: 401 });
    if (path.endsWith('/owner-b') && bearer === 'Bearer owner-b-expired') {
      ownerBUnauthorized.resolve();
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/owner-b') && bearer === 'Bearer owner-b-fresh') return Response.json({ owner: 'b' });
    throw new Error(`unexpected request: ${path} (${bearer})`);
  });

  try {
    const pendingA = Promise.allSettled([api.get('/owner-a')]);
    await ownerARefreshStarted.promise;
    await setSession(ownerB);
    const pendingB = Promise.allSettled([api.get<{ owner: string }>('/owner-b')]);
    await ownerBUnauthorized.promise;
    releaseOwnerARefresh.resolve();
    const [[resultA], [resultB]] = await Promise.all([pendingA, pendingB]);

    assertExpired(resultA);
    assert.equal(resultB.status, 'fulfilled');
    if (resultB.status === 'fulfilled') assert.deepEqual(resultB.value, { owner: 'b' });
    assert.deepEqual(refreshBodies, ['owner-a-refresh', 'owner-b-refresh']);
    assert.equal(getSession()?.accessToken, 'owner-b-fresh');
    assert.equal(getSession()?.refreshToken, 'owner-b-next');
    assert.equal(browser.location.href, '/app');
  } finally {
    releaseOwnerARefresh.resolve();
    restoreFetch();
    browser.restore();
  }
});

test('session storage set and remove events clear active-company memory before shell resync', () => {
  const browser = installBrowser();
  const observedTokens: Array<string | null> = [];
  const unsubscribe = subscribeToSessionStorageChanges(() => {
    observedTokens.push(getActiveCompanyToken());
  });

  try {
    setActiveCompanyToken('unrelated-token');
    browser.dispatchStorage('unrelated.key', null, 'value');
    assert.deepEqual(observedTokens, []);
    assert.equal(getActiveCompanyToken(), 'unrelated-token');

    setActiveCompanyToken('company-token-a');
    browser.dispatchStorage(SESSION_KEY, JSON.stringify(makeSession('old', 'old')), JSON.stringify(makeSession('new', 'new')));
    setActiveCompanyToken('company-token-b');
    browser.dispatchStorage(SESSION_KEY, JSON.stringify(makeSession('new', 'new')), null);

    assert.deepEqual(observedTokens, [null, null]);
    assert.equal(getActiveCompanyToken(), null);

    unsubscribe();
    setActiveCompanyToken('after-unsubscribe');
    browser.dispatchStorage(SESSION_KEY, null, JSON.stringify(makeSession('later', 'later')));
    assert.deepEqual(observedTokens, [null, null]);
    assert.equal(getActiveCompanyToken(), 'after-unsubscribe');
  } finally {
    unsubscribe();
    setActiveCompanyToken(null);
    browser.restore();
  }
});

test('persisted platform tenant switching refreshes its owner and CASes from the rotated snapshot', async () => {
  const browser = installBrowser();
  const owner: Session = {
    ...makeWorkspaceSession('platform-expired', 'platform-refresh', 'platform-owner', 'membership-a', 'tenant-a'),
    user: {
      ...makeWorkspaceSession('platform-expired', 'platform-refresh', 'platform-owner', 'membership-a', 'tenant-a').user,
      isPlatformAdmin: true,
    },
  };
  const refreshed = { ...owner, accessToken: 'platform-fresh', refreshToken: 'platform-next' };
  await setSession(owner);
  const switchAuthorizations: Array<string | null> = [];
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) return Response.json(refreshed);
    if (path.endsWith('/me/switch-tenant')) {
      switchAuthorizations.push(bearer);
      if (bearer === 'Bearer platform-expired') return new Response(null, { status: 401 });
      if (bearer === 'Bearer platform-fresh') {
        return Response.json({ accessToken: 'tenant-scoped-access', activeMembershipId: 'membership-a' });
      }
    }
    throw new Error(`unexpected request: ${path} (${bearer})`);
  });

  try {
    const ownerApi = apiForSession(owner);
    const switched = await ownerApi.post<{ accessToken: string; activeMembershipId: string }>(
      '/me/switch-tenant',
      { membershipId: 'membership-a' },
    );
    const committed = await applyTenantSwitch(ownerApi.session(), switched.accessToken, switched.activeMembershipId);

    assert.deepEqual(switchAuthorizations, ['Bearer platform-expired', 'Bearer platform-fresh']);
    assert.equal(committed.accessToken, 'tenant-scoped-access');
    assert.equal(committed.refreshToken, 'platform-next');
    assert.deepEqual(getSession(), committed);
  } finally {
    restoreFetch();
    browser.restore();
  }
});

test('an owner-bound 401 joins a generic same-owner flight when its result is a proven server refresh', async () => {
  const browser = installBrowser();
  const ownerAccess = makeFamilyAccessToken('mixed-proven-family', 'expired');
  const freshAccess = makeFamilyAccessToken('mixed-proven-family', 'fresh');
  const owner = makeWorkspaceSession(ownerAccess, 'mixed-proven-refresh', 'user-1', 'membership-a', 'tenant-a');
  const refreshed = { ...owner, accessToken: freshAccess, refreshToken: 'mixed-proven-next' };
  await setSession(owner);
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const boundUnauthorized = deferred();
  const genericAuthorizations: Array<string | null> = [];
  const boundAuthorizations: Array<string | null> = [];
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json(refreshed);
    }
    if (path.endsWith('/mixed-generic')) {
      genericAuthorizations.push(bearer);
      if (bearer === `Bearer ${ownerAccess}`) return new Response(null, { status: 401 });
      if (bearer === `Bearer ${freshAccess}`) return Response.json({ generic: true });
    }
    if (path.endsWith('/mixed-bound-profile')) {
      boundAuthorizations.push(bearer);
      if (bearer === `Bearer ${ownerAccess}`) {
        boundUnauthorized.resolve();
        return new Response(null, { status: 401 });
      }
      if (bearer === `Bearer ${freshAccess}`) {
        return Response.json({ fullName: 'Mixed Profile', locale: 'en' });
      }
    }
    throw new Error(`unexpected request: ${path} (${bearer})`);
  });

  try {
    const genericPending = api.get<{ generic: boolean }>('/mixed-generic');
    await refreshStarted.promise;
    const ownerApi = apiForSession(owner);
    const boundPending = Promise.allSettled([
      ownerApi.patch<{ fullName: string; locale: string }>('/mixed-bound-profile', { fullName: 'Mixed Profile' }),
    ]);
    await boundUnauthorized.promise;
    releaseRefresh.resolve();
    const [generic, [bound]] = await Promise.all([genericPending, boundPending]);

    assert.deepEqual(generic, { generic: true });
    assert.equal(bound.status, 'fulfilled');
    assert.equal(refreshCalls, 1);
    assert.deepEqual(genericAuthorizations, [`Bearer ${ownerAccess}`, `Bearer ${freshAccess}`]);
    assert.deepEqual(boundAuthorizations, [`Bearer ${ownerAccess}`, `Bearer ${freshAccess}`]);
    assert.deepEqual(ownerApi.session(), refreshed);
    if (bound.status === 'fulfilled') {
      const committed = await updateSession(ownerApi.session(), (session) => ({
        ...session,
        user: { ...session.user, fullName: bound.value.fullName, locale: bound.value.locale },
      }));
      assert.equal(committed.user.fullName, 'Mixed Profile');
    }
  } finally {
    releaseRefresh.resolve();
    restoreFetch();
    browser.restore();
  }
});

test('an owner-bound 401 rejects an unproven advance from a generic same-owner Web Lock flight', async () => {
  const browser = installBrowser();
  const locks = installRefreshLockQueue();
  const ownerAccess = makeFamilyAccessToken('mixed-unproven-family', 'expired');
  const newLoginAccess = makeFamilyAccessToken('mixed-new-login-family', 'fresh');
  const owner = makeWorkspaceSession(ownerAccess, 'mixed-unproven-refresh', 'user-1', 'membership-a', 'tenant-a');
  const newLogin = { ...owner, accessToken: newLoginAccess, refreshToken: 'mixed-new-login-refresh' };
  await setSession(owner);
  const boundUnauthorized = deferred();
  const genericAuthorizations: Array<string | null> = [];
  const boundAuthorizations: Array<string | null> = [];
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return Response.json({ ...owner, accessToken: makeFamilyAccessToken('mixed-unproven-family', 'unexpected') });
    }
    if (path.endsWith('/mixed-unproven-generic')) {
      genericAuthorizations.push(bearer);
      if (bearer === `Bearer ${ownerAccess}`) return new Response(null, { status: 401 });
      if (bearer === `Bearer ${newLoginAccess}`) return Response.json({ generic: 'new-login' });
    }
    if (path.endsWith('/mixed-unproven-bound')) {
      boundAuthorizations.push(bearer);
      if (bearer === `Bearer ${ownerAccess}`) {
        boundUnauthorized.resolve();
        return new Response(null, { status: 401 });
      }
      if (bearer === `Bearer ${newLoginAccess}`) return Response.json({ unsafeReplay: true });
    }
    throw new Error(`unexpected request: ${path} (${bearer})`);
  });

  try {
    const genericPending = api.get<{ generic: string }>('/mixed-unproven-generic');
    await locks.requested;
    const ownerApi = apiForSession(owner);
    const boundPending = Promise.allSettled([ownerApi.get('/mixed-unproven-bound')]);
    await boundUnauthorized.promise;
    await setSession(newLogin);
    assert.equal(locks.releaseNext(), true);
    const [generic, [bound]] = await Promise.all([genericPending, boundPending]);

    assert.deepEqual(generic, { generic: 'new-login' });
    assertExpired(bound);
    assert.equal(refreshCalls, 0);
    assert.deepEqual(genericAuthorizations, [`Bearer ${ownerAccess}`, `Bearer ${newLoginAccess}`]);
    assert.deepEqual(boundAuthorizations, [`Bearer ${ownerAccess}`]);
    assert.deepEqual(ownerApi.session(), owner);
    assert.deepEqual(getSession(), newLogin);
    assert.equal(browser.location.href, '/app');
  } finally {
    locks.releaseNext();
    restoreFetch();
    locks.restore();
    browser.restore();
  }
});

test('an owner-bound 200 response follows a concurrent proven refresh in the same JWT family', async () => {
  const browser = installBrowser();
  const ownerAccess = makeFamilyAccessToken('bound-200-family', 'expired');
  const freshAccess = makeFamilyAccessToken('bound-200-family', 'fresh');
  const owner = makeWorkspaceSession(ownerAccess, 'bound-200-refresh', 'user-1', 'membership-a', 'tenant-a');
  const refreshed = { ...owner, accessToken: freshAccess, refreshToken: 'bound-200-next' };
  await setSession(owner);
  const boundStarted = deferred();
  const releaseBound = deferred();
  const boundAuthorizations: Array<string | null> = [];
  let refreshCalls = 0;
  const restoreFetch = installFetch(async (input, init) => {
    const path = String(input);
    const bearer = authorization(init);
    if (path.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return Response.json(refreshed);
    }
    if (path.endsWith('/bound-200-profile')) {
      boundAuthorizations.push(bearer);
      boundStarted.resolve();
      await releaseBound.promise;
      return Response.json({ fullName: 'Bound 200 Profile', locale: 'en' });
    }
    if (path.endsWith('/bound-200-generic') && bearer === `Bearer ${ownerAccess}`) {
      return new Response(null, { status: 401 });
    }
    if (path.endsWith('/bound-200-generic') && bearer === `Bearer ${freshAccess}`) {
      return Response.json({ generic: true });
    }
    throw new Error(`unexpected request: ${path} (${bearer})`);
  });

  try {
    const ownerApi = apiForSession(owner);
    const boundPending = ownerApi.patch<{ fullName: string; locale: string }>(
      '/bound-200-profile',
      { fullName: 'Bound 200 Profile' },
    );
    await boundStarted.promise;
    assert.deepEqual(await api.get('/bound-200-generic'), { generic: true });
    assert.deepEqual(getSession(), refreshed);
    releaseBound.resolve();
    const profile = await boundPending;
    const committed = await updateSession(ownerApi.session(), (session) => ({
      ...session,
      user: { ...session.user, fullName: profile.fullName, locale: profile.locale },
    }));

    assert.equal(refreshCalls, 1);
    assert.deepEqual(boundAuthorizations, [`Bearer ${ownerAccess}`]);
    assert.equal(ownerApi.session().accessToken, freshAccess);
    assert.equal(committed.user.fullName, 'Bound 200 Profile');
    assert.equal(committed.refreshToken, 'bound-200-next');
  } finally {
    releaseBound.resolve();
    restoreFetch();
    browser.restore();
  }
});

test('authenticated shells and owner-bound mutation callers retain their ownership wiring', () => {
  const source = (relativePath: string) => readFileSync(join(__dirname, relativePath), 'utf8');
  const shellPaths = [
    '../app/admin/layout.tsx',
    '../app/app/layout.tsx',
    '../app/hq/layout.tsx',
    '../app/platform/layout.tsx',
  ];
  for (const shellPath of shellPaths) {
    const shell = source(shellPath);
    assert.match(shell, /subscribeToSessionStorageChanges/);
    assert.match(shell, /window\.location\.reload\(\)/);
  }

  const callerPaths = [
    '../app/account/page.tsx',
    '../app/platform/companies/[id]/page.tsx',
    '../components/admin/MembersPageContent.tsx',
  ];
  for (const callerPath of callerPaths) {
    const caller = source(callerPath);
    assert.match(caller, /const ownerApi = apiForSession\(/);
    assert.match(caller, /ownerApi\.session\(\)/);
  }
});
