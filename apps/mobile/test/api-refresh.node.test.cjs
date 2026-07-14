const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const apiPath = path.resolve(__dirname, '..', 'src', 'lib', 'api.ts');
const apiSource = fs.readFileSync(apiPath, 'utf8');
const apiBase = 'http://mobile-api.test/v1';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeSession({
  accessToken = 'expired-access-token',
  refreshToken = 'captured-refresh-token',
  userId = 'user-a',
  membershipId = 'membership-a',
  tenantId = 'tenant-a',
} = {}) {
  return {
    accessToken,
    refreshToken,
    user: {
      id: userId,
      email: `${userId}@example.test`,
      fullName: userId,
      locale: 'en',
      emailVerified: true,
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

function loadApi(initialSession) {
  let session = initialSession;
  const saves = [];
  let clears = 0;
  const auth = {
    async loadSession() {
      return session;
    },
    async saveSession(next) {
      saves.push(next);
      session = next;
    },
    async clearSession() {
      clears += 1;
      session = null;
    },
  };

  const compiled = ts.transpileModule(apiSource, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: apiPath,
  }).outputText;
  const apiModule = new Module(apiPath, module);
  apiModule.filename = apiPath;
  apiModule.paths = Module._nodeModulePaths(path.dirname(apiPath));
  const originalLoad = Module._load;
  const previousBase = process.env.EXPO_PUBLIC_API_URL;
  Module._load = function load(request, parent, isMain) {
    if (request === './auth' && parent?.filename === apiPath) return auth;
    return originalLoad.call(this, request, parent, isMain);
  };
  process.env.EXPO_PUBLIC_API_URL = apiBase;
  try {
    apiModule._compile(compiled, apiPath);
  } finally {
    Module._load = originalLoad;
    if (previousBase === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = previousBase;
  }

  return {
    ...apiModule.exports,
    persistence: {
      clearCalls: () => clears,
      current: () => session,
      replace(next) {
        session = next;
      },
      saves,
    },
  };
}

function authorization(init) {
  return new Headers(init?.headers).get('Authorization');
}

test('parallel 401 operations share one refresh and retry once with the same new session', async () => {
  const owner = makeSession();
  const fresh = makeSession({
    accessToken: 'fresh-access-token',
    refreshToken: 'rotated-refresh-token',
  });
  const loaded = loadApi(owner);
  const bothUnauthorized = deferred();
  const requestTokens = new Map();
  const refreshBodies = [];
  let unauthorizedCalls = 0;
  let refreshCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshBodies.push(JSON.parse(String(init?.body)));
      await bothUnauthorized.promise;
      return Response.json(fresh);
    }
    const tokens = requestTokens.get(url) ?? [];
    tokens.push(authorization(init));
    requestTokens.set(url, tokens);
    if (authorization(init) === `Bearer ${owner.accessToken}`) {
      unauthorizedCalls += 1;
      if (unauthorizedCalls === 2) bothUnauthorized.resolve();
      return new Response(null, { status: 401 });
    }
    if (authorization(init) === `Bearer ${fresh.accessToken}`) return Response.json({ url });
    throw new Error(`unexpected authorization for ${url}: ${authorization(init)}`);
  };

  try {
    const [first, second] = await Promise.all([
      loaded.api.get('/first-resource'),
      loaded.api.post('/second-resource', { value: 2 }),
    ]);

    assert.equal(refreshCalls, 1);
    assert.deepEqual(refreshBodies, [{ refreshToken: owner.refreshToken }]);
    assert.equal(loaded.persistence.saves.length, 1);
    assert.deepEqual(loaded.persistence.current(), fresh);
    assert.equal(first.url, `${apiBase}/first-resource`);
    assert.equal(second.url, `${apiBase}/second-resource`);
    for (const resource of ['first-resource', 'second-resource']) {
      assert.deepEqual(requestTokens.get(`${apiBase}/${resource}`), [
        `Bearer ${owner.accessToken}`,
        `Bearer ${fresh.accessToken}`,
      ]);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a late same-session 401 reuses the completed refresh after the active flight is cleared', async () => {
  const owner = makeSession();
  const fresh = makeSession({
    accessToken: 'late-fresh-access-token',
    refreshToken: 'late-rotated-refresh-token',
  });
  const loaded = loadApi(owner);
  const slowOriginalStarted = deferred();
  const releaseSlowUnauthorized = deferred();
  const requestTokens = new Map();
  let refreshCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const token = authorization(init);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      assert.deepEqual(JSON.parse(String(init?.body)), { refreshToken: owner.refreshToken });
      return Response.json(fresh);
    }
    const tokens = requestTokens.get(url) ?? [];
    tokens.push(token);
    requestTokens.set(url, tokens);
    if (url.endsWith('/slow-resource') && token === `Bearer ${owner.accessToken}`) {
      slowOriginalStarted.resolve();
      await releaseSlowUnauthorized.promise;
      return new Response(null, { status: 401 });
    }
    if (url.endsWith('/fast-resource') && token === `Bearer ${owner.accessToken}`) {
      return new Response(null, { status: 401 });
    }
    if (token === `Bearer ${fresh.accessToken}`) {
      return Response.json({ resource: url.endsWith('/fast-resource') ? 'fast' : 'slow' });
    }
    throw new Error(`unexpected authorization for ${url}: ${token}`);
  };

  try {
    const slow = loaded.api.get('/slow-resource');
    await slowOriginalStarted.promise;
    const fastResult = await loaded.api.get('/fast-resource');
    assert.deepEqual(fastResult, { resource: 'fast' });
    assert.equal(refreshCalls, 1);
    assert.deepEqual(loaded.persistence.current(), fresh);

    releaseSlowUnauthorized.resolve();
    const slowResult = await slow;

    assert.deepEqual(slowResult, { resource: 'slow' });
    assert.equal(refreshCalls, 1);
    assert.deepEqual(requestTokens.get(`${apiBase}/fast-resource`), [
      `Bearer ${owner.accessToken}`,
      `Bearer ${fresh.accessToken}`,
    ]);
    assert.deepEqual(requestTokens.get(`${apiBase}/slow-resource`), [
      `Bearer ${owner.accessToken}`,
      `Bearer ${fresh.accessToken}`,
    ]);
  } finally {
    releaseSlowUnauthorized.resolve();
    globalThis.fetch = previousFetch;
  }
});

test('a completed refresh is ignored when persisted session details no longer match exactly', async () => {
  const owner = makeSession();
  const fresh = makeSession({
    accessToken: 'recorded-fresh-access-token',
    refreshToken: 'recorded-rotated-refresh-token',
  });
  const replacement = {
    ...fresh,
    memberships: fresh.memberships.map((membership) => ({ ...membership, role: 'tenant_admin' })),
  };
  const loaded = loadApi(owner);
  const slowOriginalStarted = deferred();
  const releaseSlowUnauthorized = deferred();
  const replayAuthorizations = [];
  let refreshCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const token = authorization(init);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return Response.json(fresh);
    }
    if (url.endsWith('/slow-exact-resource') && token === `Bearer ${owner.accessToken}`) {
      slowOriginalStarted.resolve();
      await releaseSlowUnauthorized.promise;
      return new Response(null, { status: 401 });
    }
    if (url.endsWith('/fast-exact-resource') && token === `Bearer ${owner.accessToken}`) {
      return new Response(null, { status: 401 });
    }
    if (url.endsWith('/fast-exact-resource') && token === `Bearer ${fresh.accessToken}`) {
      return Response.json({ resource: 'fast' });
    }
    replayAuthorizations.push(token);
    return Response.json({ replayed: true });
  };

  try {
    const slow = loaded.api.get('/slow-exact-resource');
    await slowOriginalStarted.promise;
    assert.deepEqual(await loaded.api.get('/fast-exact-resource'), { resource: 'fast' });
    loaded.persistence.replace(replacement);
    releaseSlowUnauthorized.resolve();
    const [result] = await Promise.allSettled([slow]);

    assert.equal(refreshCalls, 1);
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof loaded.ApiError);
      assert.equal(result.reason.status, 401);
      assert.equal(result.reason.message, 'session expired');
    }
    assert.deepEqual(replayAuthorizations, []);
    assert.deepEqual(loaded.persistence.current(), replacement);
  } finally {
    releaseSlowUnauthorized.resolve();
    globalThis.fetch = previousFetch;
  }
});

