const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const apiPath = path.resolve(__dirname, '..', 'src', 'lib', 'api.ts');
const apiSource = fs.readFileSync(apiPath, 'utf8');
const authPath = path.resolve(__dirname, '..', 'src', 'lib', 'auth.ts');
const authSource = fs.readFileSync(authPath, 'utf8');
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
  let generation = 0;
  const saves = [];
  let clears = 0;
  const queuedSnapshots = [];
  const delayedSnapshots = [];
  const sameSnapshot = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const sameIdentity = (left, right) => {
    if (left.user.id !== right.user.id || left.activeMembershipId !== right.activeMembershipId) {
      return false;
    }
    if (left.activeMembershipId === null) return true;
    const leftMembership = left.memberships.find(({ id }) => id === left.activeMembershipId);
    const rightMembership = right.memberships.find(({ id }) => id === right.activeMembershipId);
    return Boolean(leftMembership && rightMembership && leftMembership.tenantId === rightMembership.tenantId);
  };
  const auth = {
    async loadSession() {
      return session;
    },
    async loadSessionSnapshot() {
      const snapshot = queuedSnapshots.shift() ?? { session, generation };
      const delay = delayedSnapshots.shift();
      if (delay) {
        delay.started.resolve(snapshot);
        await delay.released.promise;
      }
      return snapshot;
    },
    isSessionGenerationCurrent(expected) {
      return generation === expected;
    },
    async saveSession(next) {
      generation += 1;
      saves.push(next);
      session = next;
    },
    async clearSession() {
      generation += 1;
      clears += 1;
      session = null;
    },
    async saveSessionIfCurrent(expected, next) {
      if (generation !== expected.generation || !sameSnapshot(session, expected.session)) return null;
      generation += 1;
      saves.push(next);
      session = next;
      return { session: next, generation };
    },
    async clearSessionIfCurrent(expected) {
      if (generation !== expected.generation || !sameSnapshot(session, expected.session)) return false;
      generation += 1;
      clears += 1;
      session = null;
      return true;
    },
    async mergeSessionTokensIfSameIdentity(owner, tokens) {
      if (
        !session ||
        !sameIdentity(owner, session) ||
        session.accessToken !== owner.accessToken ||
        session.refreshToken !== owner.refreshToken
      ) {
        return false;
      }
      generation += 1;
      session = { ...session, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
      saves.push(session);
      return true;
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
      clear: () => auth.clearSession(),
      current: () => session,
      delayNextSnapshot() {
        const started = deferred();
        const released = deferred();
        delayedSnapshots.push({ started, released });
        return { started: started.promise, release: released.resolve };
      },
      queueSnapshot(next, snapshotGeneration = generation) {
        queuedSnapshots.push({ session: next, generation: snapshotGeneration });
      },
      replace(next) {
        generation += 1;
        session = next;
      },
      save: (next) => auth.saveSession(next),
      saves,
    },
  };
}

function createControlledAsyncStorage() {
  let stored = null;
  const delayedGets = [];
  const delayedSets = [];
  const delayedRemoves = [];
  const createDelay = (queue) => {
    const started = deferred();
    const released = deferred();
    queue.push({ started, released });
    return {
      started: started.promise,
      release: released.resolve,
    };
  };
  return {
    async getItem(key) {
      const delay = delayedGets.shift();
      if (delay) {
        delay.started.resolve({ key });
        await delay.released.promise;
      }
      return stored;
    },
    async setItem(key, value) {
      const delay = delayedSets.shift();
      if (delay) {
        delay.started.resolve({ key, value });
        await delay.released.promise;
      }
      stored = value;
    },
    async removeItem(key) {
      const delay = delayedRemoves.shift();
      if (delay) {
        delay.started.resolve({ key });
        await delay.released.promise;
      }
      stored = null;
    },
    delayNextSet() {
      return createDelay(delayedSets);
    },
    delayNextGet() {
      return createDelay(delayedGets);
    },
    delayNextRemove() {
      return createDelay(delayedRemoves);
    },
    storedSession() {
      return stored === null ? null : JSON.parse(stored);
    },
    seedSession(session) {
      stored = session === null ? null : JSON.stringify(session);
    },
  };
}

