'use client';
import { getSession, activeMembership } from '@/lib/auth';
import { SettingsPageContent } from '@/components/admin/SettingsPageContent';

export default function SettingsPage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  return <SettingsPageContent tenantName={tenantName} />;
}