test('a stale different-session attempt cannot erase another owner completed refresh', async () => {
  const ownerA = makeSession();
  const freshA = makeSession({
    accessToken: 'owner-a-fresh-access-token',
    refreshToken: 'owner-a-rotated-refresh-token',
  });
  const ownerB = makeSession({
    accessToken: 'stale-owner-b-access-token',
    refreshToken: 'stale-owner-b-refresh-token',
    userId: 'user-b',
    membershipId: 'membership-b',
    tenantId: 'tenant-b',
  });
  const loaded = loadApi(ownerA);
  const lateAStarted = deferred();
  const staleBStarted = deferred();
  const releaseLateA = deferred();
  const releaseStaleB = deferred();
  const requestTokens = new Map();
  let refreshCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const token = authorization(init);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      assert.deepEqual(JSON.parse(String(init?.body)), { refreshToken: ownerA.refreshToken });
      return Response.json(freshA);
    }
    const tokens = requestTokens.get(url) ?? [];
    tokens.push(token);
    requestTokens.set(url, tokens);
    if (url.endsWith('/late-owner-a') && token === `Bearer ${ownerA.accessToken}`) {
      lateAStarted.resolve();
      await releaseLateA.promise;
      return new Response(null, { status: 401 });
    }
    if (url.endsWith('/stale-owner-b') && token === `Bearer ${ownerB.accessToken}`) {
      staleBStarted.resolve();
      await releaseStaleB.promise;
      return new Response(null, { status: 401 });
    }
    if (url.endsWith('/fast-owner-a') && token === `Bearer ${ownerA.accessToken}`) {
      return new Response(null, { status: 401 });
    }
    if (token === `Bearer ${freshA.accessToken}`) {
      return Response.json({ owner: 'a', timing: url.endsWith('/fast-owner-a') ? 'fast' : 'late' });
    }
    throw new Error(`unexpected authorization for ${url}: ${token}`);
  };

  try {
    const lateA = loaded.api.get('/late-owner-a');
    await lateAStarted.promise;

    loaded.persistence.replace(ownerB);
    const staleB = loaded.api.get('/stale-owner-b');
    await staleBStarted.promise;

    loaded.persistence.replace(ownerA);
    assert.deepEqual(await loaded.api.get('/fast-owner-a'), { owner: 'a', timing: 'fast' });
    assert.equal(refreshCalls, 1);
    assert.deepEqual(loaded.persistence.current(), freshA);

    releaseStaleB.resolve();
    const [staleResult] = await Promise.allSettled([staleB]);
    assert.equal(staleResult.status, 'rejected');
    if (staleResult.status === 'rejected') {
      assert.ok(staleResult.reason instanceof loaded.ApiError);
      assert.equal(staleResult.reason.status, 401);
      assert.equal(staleResult.reason.message, 'session expired');
    }
    assert.equal(refreshCalls, 1);
    assert.deepEqual(loaded.persistence.current(), freshA);

    releaseLateA.resolve();
    assert.deepEqual(await lateA, { owner: 'a', timing: 'late' });
    assert.equal(refreshCalls, 1);
    assert.deepEqual(requestTokens.get(`${apiBase}/late-owner-a`), [
      `Bearer ${ownerA.accessToken}`,
      `Bearer ${freshA.accessToken}`,
    ]);
    assert.deepEqual(requestTokens.get(`${apiBase}/stale-owner-b`), [`Bearer ${ownerB.accessToken}`]);
    assert.deepEqual(loaded.persistence.current(), freshA);
  } finally {
    releaseStaleB.resolve();
    releaseLateA.resolve();
    globalThis.fetch = previousFetch;
  }
});

