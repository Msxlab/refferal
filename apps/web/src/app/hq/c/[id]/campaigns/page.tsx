'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { CampaignsPageContent } from '@/components/admin/CampaignsPageContent';

export default function HqCompanyCampaignsPage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('Refearn');
  useEffect(() => { api.get<{ name: string }>(`/platform/companies/${id}`).then((c) => setName(c.name)).catch(() => {}); }, [id]);
  return <CampaignsPageContent tenantName={name} meIsAdmin={true} />;
}
