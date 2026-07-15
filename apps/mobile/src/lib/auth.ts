import AsyncStorage from '@react-native-async-storage/async-storage';

export interface MembershipSummary {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: string;
  referralCode: string;
  depth: number;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    locale: string;
    emailVerified: boolean;
  };
  activeMembershipId: string | null;
  memberships: MembershipSummary[];
}

const KEY = 'refearn.session';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isSession(value: unknown): value is Session {
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

// In-memory cache for call sites that need synchronous access while AsyncStorage is async.
let cached: Session | null = null;
let cacheInitialized = false;
let generation = 0;
let sessionQueue: Promise<void> = Promise.resolve();

type SessionTokenPair = Pick<Session, 'accessToken' | 'refreshToken'>;

const TOKEN_LINEAGE_ANCESTOR_CAP = 32;
const PRUNED_TOKEN_FINGERPRINT_BIT_SIZE = 8192;
const PRUNED_TOKEN_FINGERPRINT_WORDS = PRUNED_TOKEN_FINGERPRINT_BIT_SIZE / 32;
const TOKEN_FINGERPRINT_SEEDS = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b] as const;

interface TokenAdvancement {
  owner: Session;
  ancestors: SessionTokenPair[];
  latestTokens: SessionTokenPair;
  familyId: string | null;
  prunedTokenBits: Uint32Array;
}

let tokenAdvancement: TokenAdvancement | null = null;

export interface SessionSnapshot {
  session: Session | null;
  generation: number;
}

