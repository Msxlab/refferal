'use client';
import { getSession, activeMembership, isAdminRole } from '@/lib/auth';
import { CampaignsPageContent } from '@/components/admin/CampaignsPageContent';

export default function AdminCampaignsPage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  const meIsAdmin = s ? isAdminRole(activeMembership(s)?.role) : false;
  return <CampaignsPageContent tenantName={tenantName} meIsAdmin={meIsAdmin} />;
}