function loadActualAuth(asyncStorage) {
  const compiled = ts.transpileModule(authSource, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: authPath,
  }).outputText;
  const authModule = new Module(authPath, module);
  authModule.filename = authPath;
  authModule.paths = Module._nodeModulePaths(path.dirname(authPath));
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === '@react-native-async-storage/async-storage' && parent?.filename === authPath) {
      return asyncStorage;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    authModule._compile(compiled, authPath);
  } finally {
    Module._load = originalLoad;
  }
  return authModule.exports;
}

function authorization(init) {
  return new Headers(init?.headers).get('Authorization');
}

test('atomic refresh save loses when a replacement save is invoked during delayed persistence', async () => {
  const storage = createControlledAsyncStorage();
  const auth = loadActualAuth(storage);
  const owner = makeSession();
  const staleRefresh = makeSession({
    accessToken: 'stale-cas-access-token',
    refreshToken: 'stale-cas-refresh-token',
  });
  const replacement = makeSession({
    accessToken: 'replacement-cas-access-token',
    refreshToken: 'replacement-cas-refresh-token',
    userId: 'replacement-user',
    membershipId: 'replacement-membership',
    tenantId: 'replacement-tenant',
  });
  await auth.saveSession(owner);
  const captured = await auth.loadSessionSnapshot();
  const staleWrite = storage.delayNextSet();
  const staleSave = auth.saveSessionIfCurrent(captured, staleRefresh);
  await staleWrite.started;

  const replacementSave = auth.saveSession(replacement);
  staleWrite.release();

  assert.equal(await staleSave, null);
  await replacementSave;
  const current = await auth.loadSessionSnapshot();
  assert.deepEqual(current.session, replacement);
  assert.deepEqual(storage.storedSession(), replacement);
});

test('atomic refresh clear loses when a replacement save is invoked during delayed removal', async () => {
  const storage = createControlledAsyncStorage();
  const auth = loadActualAuth(storage);
  const owner = makeSession();
  const replacement = makeSession({
    accessToken: 'replacement-after-clear-access-token',
    refreshToken: 'replacement-after-clear-refresh-token',
    userId: 'replacement-after-clear-user',
    membershipId: 'replacement-after-clear-membership',
    tenantId: 'replacement-after-clear-tenant',
  });
  await auth.saveSession(owner);
  const captured = await auth.loadSessionSnapshot();
  const staleRemoval = storage.delayNextRemove();
  const staleClear = auth.clearSessionIfCurrent(captured);
  await staleRemoval.started;

  const replacementSave = auth.saveSession(replacement);
  staleRemoval.release();

  assert.equal(await staleClear, false);
  await replacementSave;
  const current = await auth.loadSessionSnapshot();
  assert.deepEqual(current.session, replacement);
  assert.deepEqual(storage.storedSession(), replacement);
});

