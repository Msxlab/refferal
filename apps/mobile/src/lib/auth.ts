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
    isPlatformAdmin?: boolean;
  };
  activeMembershipId: string | null;
  memberships: MembershipSummary[];
}

const KEY = 'refearn.session';

// In-memory cache for call sites that need synchronous access while AsyncStorage is async.
let cached: Session | null = null;

export async function loadSession(): Promise<Session | null> {
  if (cached) return cached;
  const raw = await AsyncStorage.getItem(KEY);
  cached = raw ? (JSON.parse(raw) as Session) : null;
  return cached;
}

export async function saveSession(s: Session): Promise<void> {
  cached = s;
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
}

export async function clearSession(): Promise<void> {
  cached = null;
  await AsyncStorage.removeItem(KEY);
}

export function activeMembership(s: Session): MembershipSummary | null {
  return s.memberships.find((m) => m.id === s.activeMembershipId) ?? s.memberships[0] ?? null;
}

const ADMIN_ROLES = new Set(['tenant_owner', 'tenant_admin', 'tenant_staff']);
const DEFAULT_MFA_SETUP_ROLES = ['tenant_owner', 'tenant_admin', 'tenant_staff', 'platform_admin'];

export interface AccessClaims {
  role?: string;
  perms?: string[];
  tid?: string;
  mid?: string;
  mfa?: boolean;
  plat?: boolean;
}

export type MobileLandingPath = '/(tabs)' | '/mfa-setup' | '/privileged';

export function isAdminRole(role: string | undefined): boolean {
  return role !== undefined && ADMIN_ROLES.has(role);
}

function decodeBase64(value: string): string {
  if (typeof globalThis.atob === 'function') return globalThis.atob(value);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const character of value) {
    if (character === '=') break;
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error('Invalid base64 data');
    buffer = ((buffer << 6) | digit) >>> 0;
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >>> bits) & 0xff);
    }
  }
  return output;
}

/** Decodes the JWT body only for mobile navigation. Authorization remains server-enforced. */
export function accessClaims(s: Session | null): AccessClaims {
  if (!s?.accessToken) return {};
  try {
    const payload = s.accessToken.split('.')[1];
    if (!payload) return {};
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return JSON.parse(decodeBase64(padded)) as AccessClaims;
  } catch {
    return {};
  }
}

export function roleForSession(s: Session): string | undefined {
  const role = accessClaims(s).role;
  return typeof role === 'string' ? role : activeMembership(s)?.role;
}

export function isPlatformSession(s: Session): boolean {
  const claims = accessClaims(s);
  return s.user.isPlatformAdmin === true || claims.plat === true;
}

function mfaSetupRoles(): ReadonlySet<string> {
  const raw = process.env.EXPO_PUBLIC_MFA_REQUIRED_ROLES;
  if (raw?.trim().toLowerCase() === 'none') return new Set();
  return new Set(
    (raw ?? DEFAULT_MFA_SETUP_ROLES.join(','))
      .split(',')
      .map((role: string) => role.trim())
      .filter(Boolean),
  );
}

/** Privileged roles must enroll MFA before their mobile landing surface is available. */
export function requiresMfaSetup(s: Session | null): boolean {
  if (!s) return false;
  const claims = accessClaims(s);
  const requiredRoles = mfaSetupRoles();
  const role = roleForSession(s);
  const privilegedTenantRole = role !== undefined && requiredRoles.has(role);
  const platformRole = requiredRoles.has('platform_admin') && isPlatformSession(s);
  return (privilegedTenantRole || platformRole) && claims.mfa !== true;
}

/** Any non-member administrative context stays out of the member-only tab navigator. */
export function isPrivilegedSession(s: Session): boolean {
  return isPlatformSession(s) || isAdminRole(roleForSession(s));
}

export function hasMemberWorkspace(s: Session): boolean {
  return activeMembership(s) !== null && !isPrivilegedSession(s);
}

/** A safe mobile equivalent of the web landing decision; unsupported admin work never falls through to member tabs. */
export function landingForSession(s: Session): MobileLandingPath {
  if (requiresMfaSetup(s)) return '/mfa-setup';
  return hasMemberWorkspace(s) ? '/(tabs)' : '/privileged';
}
