'use client';
import { activeMembership, canForTenantRoles, getSession, TENANT_ADMIN_ROLES } from '@/lib/auth';
import { PayoutsPageContent } from '@/components/admin/PayoutsPageContent';

export default function AdminPayoutsPage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  const capabilities = {
    payoutsView: canForTenantRoles(s, 'payouts.view', TENANT_ADMIN_ROLES),
    payoutsProcess: canForTenantRoles(s, 'payouts.process', TENANT_ADMIN_ROLES),
    payoutsExport: canForTenantRoles(s, 'payouts.export', TENANT_ADMIN_ROLES),
    complianceView: canForTenantRoles(s, 'compliance.view', TENANT_ADMIN_ROLES),
    complianceReview: canForTenantRoles(s, 'compliance.review', TENANT_ADMIN_ROLES),
    reportsView: canForTenantRoles(s, 'reports.view', TENANT_ADMIN_ROLES),
    reportsExport: canForTenantRoles(s, 'reports.export', TENANT_ADMIN_ROLES),
  };
  return <PayoutsPageContent tenantName={tenantName} capabilities={capabilities} />;
}
