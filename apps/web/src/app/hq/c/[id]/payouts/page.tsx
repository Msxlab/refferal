'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { canForTenantRoles, getSession, TENANT_ADMIN_ROLES } from '@/lib/auth';
import { PayoutsPageContent } from '@/components/admin/PayoutsPageContent';

export default function HqCompanyPayoutsPage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('Refearn');
  useEffect(() => { api.get<{ name: string }>(`/platform/companies/${id}`).then((c) => setName(c.name)).catch(() => {}); }, [id]);
  const s = getSession();
  const capabilities = {
    payoutsView: canForTenantRoles(s, 'payouts.view', TENANT_ADMIN_ROLES),
    payoutsProcess: canForTenantRoles(s, 'payouts.process', TENANT_ADMIN_ROLES),
    payoutsExport: canForTenantRoles(s, 'payouts.export', TENANT_ADMIN_ROLES),
    complianceView: canForTenantRoles(s, 'compliance.view', TENANT_ADMIN_ROLES),
    complianceReview: canForTenantRoles(s, 'compliance.review', TENANT_ADMIN_ROLES),
    reportsView: canForTenantRoles(s, 'reports.view', TENANT_ADMIN_ROLES),
    reportsExport: canForTenantRoles(s, 'reports.export', TENANT_ADMIN_ROLES),
  };
  return <PayoutsPageContent tenantName={name} capabilities={capabilities} />;
}
