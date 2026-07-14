'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Loading } from '@/components/ui';
import { NetworkExplorer, type ApiNode } from '@/components/NetworkExplorer';
import { t } from '@/lib/i18n';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function NetworkPage() {
  const [nodes, setNodes] = useState<ApiNode[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<ApiNode[]>('/admin/members/tree').then(setNodes).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  if (error) {
    return (
      <Alert variant="destructive" className="fade-in">
        <AlertCircle />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.tree')}</div>
      <h1 className="h1 fade-in">Referral network</h1>
      <p className="sub fade-in mb-4">
        Switch between tree and list, click anyone to drill into their downline.
      </p>
      {!nodes ? <Loading rows={5} /> : <NetworkExplorer nodes={nodes} title="your company" />}
    </div>
  );
}