test('a pending delayed replacement invalidates stale CAS immediately through generation', async () => {
  const storage = createControlledAsyncStorage();
  const auth = loadActualAuth(storage);
  const owner = makeSession();
  const staleRefresh = makeSession({
    accessToken: 'pending-stale-access-token',
    refreshToken: 'pending-stale-refresh-token',
  });
  const replacement = makeSession({
    accessToken: 'pending-replacement-access-token',
    refreshToken: 'pending-replacement-refresh-token',
    userId: 'pending-replacement-user',
    membershipId: 'pending-replacement-membership',
    tenantId: 'pending-replacement-tenant',
  });
  await auth.saveSession(owner);
  const captured = await auth.loadSessionSnapshot();
  const replacementWrite = storage.delayNextSet();
  const replacementSave = auth.saveSession(replacement);
  await replacementWrite.started;

  let staleSettled = false;
  let staleResult;
  const staleSave = auth.saveSessionIfCurrent(captured, staleRefresh);
  void staleSave.then((result) => {
    staleSettled = true;
    staleResult = result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  const settledBeforeReplacementWrite = staleSettled;

  replacementWrite.release();
  await replacementSave;
  await staleSave;

  assert.equal(settledBeforeReplacementWrite, true);
  assert.equal(staleResult, null);
  const current = await auth.loadSessionSnapshot();
  assert.deepEqual(current.session, replacement);
  assert.deepEqual(storage.storedSession(), replacement);
});

test('a session snapshot retries after a replacement save starts during its delayed storage read', async () => {
  const storage = createControlledAsyncStorage();
  const owner = makeSession();
  const replacement = makeSession({
    accessToken: 'snapshot-replacement-access-token',
    refreshToken: 'snapshot-replacement-refresh-token',
    userId: 'snapshot-replacement-user',
    membershipId: 'snapshot-replacement-membership',
    tenantId: 'snapshot-replacement-tenant',
  });
  storage.seedSession(owner);
  const auth = loadActualAuth(storage);
  const delayedRead = storage.delayNextGet();
  const snapshotPromise = auth.loadSessionSnapshot();
  await delayedRead.started;

  const replacementSave = auth.saveSession(replacement);
  delayedRead.release();

  const snapshot = await snapshotPromise;
  await replacementSave;
  const current = await auth.loadSessionSnapshot();
  assert.deepEqual(snapshot, current);
  assert.deepEqual(snapshot.session, replacement);
  assert.deepEqual(storage.storedSession(), replacement);
});

test('a session snapshot retries after a clear starts during its delayed storage read', async () => {
  const storage = createControlledAsyncStorage();
  const owner = makeSession();
  storage.seedSession(owner);
  const auth = loadActualAuth(storage);
  const delayedRead = storage.delayNextGet();
  const snapshotPromise = auth.loadSessionSnapshot();
  await delayedRead.started;

  const clearing = auth.clearSession();
  delayedRead.release();

  const snapshot = await snapshotPromise;
  await clearing;
  const current = await auth.loadSessionSnapshot();
  assert.deepEqual(snapshot, current);
  assert.equal(snapshot.session, null);
  assert.equal(storage.storedSession(), null);
});

async function assertTokenSalvageSurvivesDelayedIo(io) {
  const storage = createControlledAsyncStorage();
  const owner = makeSession();
  const firstMetadata = {
    ...owner,
    user: { ...owner.user, fullName: 'First metadata', locale: 'tr' },
    memberships: owner.memberships.map((membership) => ({
      ...membership,
      role: 'manager',
      tenantName: 'First tenant name',
    })),
  };
  const latestMetadata = {
    ...owner,
    user: { ...owner.user, fullName: 'Latest metadata', locale: 'de' },
    memberships: owner.memberships.map((membership) => ({
      ...membership,
      role: 'owner',
      tenantName: 'Latest tenant name',
    })),
  };
  const freshTokens = {
    accessToken: `salvaged-${io}-access-token`,
    refreshToken: `salvaged-${io}-refresh-token`,
  };
  if (io === 'read') storage.seedSession(firstMetadata);
  const auth = loadActualAuth(storage);
  if (io === 'write') await auth.saveSession(firstMetadata);
  const delayedIo = io === 'read' ? storage.delayNextGet() : storage.delayNextSet();
  const salvage = auth.mergeSessionTokensIfSameIdentity(owner, freshTokens);
  await delayedIo.started;

  const latestSave = auth.saveSession(latestMetadata);
  delayedIo.release();

  assert.equal(await salvage, true);
  await latestSave;
  const expected = { ...latestMetadata, ...freshTokens };
  const current = await auth.loadSessionSnapshot();
  assert.deepEqual(current.session, expected);
  assert.deepEqual(storage.storedSession(), expected);
}

test('token salvage requeues behind same-owner metadata saves during delayed read and write I/O', async () => {
  await assertTokenSalvageSurvivesDelayedIo('read');
  await assertTokenSalvageSurvivesDelayedIo('write');
});

test('token salvage never crosses a different user, workspace, or cleared session', async () => {
  const owner = makeSession();
  const freshTokens = {
    accessToken: 'forbidden-salvage-access-token',
    refreshToken: 'forbidden-salvage-refresh-token',
  };
  const cases = [
    makeSession({
      userId: 'different-user',
      membershipId: owner.activeMembershipId,
      tenantId: owner.memberships[0].tenantId,
    }),
    makeSession({
      userId: owner.user.id,
      membershipId: 'different-workspace-membership',
      tenantId: 'different-workspace-tenant',
    }),
    {
      ...owner,
      memberships: owner.memberships.map((membership) => ({
        ...membership,
        tenantId: 'different-tenant-for-same-membership',
      })),
    },
    null,
  ];

  for (const currentSession of cases) {
    const storage = createControlledAsyncStorage();
    const auth = loadActualAuth(storage);
    if (currentSession) await auth.saveSession(currentSession);
    else {
      await auth.saveSession(owner);
      await auth.clearSession();
    }
    const before = await auth.loadSessionSnapshot();

    assert.equal(await auth.mergeSessionTokensIfSameIdentity(owner, freshTokens), false);
    const current = await auth.loadSessionSnapshot();
    assert.deepEqual(current.session, before.session);
    assert.deepEqual(storage.storedSession(), before.session);
  }
});

test('token salvage never replaces an already-advanced same-identity token pair', async () => {
  const owner = makeSession();
  const staleFreshTokens = {
    accessToken: 'stale-old-refresh-access-token',
    refreshToken: 'stale-old-refresh-token',
  };
  const advancedSessions = [
    { ...owner, accessToken: 'new-login-access-token' },
    { ...owner, refreshToken: 'other-advancement-refresh-token' },
    {
      ...owner,
      accessToken: 'fully-advanced-access-token',
      refreshToken: 'fully-advanced-refresh-token',
    },
  ];

  for (const advanced of advancedSessions) {
    const storage = createControlledAsyncStorage();
    const auth = loadActualAuth(storage);
    await auth.saveSession(advanced);

    assert.equal(await auth.mergeSessionTokensIfSameIdentity(owner, staleFreshTokens), false);
    const current = await auth.loadSessionSnapshot();
    assert.deepEqual(current.session, advanced);
    assert.deepEqual(storage.storedSession(), advanced);
  }
});

test('CAS token lineage upgrades metadata saves queued during write and promise resolution', async () => {
  for (const phase of ['write', 'promise-resolution']) {
    const storage = createControlledAsyncStorage();
    const auth = loadActualAuth(storage);
    const owner = makeSession();
    const fresh = makeSession({
      accessToken: `lineage-${phase}-fresh-access-token`,
      refreshToken: `lineage-${phase}-fresh-refresh-token`,
    });
    const latestMetadata = {
      ...owner,
      user: { ...owner.user, fullName: `Latest ${phase} metadata`, locale: 'it' },
      memberships: owner.memberships.map((membership) => ({
        ...membership,
        role: 'owner',
        tenantName: `Latest ${phase} tenant`,
      })),
    };
    const expected = {
      ...latestMetadata,
      accessToken: fresh.accessToken,
      refreshToken: fresh.refreshToken,
    };
    await auth.saveSession(owner);
    const captured = await auth.loadSessionSnapshot();

    let casResult;
    if (phase === 'write') {
      const delayedWrite = storage.delayNextSet();
      const cas = auth.saveSessionIfCurrent(captured, fresh);
      await delayedWrite.started;
      const metadataSave = auth.saveSession(latestMetadata);
      delayedWrite.release();
      casResult = await cas;
      await metadataSave;
      assert.equal(casResult, null);
    } else {
      const cas = auth.saveSessionIfCurrent(captured, fresh);
      await cas.then(async (result) => {
        casResult = result;
        await auth.saveSession(latestMetadata);
      });
      assert.notEqual(casResult, null);
    }

    const current = await auth.loadSessionSnapshot();
    assert.deepEqual(current.session, expected);
    assert.deepEqual(storage.storedSession(), expected);
  }
});

test('merged token lineage upgrades later metadata saves but lets a third token pair win', async () => {
  const storage = createControlledAsyncStorage();
  const auth = loadActualAuth(storage);
  const owner = makeSession();
  const freshTokens = {
    accessToken: 'merged-lineage-fresh-access-token',
    refreshToken: 'merged-lineage-fresh-refresh-token',
  };
  const latestMetadata = {
    ...owner,
    user: { ...owner.user, fullName: 'Merged lineage metadata', locale: 'es' },
    memberships: owner.memberships.map((membership) => ({
      ...membership,
      role: 'manager',
    })),
  };
  await auth.saveSession(owner);
  assert.equal(await auth.mergeSessionTokensIfSameIdentity(owner, freshTokens), true);

  await auth.saveSession(latestMetadata);
  const merged = { ...latestMetadata, ...freshTokens };
  assert.deepEqual((await auth.loadSessionSnapshot()).session, merged);
  assert.deepEqual(storage.storedSession(), merged);

  const thirdPair = {
    ...latestMetadata,
    accessToken: 'same-identity-relogin-access-token',
    refreshToken: 'same-identity-relogin-refresh-token',
  };
  await auth.saveSession(thirdPair);
  assert.deepEqual((await auth.loadSessionSnapshot()).session, thirdPair);
  assert.deepEqual(storage.storedSession(), thirdPair);
});

test('multi-hop token lineage upgrades every known ancestor while an unknown pair wins', async () => {
  const storage = createControlledAsyncStorage();
  const auth = loadActualAuth(storage);
  const tokenA = makeSession();
  const tokenB = makeSession({
    accessToken: 'lineage-hop-b-access-token',
    refreshToken: 'lineage-hop-b-refresh-token',
  });
  const tokenC = makeSession({
    accessToken: 'lineage-hop-c-access-token',
    refreshToken: 'lineage-hop-c-refresh-token',
  });
  await auth.saveSession(tokenA);
  const capturedA = await auth.loadSessionSnapshot();
  assert.notEqual(await auth.saveSessionIfCurrent(capturedA, tokenB), null);
  const capturedB = await auth.loadSessionSnapshot();
  assert.notEqual(await auth.saveSessionIfCurrent(capturedB, tokenC), null);

  const latestFromA = {
    ...tokenA,
    user: { ...tokenA.user, fullName: 'Newest metadata from ancestor A', locale: 'nl' },
    memberships: tokenA.memberships.map((membership) => ({
      ...membership,
      role: 'owner',
      tenantName: 'Newest tenant metadata from A',
    })),
  };
  await auth.saveSession(latestFromA);
  const expectedFromA = {
    ...latestFromA,
    accessToken: tokenC.accessToken,
    refreshToken: tokenC.refreshToken,
  };
  assert.deepEqual((await auth.loadSessionSnapshot()).session, expectedFromA);
  assert.deepEqual(storage.storedSession(), expectedFromA);

  const latestFromB = {
    ...latestFromA,
    accessToken: tokenB.accessToken,
    refreshToken: tokenB.refreshToken,
    user: { ...latestFromA.user, fullName: 'Newest metadata from ancestor B' },
  };
  await auth.saveSession(latestFromB);
  const expectedFromB = {
    ...latestFromB,
    accessToken: tokenC.accessToken,
    refreshToken: tokenC.refreshToken,
  };
  assert.deepEqual((await auth.loadSessionSnapshot()).session, expectedFromB);
  assert.deepEqual(storage.storedSession(), expectedFromB);

  const unknownD = {
    ...latestFromB,
    accessToken: 'unknown-lineage-d-access-token',
    refreshToken: 'unknown-lineage-d-refresh-token',
    user: { ...latestFromB.user, fullName: 'Real re-login metadata D' },
  };
  await auth.saveSession(unknownD);
  assert.deepEqual((await auth.loadSessionSnapshot()).session, unknownD);
  assert.deepEqual(storage.storedSession(), unknownD);
});

test('clear and different identity saves invalidate token lineage boundaries', async () => {
  const owner = makeSession();
  const fresh = makeSession({
    accessToken: 'boundary-fresh-access-token',
    refreshToken: 'boundary-fresh-refresh-token',
  });

  for (const boundary of ['clear', 'different-identity']) {
    const storage = createControlledAsyncStorage();
    const auth = loadActualAuth(storage);
    await auth.saveSession(owner);
    const captured = await auth.loadSessionSnapshot();
    assert.notEqual(await auth.saveSessionIfCurrent(captured, fresh), null);

    if (boundary === 'clear') {
      await auth.clearSession();
      assert.equal((await auth.loadSessionSnapshot()).session, null);
      assert.equal(storage.storedSession(), null);
    } else {
      const replacement = makeSession({
        accessToken: 'boundary-replacement-access-token',
        refreshToken: 'boundary-replacement-refresh-token',
        userId: 'boundary-replacement-user',
        membershipId: 'boundary-replacement-membership',
        tenantId: 'boundary-replacement-tenant',
      });
      await auth.saveSession(replacement);
      assert.deepEqual((await auth.loadSessionSnapshot()).session, replacement);
      assert.deepEqual(storage.storedSession(), replacement);
    }
  }
});

async function assertFinalRetryMutationDoesNotReplay(mutation) {
  const owner = makeSession();
  const fresh = makeSession({
    accessToken: `fresh-before-${mutation}-access-token`,
    refreshToken: `fresh-before-${mutation}-refresh-token`,
  });
  const replacement = makeSession({
    accessToken: 'final-validation-replacement-access-token',
    refreshToken: 'final-validation-replacement-refresh-token',
    userId: 'final-validation-replacement-user',
    membershipId: 'final-validation-replacement-membership',
    tenantId: 'final-validation-replacement-tenant',
  });
  const loaded = loadApi(owner);
  const validationArmed = deferred();
  const replayAuthorizations = [];
  let validation;
  let refreshCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const token = authorization(init);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      validation = loaded.persistence.delayNextSnapshot();
      validationArmed.resolve(validation);
      return Response.json(fresh);
    }
    if (token === `Bearer ${owner.accessToken}`) return new Response(null, { status: 401 });
    replayAuthorizations.push(token);
    return Response.json({ replayed: true });
  };

  try {
    const request = loaded.api.get(`/final-validation-${mutation}`);
    validation = await validationArmed.promise;
    await validation.started;

    const mutationPromise =
      mutation === 'save' ? loaded.persistence.save(replacement) : loaded.persistence.clear();
    validation.release();

    const [result] = await Promise.allSettled([request]);
    await mutationPromise;
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof loaded.ApiError);
      assert.equal(result.reason.status, 401);
      assert.equal(result.reason.message, 'session expired');
    }
    assert.equal(refreshCalls, 1);
    assert.deepEqual(replayAuthorizations, []);
    assert.deepEqual(loaded.persistence.current(), mutation === 'save' ? replacement : null);
  } finally {
    validation?.release();
    globalThis.fetch = previousFetch;
  }
}

