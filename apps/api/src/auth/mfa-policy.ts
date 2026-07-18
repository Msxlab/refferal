import { Role } from '@prisma/client';

const VALID_ROLES = new Set<string>(Object.values(Role));

/** Keeps isolated automated tests free to exercise routes without an MFA enrollment fixture. */
export function defaultMfaRequiredRoles(environment = process.env.NODE_ENV): string {
  return environment === 'test' ? '' : 'tenant_owner,tenant_admin,tenant_staff,platform_admin';
}

/** Parses the deployment override while ignoring unknown roles instead of weakening the policy. */
export function mfaRequiredRoles(
  override = process.env.MFA_REQUIRED_ROLES,
  environment = process.env.NODE_ENV,
): ReadonlySet<Role> {
  const raw = override ?? defaultMfaRequiredRoles(environment);
  return new Set(
    raw
      .split(',')
      .map((role) => role.trim())
      .filter((role): role is Role => VALID_ROLES.has(role)),
  );
}
