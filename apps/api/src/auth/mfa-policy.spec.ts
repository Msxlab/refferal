import { Role } from '@prisma/client';
import { defaultMfaRequiredRoles, mfaRequiredRoles } from './mfa-policy';

describe('MFA role policy', () => {
  it('requires MFA for every privileged tenant tier in production', () => {
    expect(defaultMfaRequiredRoles('production')).toBe('tenant_owner,tenant_admin,tenant_staff,platform_admin');
    expect(mfaRequiredRoles(undefined, 'production')).toEqual(
      new Set([Role.tenant_owner, Role.tenant_admin, Role.tenant_staff, Role.platform_admin]),
    );
  });

  it('keeps the test default exempt while honoring an explicit override', () => {
    expect(defaultMfaRequiredRoles('test')).toBe('');
    expect(mfaRequiredRoles('tenant_staff,unknown-role', 'test')).toEqual(new Set([Role.tenant_staff]));
  });
});
