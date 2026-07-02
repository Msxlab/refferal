'use client';
import { getSession, activeMembership } from '@/lib/auth';
import { ChecksPageContent } from '@/components/admin/ChecksPageContent';

export default function AdminChecksPage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  return <ChecksPageContent tenantName={tenantName} />;
}