test('a replacement save during final retry snapshot validation prevents stale replay', async () => {
  await assertFinalRetryMutationDoesNotReplay('save');
});

test('a clear during final retry snapshot validation prevents stale replay', async () => {
  await assertFinalRetryMutationDoesNotReplay('clear');
});

test('same-owner metadata replacement salvages rotated tokens without replaying the stale request', async () => {
  const owner = makeSession();
  const fresh = makeSession({
    accessToken: 'salvage-first-access-token',
    refreshToken: 'salvage-first-refresh-token',
  });
  const replacement = {
    ...owner,
    user: { ...owner.user, fullName: 'Authorized metadata', locale: 'fr' },
    memberships: owner.memberships.map((membership) => ({
      ...membership,
      role: 'admin',
      tenantName: 'Authorized tenant name',
    })),
  };
  const merged = {
    ...replacement,
    accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken,
  };
  const fresher = {
    ...replacement,
    accessToken: 'salvage-second-access-token',
    refreshToken: 'salvage-second-refresh-token',
  };
  const loaded = loadApi(owner);
  const firstRefreshStarted = deferred();
  const releaseFirstRefresh = deferred();
  const refreshBodies = [];
  const requestAuthorizations = new Map();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const token = authorization(init);
    if (url.endsWith('/auth/refresh')) {
      const body = JSON.parse(String(init?.body));
      refreshBodies.push(body);
      if (refreshBodies.length === 1) {
        firstRefreshStarted.resolve();
        await releaseFirstRefresh.promise;
        return Response.json(fresh);
      }
      assert.deepEqual(body, { refreshToken: fresh.refreshToken });
      return Response.json(fresher);
    }
    const tokens = requestAuthorizations.get(url) ?? [];
    tokens.push(token);
    requestAuthorizations.set(url, tokens);
    if (url.endsWith('/stale-metadata') && token === `Bearer ${owner.accessToken}`) {
      return new Response(null, { status: 401 });
    }
    if (url.endsWith('/after-salvage') && token === `Bearer ${fresh.accessToken}`) {
      return new Response(null, { status: 401 });
    }
    if (url.endsWith('/after-salvage') && token === `Bearer ${fresher.accessToken}`) {
      return Response.json({ refreshed: true });
    }
    return Response.json({ staleReplay: true });
  };

  try {
    const staleRequest = loaded.api.get('/stale-metadata');
    await firstRefreshStarted.promise;
    await loaded.persistence.save(replacement);
    releaseFirstRefresh.resolve();

    const [staleResult] = await Promise.allSettled([staleRequest]);
    assert.equal(staleResult.status, 'rejected');
    if (staleResult.status === 'rejected') {
      assert.ok(staleResult.reason instanceof loaded.ApiError);
      assert.equal(staleResult.reason.status, 401);
      assert.equal(staleResult.reason.message, 'session expired');
    }
    assert.deepEqual(requestAuthorizations.get(`${apiBase}/stale-metadata`), [
      `Bearer ${owner.accessToken}`,
    ]);
    assert.deepEqual(loaded.persistence.current(), merged);

    assert.deepEqual(await loaded.api.get('/after-salvage'), { refreshed: true });
    assert.deepEqual(refreshBodies, [
      { refreshToken: owner.refreshToken },
      { refreshToken: fresh.refreshToken },
    ]);
    assert.deepEqual(requestAuthorizations.get(`${apiBase}/after-salvage`), [
      `Bearer ${fresh.accessToken}`,
      `Bearer ${fresher.accessToken}`,
    ]);
  } finally {
    releaseFirstRefresh.resolve();
    globalThis.fetch = previousFetch;
  }
});

