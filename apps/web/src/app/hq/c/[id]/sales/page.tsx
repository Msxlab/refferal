'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { canForTenantRoles, getSession, TENANT_ADMIN_ROLES, TENANT_STAFF_ROLES } from '@/lib/auth';
import { SalesPageContent } from '@/components/admin/SalesPageContent';

export default function HqCompanySalesPage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('Refearn');
  useEffect(() => { api.get<{ name: string }>(`/platform/companies/${id}`).then((c) => setName(c.name)).catch(() => {}); }, [id]);
  const s = getSession();
  const capabilities = {
    salesCreate: canForTenantRoles(s, 'sales.create', TENANT_STAFF_ROLES),
    salesImport: canForTenantRoles(s, 'sales.import', TENANT_STAFF_ROLES),
    salesExport: canForTenantRoles(s, 'sales.export', TENANT_STAFF_ROLES),
    salesApprove: canForTenantRoles(s, 'sales.approve', TENANT_ADMIN_ROLES),
    salesVoid: canForTenantRoles(s, 'sales.void', TENANT_ADMIN_ROLES),
  };
  return <SalesPageContent tenantName={name} capabilities={capabilities} />;
}