function sameSessionSnapshot(left: Session | null, right: Session | null): boolean {
  if (!left || !right) return left === right;
  return (
    left.accessToken === right.accessToken &&
    left.refreshToken === right.refreshToken &&
    left.user.id === right.user.id &&
    left.user.email === right.user.email &&
    left.user.fullName === right.user.fullName &&
    left.user.locale === right.user.locale &&
    left.user.emailVerified === right.user.emailVerified &&
    left.activeMembershipId === right.activeMembershipId &&
    left.memberships.length === right.memberships.length &&
    left.memberships.every((membership, index) => {
      const other = right.memberships[index];
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

function sameSessionIdentity(left: Session, right: Session): boolean {
  if (left.user.id !== right.user.id || left.activeMembershipId !== right.activeMembershipId) {
    return false;
  }
  if (left.activeMembershipId === null) return true;
  const leftMembership = left.memberships.find(({ id }) => id === left.activeMembershipId);
  const rightMembership = right.memberships.find(({ id }) => id === right.activeMembershipId);
  return Boolean(
    leftMembership && rightMembership && leftMembership.tenantId === rightMembership.tenantId,
  );
}

function hasTokenPair(session: SessionTokenPair, tokens: SessionTokenPair): boolean {
  return (
    session.accessToken === tokens.accessToken && session.refreshToken === tokens.refreshToken
  );
}

function tokenPairOf(session: SessionTokenPair): SessionTokenPair {
  return { accessToken: session.accessToken, refreshToken: session.refreshToken };
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  if (typeof globalThis.atob === 'function') return globalThis.atob(padded);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const character of padded) {
    if (character === '=') break;
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error('invalid base64url');
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

function accessTokenFamilyId(accessToken: string): string | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const claims: unknown = JSON.parse(decodeBase64Url(payload));
    if (!isRecord(claims) || !isNonEmptyString(claims.sid)) return null;
    return claims.sid;
  } catch {
    return null;
  }
}

function sharedTokenFamily(left: SessionTokenPair, right: SessionTokenPair): string | null {
  const leftFamily = accessTokenFamilyId(left.accessToken);
  const rightFamily = accessTokenFamilyId(right.accessToken);
  return leftFamily && leftFamily === rightFamily ? leftFamily : null;
}

function tokenFingerprint(tokens: SessionTokenPair, seed: number): number {
  let hash = seed >>> 0;
  const value = `${tokens.accessToken}\u0000${tokens.refreshToken}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function addPrunedTokenFingerprint(bits: Uint32Array, tokens: SessionTokenPair): void {
  for (const seed of TOKEN_FINGERPRINT_SEEDS) {
    const index = tokenFingerprint(tokens, seed) % PRUNED_TOKEN_FINGERPRINT_BIT_SIZE;
    bits[index >>> 5] |= 1 << (index & 31);
  }
}

function mayBePrunedTokenPair(bits: Uint32Array, tokens: SessionTokenPair): boolean {
  return TOKEN_FINGERPRINT_SEEDS.every((seed) => {
    const index = tokenFingerprint(tokens, seed) % PRUNED_TOKEN_FINGERPRINT_BIT_SIZE;
    return (bits[index >>> 5] & (1 << (index & 31))) !== 0;
  });
}

function retainBoundedAncestors(
  ancestors: SessionTokenPair[],
  prunedTokenBits: Uint32Array,
): { ancestors: SessionTokenPair[]; prunedTokenBits: Uint32Array } {
  const firstRetained = Math.max(0, ancestors.length - TOKEN_LINEAGE_ANCESTOR_CAP);
  const nextBits = prunedTokenBits.slice();
  for (const tokens of ancestors.slice(0, firstRetained)) {
    addPrunedTokenFingerprint(nextBits, tokens);
  }
  return { ancestors: ancestors.slice(firstRetained), prunedTokenBits: nextBits };
}

function isKnownTokenPair(advancement: TokenAdvancement, tokens: SessionTokenPair): boolean {
  return (
    hasTokenPair(tokens, advancement.latestTokens) ||
    advancement.ancestors.some((ancestor) => hasTokenPair(tokens, ancestor))
  );
}

function appendUniqueTokenPair(
  pairs: SessionTokenPair[],
  tokens: SessionTokenPair,
): SessionTokenPair[] {
  return pairs.some((pair) => hasTokenPair(pair, tokens))
    ? pairs
    : [...pairs, tokenPairOf(tokens)];
}

function registerTokenAdvancement(owner: Session | null, refreshed: Session): void {
  if (!owner || !sameSessionIdentity(owner, refreshed)) {
    tokenAdvancement = null;
    return;
  }
  const familyId = sharedTokenFamily(owner, refreshed);
  if (hasTokenPair(refreshed, owner)) {
    const current = tokenAdvancement;
    if (
      current &&
      current.familyId === familyId &&
      sameSessionIdentity(current.owner, refreshed) &&
      isKnownTokenPair(current, refreshed)
    ) {
      return;
    }
    tokenAdvancement = null;
    return;
  }
  const current = tokenAdvancement;
  if (
    current &&
    current.familyId === familyId &&
    sameSessionIdentity(current.owner, refreshed) &&
    isKnownTokenPair(current, owner)
  ) {
    let ancestors = appendUniqueTokenPair(current.ancestors, current.latestTokens);
    ancestors = appendUniqueTokenPair(ancestors, owner);
    const latestTokens = tokenPairOf(refreshed);
    const retained = retainBoundedAncestors(
      ancestors.filter((ancestor) => !hasTokenPair(ancestor, latestTokens)),
      current.prunedTokenBits,
    );
    tokenAdvancement = {
      owner: current.owner,
      ancestors: retained.ancestors,
      latestTokens,
      familyId,
      prunedTokenBits: retained.prunedTokenBits,
    };
    return;
  }
  tokenAdvancement = {
    owner,
    ancestors: [tokenPairOf(owner)],
    latestTokens: tokenPairOf(refreshed),
    familyId,
    prunedTokenBits: new Uint32Array(PRUNED_TOKEN_FINGERPRINT_WORDS),
  };
}

function resolveQueuedSessionSave(session: Session): {
  session: Session;
  advancement: TokenAdvancement | null;
} {
  const advancement = tokenAdvancement;
  if (!advancement || !sameSessionIdentity(advancement.owner, session)) {
    return { session, advancement: null };
  }
  if (hasTokenPair(session, advancement.latestTokens)) {
    return { session, advancement };
  }
  if (advancement.ancestors.some((ancestor) => hasTokenPair(session, ancestor))) {
    return {
      session: { ...session, ...advancement.latestTokens },
      advancement,
    };
  }
  if (
    advancement.familyId !== null &&
    accessTokenFamilyId(session.accessToken) === advancement.familyId &&
    mayBePrunedTokenPair(advancement.prunedTokenBits, session)
  ) {
    return {
      session: { ...session, ...advancement.latestTokens },
      advancement,
    };
  }
  return { session, advancement: null };
}

function enqueueSessionOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = sessionQueue.then(operation, operation);
  sessionQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function loadSessionWithinQueue(): Promise<Session | null> {
  if (cacheInitialized) return cached;
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(KEY);
  } catch {
    cached = null;
    cacheInitialized = false;
    tokenAdvancement = null;
    return null;
  }
  if (!raw) {
    cached = null;
    cacheInitialized = true;
    return null;
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    candidate = null;
  }
  if (!isSession(candidate)) {
    cached = null;
    cacheInitialized = true;
    tokenAdvancement = null;
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      // Memory remains fail-closed even if corrupt durable data cannot be removed.
    }
    return null;
  }
  cached = candidate;
  cacheInitialized = true;
  return cached;
}

function loadStableSessionSnapshot(): Promise<SessionSnapshot> {
  const observedGeneration = generation;
  return enqueueSessionOperation(async () => ({
    session: await loadSessionWithinQueue(),
    generation: observedGeneration,
  })).then((snapshot) =>
    generation === snapshot.generation ? snapshot : loadStableSessionSnapshot(),
  );
}

export function loadSessionSnapshot(): Promise<SessionSnapshot> {
  return loadStableSessionSnapshot();
}

export function isSessionGenerationCurrent(expected: number): boolean {
  return generation === expected;
}

export async function loadSession(): Promise<Session | null> {
  return (await loadSessionSnapshot()).session;
}

export function saveSession(s: Session): Promise<void> {
  if (!isSession(s)) return Promise.reject(new TypeError('invalid session'));
  generation += 1;
  return enqueueSessionOperation(async () => {
    const resolved = resolveQueuedSessionSave(s);
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(resolved.session));
    } catch (error) {
      cached = null;
      cacheInitialized = true;
      tokenAdvancement = null;
      try {
        await AsyncStorage.removeItem(KEY);
      } catch {
        // The rejected save remains fail-closed in memory.
      }
      throw error;
    }
    cached = resolved.session;
    cacheInitialized = true;
    tokenAdvancement = resolved.advancement;
  });
}

export function clearSession(): Promise<void> {
  generation += 1;
  return enqueueSessionOperation(async () => {
    cached = null;
    cacheInitialized = true;
    tokenAdvancement = null;
    await AsyncStorage.removeItem(KEY);
  });
}

export function saveSessionIfCurrent(
  expected: SessionSnapshot,
  next: Session,
): Promise<SessionSnapshot | null> {
  if (!isSession(next)) return Promise.resolve(null);
  if (generation !== expected.generation) return Promise.resolve(null);
  const operationGeneration = ++generation;
  return enqueueSessionOperation(async () => {
    const current = await loadSessionWithinQueue();
    if (
      generation !== operationGeneration ||
      !sameSessionSnapshot(expected.session, current)
    ) {
      return null;
    }
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      if (generation === operationGeneration) {
        try {
          await AsyncStorage.removeItem(KEY);
          if (generation === operationGeneration) {
            cached = null;
            cacheInitialized = true;
            tokenAdvancement = null;
          }
        } catch {
          // The caller still receives a failed CAS without a raw storage error.
        }
      }
      return null;
    }
    registerTokenAdvancement(expected.session, next);
    if (generation !== operationGeneration) return null;
    cached = next;
    cacheInitialized = true;
    return { session: next, generation: operationGeneration };
  });
}

export function clearSessionIfCurrent(expected: SessionSnapshot): Promise<boolean> {
  if (generation !== expected.generation) return Promise.resolve(false);
  const operationGeneration = ++generation;
  return enqueueSessionOperation(async () => {
    const current = await loadSessionWithinQueue();
    if (
      generation !== operationGeneration ||
      !sameSessionSnapshot(expected.session, current)
    ) {
      return false;
    }
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      if (generation === operationGeneration) {
        cached = null;
        cacheInitialized = true;
        tokenAdvancement = null;
      }
      return false;
    }
    if (generation !== operationGeneration) return false;
    cached = null;
    cacheInitialized = true;
    tokenAdvancement = null;
    return true;
  });
}

type TokenMergeAttempt =
  | { status: 'merged'; generation: number }
  | { status: 'retry' }
  | { status: 'stopped' };

function mergeSessionTokensAttempt(
  owner: Session,
  tokens: Pick<Session, 'accessToken' | 'refreshToken'>,
): Promise<boolean> {
  const observedGeneration = generation;
  return enqueueSessionOperation(async (): Promise<TokenMergeAttempt> => {
    const current = await loadSessionWithinQueue();
    if (generation !== observedGeneration) return { status: 'retry' };
    if (!current || !sameSessionIdentity(owner, current)) {
      return { status: 'stopped' };
    }
    if (hasTokenPair(current, tokens)) {
      registerTokenAdvancement(owner, current);
      return { status: 'merged', generation: observedGeneration };
    }
    if (!hasTokenPair(current, owner)) return { status: 'stopped' };

    const operationGeneration = ++generation;
    const merged: Session = {
      ...current,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(merged));
    } catch {
      return generation === operationGeneration ? { status: 'stopped' } : { status: 'retry' };
    }
    registerTokenAdvancement(owner, merged);
    if (generation !== operationGeneration) return { status: 'retry' };
    cached = merged;
    cacheInitialized = true;
    return { status: 'merged', generation: operationGeneration };
  }).then((result) => {
    if (
      result.status === 'retry' ||
      (result.status === 'merged' && generation !== result.generation)
    ) {
      return mergeSessionTokensAttempt(owner, tokens);
    }
    return result.status === 'merged';
  });
}

export function mergeSessionTokensIfSameIdentity(
  owner: Session,
  tokens: Pick<Session, 'accessToken' | 'refreshToken'>,
): Promise<boolean> {
  if (!isSession(owner) || !isNonEmptyString(tokens.accessToken) || !isNonEmptyString(tokens.refreshToken)) {
    return Promise.resolve(false);
  }
  return mergeSessionTokensAttempt(owner, tokens);
}

export function __tokenLineageDiagnosticsForTests(): {
  ancestorCount: number;
  ancestorCap: number;
  fingerprintBitSize: number;
} {
  return {
    ancestorCount: tokenAdvancement?.ancestors.length ?? 0,
    ancestorCap: TOKEN_LINEAGE_ANCESTOR_CAP,
    fingerprintBitSize: PRUNED_TOKEN_FINGERPRINT_BIT_SIZE,
  };
}

export function activeMembership(s: Session): MembershipSummary | null {
  return s.memberships.find((m) => m.id === s.activeMembershipId) ?? s.memberships[0] ?? null;
}
