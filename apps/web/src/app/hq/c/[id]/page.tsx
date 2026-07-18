'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { AdminOverviewContent } from '@/components/admin/AdminOverviewContent';

export default function HqCompanyOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('Refearn');
  useEffect(() => { api.get<{ name: string }>(`/platform/companies/${id}`).then((c) => setName(c.name)).catch(() => {}); }, [id]);
  return <AdminOverviewContent tenantName={name} basePath={`/hq/c/${id}`} />;
}
