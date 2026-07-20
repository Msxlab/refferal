'use client';
import { Suspense } from 'react';
import { getSession, activeMembership, can } from '@/lib/auth';
import { ReferralValueFlowContent } from '@/components/admin/value-flow/ReferralValueFlowContent';
import { ValueFlowSkeleton } from '@/components/admin/value-flow/ValueFlowSkeleton';

export default function AdminTreePage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  const capabilities = {
    dashboard: can(s, 'dashboard.view'),
    network: can(s, 'network.view'),
    memberDetails: can(s, 'members.view'),
    plans: can(s, 'settings.plan'),
    recentSales: can(s, 'sales.view'),
  };
  return (
    <Suspense fallback={<ValueFlowSkeleton />}>
      <ReferralValueFlowContent tenantName={tenantName} capabilities={capabilities} />
    </Suspense>
  );
}
