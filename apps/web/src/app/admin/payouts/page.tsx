'use client';
import { getSession, activeMembership } from '@/lib/auth';
import { PayoutsPageContent } from '@/components/admin/PayoutsPageContent';

export default function AdminPayoutsPage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  return <PayoutsPageContent tenantName={tenantName} />;
}
