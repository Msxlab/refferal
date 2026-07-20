'use client';
import { canForTenantRoles, getSession, activeMembership, TENANT_ADMIN_ROLES, TENANT_STAFF_ROLES } from '@/lib/auth';
import { SalesPageContent } from '@/components/admin/SalesPageContent';

export default function AdminSalesPage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  const capabilities = {
    salesCreate: canForTenantRoles(s, 'sales.create', TENANT_STAFF_ROLES),
    salesImport: canForTenantRoles(s, 'sales.import', TENANT_STAFF_ROLES),
    salesExport: canForTenantRoles(s, 'sales.export', TENANT_STAFF_ROLES),
    salesApprove: canForTenantRoles(s, 'sales.approve', TENANT_ADMIN_ROLES),
    salesVoid: canForTenantRoles(s, 'sales.void', TENANT_ADMIN_ROLES),
  };
  return <SalesPageContent tenantName={tenantName} capabilities={capabilities} />;
}
