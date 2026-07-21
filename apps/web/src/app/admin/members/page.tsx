'use client';
import { getSession, activeMembership, canForTenantRoles, TENANT_ADMIN_ROLES, TENANT_STAFF_ROLES } from '@/lib/auth';
import { MembersPageContent } from '@/components/admin/MembersPageContent';

export default function AdminMembersPage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  const capabilities = {
    reportsExport: canForTenantRoles(s, 'reports.export', TENANT_STAFF_ROLES),
    memberDataExport: canForTenantRoles(s, 'reports.export', TENANT_ADMIN_ROLES),
    membersSuspend: canForTenantRoles(s, 'members.suspend', TENANT_ADMIN_ROLES),
    settingsRoles: canForTenantRoles(s, 'settings.roles', TENANT_ADMIN_ROLES),
    membersManage: canForTenantRoles(s, 'members.manage', TENANT_ADMIN_ROLES),
    invitesCreate: canForTenantRoles(s, 'invites.create', TENANT_ADMIN_ROLES),
    settingsSecurity: canForTenantRoles(s, 'settings.security', TENANT_ADMIN_ROLES),
  };
  return <MembersPageContent tenantName={tenantName} capabilities={capabilities} />;
}
