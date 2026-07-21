'use client';

import { AdminNetworkHierarchyContent, type AdminValueFlowCapabilities } from '@/components/admin/network-hierarchy/AdminNetworkHierarchyContent';
import { can, getSession } from '@/lib/auth';

function valueFlowCapabilities(): AdminValueFlowCapabilities {
  const session = getSession();
  return {
    dashboard: can(session, 'dashboard.view'),
    network: can(session, 'network.view'),
    memberDetails: can(session, 'members.view'),
    plans: can(session, 'settings.plan'),
    recentSales: can(session, 'sales.view'),
    financials: can(session, 'network.financials.view'),
  };
}

/**
 * HQ uses the same hierarchy cockpit as the tenant admin route. `can` reads
 * the active-company token, so calls made by this adapter remain company scoped.
 */
export function TreePageContent({
  tenantName,
  routeBase = '/admin/tree',
  memberRouteBase = '/admin/members',
  companyRouteBase,
}: {
  tenantName: string;
  routeBase?: string;
  memberRouteBase?: string;
  companyRouteBase?: string;
}) {
  return (
    <AdminNetworkHierarchyContent
      tenantName={tenantName}
      valueFlowCapabilities={valueFlowCapabilities()}
      routeBase={routeBase}
      memberRouteBase={memberRouteBase}
      companyRouteBase={companyRouteBase}
    />
  );
}
