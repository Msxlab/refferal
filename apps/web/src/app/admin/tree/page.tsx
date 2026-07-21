'use client';
import { Suspense } from 'react';
import { getSession, activeMembership, can } from '@/lib/auth';
import { AdminNetworkHierarchyContent, type AdminValueFlowCapabilities } from '@/components/admin/network-hierarchy/AdminNetworkHierarchyContent';

export default function AdminTreePage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  const valueFlowCapabilities: AdminValueFlowCapabilities = {
    dashboard: can(s, 'dashboard.view'),
    network: can(s, 'network.view'),
    memberDetails: can(s, 'members.view'),
    plans: can(s, 'settings.plan'),
    recentSales: can(s, 'sales.view'),
    financials: can(s, 'network.financials.view'),
  };
  return (
    <Suspense fallback={<div className="card" aria-busy="true">Preparing the network hierarchy…</div>}>
      <AdminNetworkHierarchyContent tenantName={tenantName} valueFlowCapabilities={valueFlowCapabilities} />
    </Suspense>
  );
}
