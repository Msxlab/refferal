'use client';
import { getSession, activeMembership, isAdminRole } from '@/lib/auth';
import { MembersPageContent } from '@/components/admin/MembersPageContent';

export default function AdminMembersPage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  const meIsAdmin = s ? isAdminRole(activeMembership(s)?.role) : false;
  return <MembersPageContent tenantName={tenantName} meIsAdmin={meIsAdmin} />;
}
