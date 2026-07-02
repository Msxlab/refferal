'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { ChecksPageContent } from '@/components/admin/ChecksPageContent';

export default function HqCompanyChecksPage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('Refearn');
  useEffect(() => { api.get<{ name: string }>(`/platform/companies/${id}`).then((c) => setName(c.name)).catch(() => {}); }, [id]);
  return <ChecksPageContent tenantName={name} />;
}
