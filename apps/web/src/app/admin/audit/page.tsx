'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading } from '@/components/ui';
import { Popover } from '@/components/Popover';
import { Drawer } from '@/components/Drawer';
import { t } from '@/lib/i18n';

interface AuditItem {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorUserId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}
interface AuditList { total: number; items: AuditItem[] }

const ICON: Record<string, string> = {
  sale: '◇', payout: '◆', membership: '⬡', invite: '✦', tenant: '⚙', rbac: '⛉', role: '⛉', security: '⚠',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AuditPage() {
  const [list, setList] = useState<AuditList | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [entities, setEntities] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<AuditItem | null>(null);

  useEffect(() => {
    api.get<AuditList>('/admin/audit?pageSize=120').then(setList).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  const allEntities = useMemo(() => Array.from(new Set((list?.items ?? []).map((a) => a.entity))).sort(), [list]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (list?.items ?? []).filter((a) => {
      if (entities.size > 0 && !entities.has(a.entity)) return false;
      if (!term) return true;
      return a.action.toLowerCase().includes(term) || a.entity.toLowerCase().includes(term) || JSON.stringify(a.after ?? '').toLowerCase().includes(term);
    });
  }, [list, q, entities]);

  if (error) return <div className="error">{error}</div>;

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.audit')}</div>
      <h1 className="h1 fade-in">Audit Log</h1>
      <p className="sub fade-in">Every action affecting money, roles, and plans is recorded here.</p>

      <div className="row fade-in delay-1" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '14px 0' }}>
        <input placeholder="🔍  Search action, entity or data…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200, maxWidth: 360 }} />
        <Popover label={<>Entity</>} badge={entities.size} width={220}>
          <div className="grid" style={{ gap: 6 }}>
            {allEntities.length === 0 && <span className="faint" style={{ fontSize: 12 }}>none</span>}
            {allEntities.map((e) => {
              const on = entities.has(e);
              return (
                <label key={e} onClick={(ev) => { ev.preventDefault(); setEntities((p) => { const n = new Set(p); n.has(e) ? n.delete(e) : n.add(e); return n; }); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: on ? 'var(--gold-soft, rgba(212,175,55,.1))' : 'var(--panel-2)', border: `1px solid ${on ? 'var(--gold-500)' : 'var(--border)'}` }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: on ? 'var(--gold-500)' : 'transparent', border: on ? 'none' : '1.5px solid var(--border-strong)', color: 'var(--on-gold)', fontSize: 10, fontWeight: 900, display: 'grid', placeItems: 'center' }}>{on ? '✓' : ''}</span>
                  {ICON[e] ?? '•'} {e}
                </label>
              );
            })}
          </div>
        </Popover>
        <span style={{ flex: 1 }} />
        <span className="faint" style={{ fontSize: 12 }}>{filtered.length} {filtered.length === 1 ? 'event' : 'events'}</span>
      </div>

      <div className="card fade-in delay-2" style={{ padding: 0, overflow: 'hidden' }}>
        {!list ? <div style={{ padding: 16 }}><Loading rows={6} /></div> : filtered.length === 0 ? (
          <div className="muted" style={{ padding: 18 }}>No matching events.</div>
        ) : (
          <div>
            {filtered.map((a) => (
              <button key={a.id} onClick={() => setDetail(a)} className="row inbox-row" style={{ alignItems: 'flex-start' }}>
                <span style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: a.entity === 'security' ? 'color-mix(in srgb, var(--rose) 16%, transparent)' : 'rgba(255,255,255,.05)', fontSize: 15, flexShrink: 0 }}>
                  {ICON[a.entity] ?? '•'}
                </span>
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{a.action}</span>
                  <span className="faint" style={{ fontSize: 11.5, fontFamily: 'ui-monospace, monospace', display: 'block', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.after ? JSON.stringify(a.after) : '—'}
                  </span>
                </span>
                <span className="faint" style={{ fontSize: 11.5, whiteSpace: 'nowrap', flexShrink: 0 }}>{when(a.createdAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {detail && (
        <Drawer title={detail.action} subtitle={`${detail.entity}${detail.entityId ? ` · ${detail.entityId.slice(0, 8)}` : ''}`} onClose={() => setDetail(null)} width={520}>
          <div className="grid" style={{ gap: 16 }}>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="When" value={when(detail.createdAt)} />
              <Field label="Entity" value={detail.entity} />
              <Field label="Actor" value={detail.actorUserId ? detail.actorUserId.slice(0, 8) : 'system'} />
              <Field label="IP" value={detail.ip ?? '—'} />
            </div>
            <Diff label="Before" data={detail.before} />
            <Diff label="After" data={detail.after} />
          </div>
        </Drawer>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 13.5, marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>{value}</div>
    </div>
  );
}

function Diff({ label, data }: { label: string; data: unknown }) {
  const empty = data === null || data === undefined || (typeof data === 'object' && Object.keys(data as object).length === 0);
  return (
    <div>
      <div className="faint" style={{ fontSize: 11, marginBottom: 6 }}>{label}</div>
      {empty ? (
        <div className="muted" style={{ fontSize: 12 }}>—</div>
      ) : (
        <pre style={{ margin: 0, padding: 12, borderRadius: 10, background: 'var(--panel-2)', border: '1px solid var(--border)', fontSize: 12, fontFamily: 'ui-monospace, monospace', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
