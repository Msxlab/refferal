'use client';
import { getSession, activeMembership } from '@/lib/auth';
import { SalesPageContent } from '@/components/admin/SalesPageContent';

export default function AdminSalesPage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  return <SalesPageContent tenantName={tenantName} />;
}