async function assertConcurrentRefreshFailure(refreshFailure) {
  const owner = makeSession();
  const loaded = loadApi(owner);
  const bothUnauthorized = deferred();
  const replayAuthorizations = [];
  let unauthorizedCalls = 0;
  let refreshCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      await bothUnauthorized.promise;
      return refreshFailure();
    }
    if (authorization(init) === `Bearer ${owner.accessToken}`) {
      unauthorizedCalls += 1;
      if (unauthorizedCalls === 2) bothUnauthorized.resolve();
      return new Response(null, { status: 401 });
    }
    replayAuthorizations.push(authorization(init));
    return Response.json({ replayed: true });
  };

  try {
    const results = await Promise.allSettled([
      loaded.api.get('/first-resource'),
      loaded.api.get('/second-resource'),
    ]);

    assert.equal(refreshCalls, 1);
    assert.equal(loaded.persistence.clearCalls(), 1);
    assert.equal(loaded.persistence.current(), null);
    assert.deepEqual(replayAuthorizations, []);
    for (const result of results) {
      assert.equal(result.status, 'rejected');
      if (result.status === 'rejected') {
        assert.ok(result.reason instanceof loaded.ApiError);
        assert.equal(result.reason.status, 401);
        assert.equal(result.reason.message, 'session expired');
      }
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test('refresh network failure clears once and normalizes every waiter to unauthorized', async () => {
  await assertConcurrentRefreshFailure(() => {
    throw new TypeError('refresh network unavailable');
  });
});

test('refresh parse failure clears once and normalizes every waiter to unauthorized', async () => {
  await assertConcurrentRefreshFailure(() =>
    new Response('{malformed', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
});

test('an in-flight refresh never overwrites or replays after a different session replaces its owner', async () => {
  const owner = makeSession();
  const ownerRefresh = makeSession({
    accessToken: 'stale-fresh-access-token',
    refreshToken: 'stale-rotated-refresh-token',
  });
  const replacement = makeSession({
    accessToken: 'replacement-access-token',
    refreshToken: 'replacement-refresh-token',
    userId: 'user-b',
    membershipId: 'membership-b',
    tenantId: 'tenant-b',
  });
  const loaded = loadApi(owner);
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const replayAuthorizations = [];
  let refreshCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      assert.deepEqual(JSON.parse(String(init?.body)), { refreshToken: owner.refreshToken });
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json(ownerRefresh);
    }
    if (authorization(init) === `Bearer ${owner.accessToken}`) return new Response(null, { status: 401 });
    replayAuthorizations.push(authorization(init));
    return Response.json({ replayed: true });
  };

  try {
    const pending = loaded.api.get('/owned-resource');
    await refreshStarted.promise;
    loaded.persistence.replace(replacement);
    releaseRefresh.resolve();
    const [result] = await Promise.allSettled([pending]);

    assert.equal(refreshCalls, 1);
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof loaded.ApiError);
      assert.equal(result.reason.status, 401);
      assert.equal(result.reason.message, 'session expired');
    }
    assert.equal(loaded.persistence.clearCalls(), 0);
    assert.equal(loaded.persistence.saves.length, 0);
    assert.deepEqual(loaded.persistence.current(), replacement);
    assert.deepEqual(replayAuthorizations, []);
  } finally {
    releaseRefresh.resolve();
    globalThis.fetch = previousFetch;
  }
});

