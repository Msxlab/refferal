/**
 * RBAC permission catalog as code. There is no DB table; roles store arrays of these keys.
 * Key format is "<resource>.<action>". The UI matrix renders these groups directly.
 * tenant_owner and platform_admin always carry every permission.
 */

export interface PermissionDef {
  key: string;
  label: string;
}
export interface PermissionGroup {
  key: string;
  label: string;
  permissions: PermissionDef[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    permissions: [{ key: 'dashboard.view', label: 'View dashboard & analytics' }],
  },
  {
    key: 'sales',
    label: 'Sales',
    permissions: [
      { key: 'sales.view', label: 'View sales' },
      { key: 'sales.create', label: 'Record sales' },
      { key: 'sales.approve', label: 'Approve sales' },
      { key: 'sales.void', label: 'Void / reverse sales' },
      { key: 'sales.import', label: 'Import sales (CSV)' },
      { key: 'sales.export', label: 'Export sales' },
    ],
  },
  {
    key: 'members',
    label: 'Members',
    permissions: [
      { key: 'members.view', label: 'View members' },
      { key: 'members.manage', label: 'Edit member details' },
      { key: 'members.suspend', label: 'Suspend / reactivate members' },
      { key: 'network.view', label: 'View referral network' },
    ],
  },
  {
    key: 'invites',
    label: 'Invitations',
    permissions: [
      { key: 'invites.create', label: 'Create invitations' },
      { key: 'invites.revoke', label: 'Revoke invitations' },
    ],
  },
  {
    key: 'payouts',
    label: 'Payouts',
    permissions: [
      { key: 'payouts.view', label: 'View payouts' },
      { key: 'payouts.process', label: 'Process / mark paid' },
      { key: 'payouts.export', label: 'Export payout batches' },
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    permissions: [
      { key: 'reports.view', label: 'View reports' },
      { key: 'reports.export', label: 'Export reports' },
    ],
  },
  {
    key: 'audit',
    label: 'Audit',
    permissions: [{ key: 'audit.view', label: 'View audit log' }],
  },
  {
    key: 'settings',
    label: 'Settings',
    permissions: [
      { key: 'settings.view', label: 'View settings' },
      { key: 'settings.general', label: 'Edit general settings' },
      { key: 'settings.plan', label: 'Edit commission plan' },
      { key: 'settings.branding', label: 'Edit branding' },
      { key: 'settings.payments', label: 'Edit payout settings' },
      { key: 'settings.roles', label: 'Manage people & roles' },
      { key: 'settings.security', label: 'Manage security policy' },
      { key: 'settings.notifications', label: 'Manage notification templates' },
      { key: 'settings.data', label: 'Manage data & backups' },
    ],
  },
];

export const ALL_PERMISSIONS: string[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.key),
);

const allExcept = (...omit: string[]): string[] =>
  ALL_PERMISSIONS.filter((p) => !omit.includes(p));

const viewOnly = (): string[] => ALL_PERMISSIONS.filter((p) => p.endsWith('.view'));

/** System role definitions seeded for every tenant by RolesService.ensureSystemRoles. */
export interface SystemRoleSeed {
  key: string;
  name: string;
  description: string;
  color: string;
  permissions: string[];
}

export const SYSTEM_ROLES: SystemRoleSeed[] = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Full access to everything, including roles and billing.',
    color: '#D4AF37',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    key: 'admin',
    name: 'Administrator',
    description: 'Manage the whole workspace except destructive role deletion.',
    color: '#5B7CFA',
    permissions: allExcept('settings.data'),
  },
  {
    key: 'finance',
    name: 'Finance',
    description: 'Approve sales, run payouts and reporting.',
    color: '#23A981',
    permissions: [
      'dashboard.view',
      'sales.view',
      'sales.approve',
      'sales.void',
      'sales.export',
      'members.view',
      'payouts.view',
      'payouts.process',
      'payouts.export',
      'reports.view',
      'reports.export',
      'audit.view',
      'settings.view',
    ],
  },
  {
    key: 'support',
    name: 'Support',
    description: 'Help members, record sales and manage invitations.',
    color: '#C98A2B',
    permissions: [
      'dashboard.view',
      'sales.view',
      'sales.create',
      'members.view',
      'members.manage',
      'network.view',
      'invites.create',
      'invites.revoke',
      'reports.view',
    ],
  },
  {
    key: 'analyst',
    name: 'Analyst',
    description: 'Read-only access to data and reports.',
    color: '#8A93A6',
    permissions: [...viewOnly(), 'reports.export'],
  },
];

/** Default permissions for each enum Role tier when no custom role is assigned. */
export function defaultPermissionsForTier(tier: string): string[] {
  switch (tier) {
    case 'platform_admin':
    case 'tenant_owner':
      return [...ALL_PERMISSIONS];
    case 'tenant_admin':
      return allExcept('settings.data');
    case 'tenant_staff':
      return SYSTEM_ROLES.find((r) => r.key === 'support')!.permissions;
    default:
      return []; // member: no management permissions
  }
}

/** System role definitions seeded for every tenant by RolesService.ensureSystemRoles. */
export const TIER_TO_SYSTEM_ROLE: Record<string, string> = {
  tenant_owner: 'owner',
  tenant_admin: 'admin',
  tenant_staff: 'support',
};
