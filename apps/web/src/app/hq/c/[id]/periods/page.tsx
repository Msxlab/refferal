'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { PeriodsPageContent } from '@/components/admin/PeriodsPageContent';

export default function HqCompanyPeriodsPage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('Refearn');
  useEffect(() => { api.get<{ name: string }>(`/platform/companies/${id}`).then((c) => setName(c.name)).catch(() => {}); }, [id]);
  return <PeriodsPageContent tenantName={name} />;
}