test('refresh success cannot overwrite a same-token authorization snapshot replacement', async () => {
  const owner = makeSession();
  const replacement = {
    ...owner,
    memberships: owner.memberships.map((membership) => ({ ...membership, role: 'tenant_admin' })),
  };
  const staleRefresh = makeSession({
    accessToken: 'stale-role-refresh-access-token',
    refreshToken: 'stale-role-rotated-refresh-token',
  });
  const loaded = loadApi(owner);
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const replayAuthorizations = [];
  let refreshCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const token = authorization(init);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json(staleRefresh);
    }
    if (url.endsWith('/role-replacement-success') && token === `Bearer ${owner.accessToken}`) {
      return new Response(null, { status: 401 });
    }
    replayAuthorizations.push(token);
    return Response.json({ replayed: true });
  };

  try {
    const pending = loaded.api.get('/role-replacement-success');
    await refreshStarted.promise;
    loaded.persistence.replace(replacement);
    releaseRefresh.resolve();
    const [result] = await Promise.allSettled([pending]);

    assert.equal(refreshCalls, 1);
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof loaded.ApiError);
      assert.equal(result.reason.status, 401);
      assert.equal(result.reason.message, 'session expired');
    }
    assert.equal(loaded.persistence.saves.length, 0);
    assert.equal(loaded.persistence.clearCalls(), 0);
    assert.deepEqual(replayAuthorizations, []);
    assert.deepEqual(loaded.persistence.current(), replacement);
  } finally {
    releaseRefresh.resolve();
    globalThis.fetch = previousFetch;
  }
});

