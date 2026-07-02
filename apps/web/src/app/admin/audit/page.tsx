'use client';
import { getSession, activeMembership } from '@/lib/auth';
import { AuditPageContent } from '@/components/admin/AuditPageContent';

export default function AdminAuditPage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  return <AuditPageContent tenantName={tenantName} />;
}