async function assertAdvancedTokenRaceDoesNotSalvage(label, tokenOverrides) {
  const owner = makeSession();
  const staleRefresh = makeSession({
    accessToken: `stale-${label}-access-token`,
    refreshToken: `stale-${label}-refresh-token`,
  });
  const advanced = {
    ...owner,
    ...tokenOverrides,
    user: { ...owner.user, fullName: `Latest ${label} metadata` },
    memberships: owner.memberships.map((membership) => ({
      ...membership,
      role: 'admin',
    })),
  };
  const loaded = loadApi(owner);
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const replayAuthorizations = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const token = authorization(init);
    if (url.endsWith('/auth/refresh')) {
      assert.deepEqual(JSON.parse(String(init?.body)), { refreshToken: owner.refreshToken });
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json(staleRefresh);
    }
    if (url.endsWith(`/advanced-${label}`) && token === `Bearer ${owner.accessToken}`) {
      return new Response(null, { status: 401 });
    }
    replayAuthorizations.push(token);
    return Response.json({ replayed: true });
  };

  try {
    const staleRequest = loaded.api.get(`/advanced-${label}`);
    await refreshStarted.promise;
    await loaded.persistence.save(advanced);
    releaseRefresh.resolve();

    const [result] = await Promise.allSettled([staleRequest]);
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof loaded.ApiError);
      assert.equal(result.reason.status, 401);
      assert.equal(result.reason.message, 'session expired');
    }
    assert.deepEqual(loaded.persistence.saves, [advanced]);
    assert.equal(loaded.persistence.clearCalls(), 0);
    assert.deepEqual(replayAuthorizations, []);
    assert.deepEqual(loaded.persistence.current(), advanced);
  } finally {
    releaseRefresh.resolve();
    globalThis.fetch = previousFetch;
  }
}

