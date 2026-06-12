'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading } from '@/components/ui';
import { t } from '@/lib/i18n';

interface AuditItem {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorUserId: string | null;
  after: unknown;
  createdAt: string;
}
interface AuditList { total: number; items: AuditItem[] }

const ICON: Record<string, string> = {
  sale: '◇', payout: '◆', membership: '⬡', invite: '✦', tenant: '⚙',
};

export default function AuditPage() {
  const [list, setList] = useState<AuditList | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<AuditList>('/admin/audit?pageSize=80').then(setList).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  if (error) return <div className="error">{error}</div>;

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.audit')}</div>
      <h1 className="h1 fade-in">Audit Log</h1>
      <p className="sub fade-in">Every action affecting money, roles, and plans is recorded here.</p>

      <div className="card fade-in delay-1">
        {!list ? <Loading rows={6} /> : list.items.length === 0 ? (
          <div className="muted">No records yet.</div>
        ) : (
          <div className="grid" style={{ gap: 0 }}>
            {list.items.map((a) => (
              <div key={a.id} className="row" style={{ padding: '12px 6px', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
                <span style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.05)', fontSize: 15 }}>
                  {ICON[a.entity] ?? '•'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{a.action}</div>
                  <div className="faint" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                    {a.after ? JSON.stringify(a.after) : '—'}
                  </div>
                </div>
                <span className="faint" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {new Date(a.createdAt).toLocaleString('tr-TR')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
