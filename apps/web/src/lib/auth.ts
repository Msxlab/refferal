// The short-lived access token lives in localStorage. Refresh sessions stay in
// HttpOnly cookies and must never be persisted by this module.

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
  refreshToken?: string;
  user: { id: string; email: string; fullName: string; locale: string; emailVerified: boolean; isPlatformAdmin?: boolean };
  activeMembershipId: string | null;
  memberships: MembershipSummary[];
}

const KEY = 'refearn.session';

function withoutRefreshToken(s: Session): Session {
  const { refreshToken: _refreshToken, ...persisted } = s;
  return persisted;
}

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return null;
  const session = JSON.parse(raw) as Session;
  if (!('refreshToken' in session)) return session;
  const persisted = withoutRefreshToken(session);
  window.localStorage.setItem(KEY, JSON.stringify(persisted));
  return persisted;
}

export function setSession(s: Session): void {
  window.localStorage.setItem(KEY, JSON.stringify(withoutRefreshToken(s)));
}

export function clearSession(): void {
  window.localStorage.removeItem(KEY);
}

export function activeMembership(s: Session): MembershipSummary | null {
  return s.memberships.find((m) => m.id === s.activeMembershipId) ?? s.memberships[0] ?? null;
}

const ADMIN_ROLES = new Set(['tenant_owner', 'tenant_admin', 'tenant_staff']);

export function isAdminRole(role: string | undefined): boolean {
  return role !== undefined && ADMIN_ROLES.has(role);
}

const GOD_TIERS = new Set(['platform_admin', 'tenant_owner']);

interface AccessClaims {
  role?: string;
  perms?: string[];
  tid?: string;
  mid?: string;
  mfa?: boolean;
  plat?: boolean;
}

/** Decodes the access JWT body for UI display only. Signature verification happens on the server. */
export function accessClaims(s: Session | null): AccessClaims {
  if (!s?.accessToken) return {};
  try {
    const part = s.accessToken.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as AccessClaims;
  } catch {
    return {};
  }
}

/** Fine-grained UI permission check. Owner/platform always pass; backend still enforces access. */
export function can(s: Session | null, permission: string): boolean {
  const c = accessClaims(s);
  if (c.role && GOD_TIERS.has(c.role)) return true;
  return c.perms?.includes(permission) ?? false;
}

/** Role-based default landing path: admin roles to /admin, members to /app (SPEC 4.3). */
export function landingPath(role: string | undefined): string {
  return isAdminRole(role) ? '/admin' : '/app';
}

const DEFAULT_MFA_SETUP_ROLES = ['tenant_owner', 'tenant_admin', 'platform_admin'];

function mfaSetupRoles(): ReadonlySet<string> {
  const raw = process.env.NEXT_PUBLIC_MFA_REQUIRED_ROLES;
  if (raw?.trim().toLowerCase() === 'none') return new Set();
  return new Set((raw ?? DEFAULT_MFA_SETUP_ROLES.join(',')).split(',').map((role) => role.trim()).filter(Boolean));
}

export function requiresMfaSetup(s: Session | null): boolean {
  if (!s) return false;
  const claims = accessClaims(s);
  const role = claims.role ?? activeMembership(s)?.role;
  const requiredRoles = mfaSetupRoles();
  const privilegedTenantRole = role !== undefined && requiredRoles.has(role);
  const platformRole = requiredRoles.has('platform_admin') && (claims.plat === true || s.user.isPlatformAdmin === true);
  return (privilegedTenantRole || platformRole) && claims.mfa !== true;
}

/** Session-based landing path: platform admins to /platform, otherwise by role. */
export function landingForSession(s: Session): string {
  if (requiresMfaSetup(s)) return '/mfa-setup';
  if (s.user.isPlatformAdmin) return '/platform';
  return landingPath(activeMembership(s)?.role);
}
