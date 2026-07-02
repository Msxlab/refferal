'use client';
import { getSession, activeMembership } from '@/lib/auth';
import { AdminOverviewContent } from '@/components/admin/AdminOverviewContent';

export default function AdminDashboardPage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  return <AdminOverviewContent tenantName={tenantName} />;
}
