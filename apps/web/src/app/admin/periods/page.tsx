'use client';
import { getSession, activeMembership } from '@/lib/auth';
import { PeriodsPageContent } from '@/components/admin/PeriodsPageContent';

export default function AdminPeriodsPage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  return <PeriodsPageContent tenantName={tenantName} />;
}
