'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { canForTenantRoles, getSession, TENANT_ADMIN_ROLES, TENANT_STAFF_ROLES } from '@/lib/auth';
import { MembersPageContent } from '@/components/admin/MembersPageContent';

export default function HqCompanyMembersPage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('Refearn');
  useEffect(() => { api.get<{ name: string }>(`/platform/companies/${id}`).then((c) => setName(c.name)).catch(() => {}); }, [id]);
  const s = getSession();
  const capabilities = {
    reportsExport: canForTenantRoles(s, 'reports.export', TENANT_STAFF_ROLES),
    memberDataExport: canForTenantRoles(s, 'reports.export', TENANT_ADMIN_ROLES),
    membersSuspend: canForTenantRoles(s, 'members.suspend', TENANT_ADMIN_ROLES),
    settingsRoles: canForTenantRoles(s, 'settings.roles', TENANT_ADMIN_ROLES),
    membersManage: canForTenantRoles(s, 'members.manage', TENANT_ADMIN_ROLES),
    invitesCreate: canForTenantRoles(s, 'invites.create', TENANT_ADMIN_ROLES),
    settingsSecurity: canForTenantRoles(s, 'settings.security', TENANT_ADMIN_ROLES),
  };
  return <MembersPageContent tenantName={name} capabilities={capabilities} />;
}
