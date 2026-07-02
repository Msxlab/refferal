'use client';
import { getSession, activeMembership } from '@/lib/auth';
import { TreePageContent } from '@/components/admin/TreePageContent';

export default function AdminTreePage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  return <TreePageContent tenantName={tenantName} />;
}