test('same-identity access or refresh token advancement always wins an older refresh race', async () => {
  await assertAdvancedTokenRaceDoesNotSalvage('access-only', {
    accessToken: 'new-login-access-token',
  });
  await assertAdvancedTokenRaceDoesNotSalvage('refresh-only', {
    refreshToken: 'other-advancement-refresh-token',
  });
  await assertAdvancedTokenRaceDoesNotSalvage('both-tokens', {
    accessToken: 'fully-advanced-access-token',
    refreshToken: 'fully-advanced-refresh-token',
  });
});

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

    loaded.persistence.queueSnapshot(ownerB);
    const staleB = loaded.api.get('/stale-owner-b');
    await staleBStarted.promise;

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
  const merged = {
    ...replacement,
    accessToken: staleRefresh.accessToken,
    refreshToken: staleRefresh.refreshToken,
  };
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
    assert.deepEqual(loaded.persistence.saves, [merged]);
    assert.equal(loaded.persistence.clearCalls(), 0);
    assert.deepEqual(replayAuthorizations, []);
    assert.deepEqual(loaded.persistence.current(), merged);
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
  const merged = {
    ...replacement,
    accessToken: staleRefresh.accessToken,
    refreshToken: staleRefresh.refreshToken,
  };
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
    assert.deepEqual(loaded.persistence.saves, [merged]);
    assert.equal(loaded.persistence.clearCalls(), 0);
    assert.deepEqual(replayAuthorizations, []);
    assert.deepEqual(loaded.persistence.current(), merged);
  } finally {
    releaseRefresh.resolve();
    globalThis.fetch = previousFetch;
  }
});