test('refresh failure cannot clear a same-token authorization snapshot replacement', async () => {
  const owner = makeSession();
  const replacement = {
    ...owner,
    memberships: owner.memberships.map((membership) => ({ ...membership, role: 'tenant_admin' })),
  };
  const loaded = loadApi(owner);
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  let refreshCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const token = authorization(init);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json({ message: 'refresh rejected' }, { status: 401 });
    }
    if (url.endsWith('/role-replacement-failure') && token === `Bearer ${owner.accessToken}`) {
      return new Response(null, { status: 401 });
    }
    throw new Error(`unexpected authorization for ${url}: ${token}`);
  };

  try {
    const pending = loaded.api.get('/role-replacement-failure');
    await refreshStarted.promise;
    loaded.persistence.replace(replacement);
    releaseRefresh.resolve();
    const [result] = await Promise.allSettled([pending]);

    assert.equal(refreshCalls, 1);
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof loaded.ApiError);
      assert.equal(result.reason.status, 401);
      assert.equal(result.reason.message, 'session expired');
    }
    assert.equal(loaded.persistence.clearCalls(), 0);
    assert.deepEqual(loaded.persistence.current(), replacement);
  } finally {
    releaseRefresh.resolve();
    globalThis.fetch = previousFetch;
  }
});

test('a changed authorization snapshot operation never joins an older same-token refresh flight', async () => {
  const owner = makeSession();
  const replacement = {
    ...owner,
    memberships: owner.memberships.map((membership) => ({ ...membership, role: 'tenant_admin' })),
  };
  const staleRefresh = makeSession({
    accessToken: 'old-flight-fresh-access-token',
    refreshToken: 'old-flight-rotated-refresh-token',
  });
  const loaded = loadApi(owner);
  const refreshStarted = deferred();
  const changedUnauthorized = deferred();
  const releaseRefresh = deferred();
  const replayAuthorizations = [];
  let changedSettled = false;
  let refreshCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const token = authorization(init);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json(staleRefresh);
    }
    if (url.endsWith('/old-role-flight') && token === `Bearer ${owner.accessToken}`) {
      return new Response(null, { status: 401 });
    }
    if (url.endsWith('/changed-role-operation') && token === `Bearer ${replacement.accessToken}`) {
      changedUnauthorized.resolve();
      return new Response(null, { status: 401 });
    }
    replayAuthorizations.push(token);
    return Response.json({ replayed: true });
  };

  try {
    const oldPending = loaded.api.get('/old-role-flight');
    await refreshStarted.promise;
    loaded.persistence.replace(replacement);
    const changedPending = loaded.api.get('/changed-role-operation');
    void changedPending.then(
      () => {
        changedSettled = true;
      },
      () => {
        changedSettled = true;
      },
    );
    await changedUnauthorized.promise;
    await new Promise((resolve) => setImmediate(resolve));
    const settledBeforeOldFlight = changedSettled;

    releaseRefresh.resolve();
    const [oldResult, changedResult] = await Promise.all([
      Promise.allSettled([oldPending]).then(([result]) => result),
      Promise.allSettled([changedPending]).then(([result]) => result),
    ]);

    assert.equal(settledBeforeOldFlight, true);
    assert.equal(refreshCalls, 1);
    for (const result of [oldResult, changedResult]) {
      assert.equal(result.status, 'rejected');
      if (result.status === 'rejected') {
        assert.ok(result.reason instanceof loaded.ApiError);
        assert.equal(result.reason.status, 401);
        assert.equal(result.reason.message, 'session expired');
      }
    }
    assert.equal(loaded.persistence.saves.length, 0);
    assert.equal(loaded.persistence.clearCalls(), 0);
    assert.deepEqual(replayAuthorizations, []);
    assert.deepEqual(loaded.persistence.current(), replacement);
  } finally {
    releaseRefresh.resolve();
    globalThis.fetch = previousFetch;
  }
});
