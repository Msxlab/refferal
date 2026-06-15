'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { Loading, Pagination } from '@/components/ui';
import { Drawer } from '@/components/Drawer';
import { t } from '@/lib/i18n';

interface AuditItem {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorUserId: string | null;
  actorName: string;
  actorEmail: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}
interface AuditList { total: number; page: number; pageSize: number; items: AuditItem[] }

const ICON: Record<string, string> = {
  sale: '◇', payout: '◆', membership: '⬡', invite: '✦', tenant: '⚙', rbac: '⛉', role: '⛉', security: '⚠', campaign: '⚑',
};
const ENTITIES = ['sale', 'payout', 'membership', 'invite', 'campaign', 'tenant', 'role', 'security'];

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// snake_case dotted action → plain English, e.g. 'sale.create' → 'Sale created'
const VERBS: Record<string, string> = {
  create: 'created', create_manual: 'added', update: 'updated', update_profile: 'profile updated', approve: 'approved',
  reject: 'rejected', void: 'voided', delete: 'deleted', deliver: 'delivered', lock: 'locked', unlock: 'unlocked',
  finalize: 'finalized', auto_finalize: 'auto-finalized', paid: 'paid', reconcile: 'reconciled', activate: 'activated',
  deactivate: 'deactivated', set_role: 'role changed', set_leader: 'made leader', unset_leader: 'unmarked leader',
  create_version: 'version created', batch_propose: 'batch proposed',
};
function humanizeAction(a: string): string {
  const [entity, ...rest] = a.split('.');
  const key = rest.join('.');
  const verb = VERBS[key] ?? key.replace(/[._]/g, ' ');
  const ent = entity.replace(/_/g, ' ');
  return `${ent.charAt(0).toUpperCase()}${ent.slice(1)} ${verb}`.trim();
}

export default function AuditPage() {
  const [list, setList] = useState<AuditList | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditItem | null>(null);
  const [integrity, setIntegrity] = useState<{ ok: boolean; checked: number; brokenAt: string | null } | null>(null);
  const [verifying, setVerifying] = useState(false);

  async function verifyIntegrity() {
    setVerifying(true);
    try { setIntegrity(await api.post('/admin/audit/verify')); }
    catch (e) { setError(String((e as ApiError).message)); } finally { setVerifying(false); }
  }

  const filterQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (entity) p.set('entity', entity);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p.toString();
  }, [q, entity, from, to]);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams(filterQuery);
      p.set('page', String(page)); p.set('pageSize', '50');
      setList(await api.get<AuditList>(`/admin/audit?${p.toString()}`));
      setError(''); // basarida onceki hatayi temizle (kurtarma)
    } catch (e) { setError(String((e as ApiError).message)); }
  }, [filterQuery, page]);

  useEffect(() => { const id = setTimeout(() => void load(), 250); return () => clearTimeout(id); }, [load]);

  async function exportCsv() {
    try { await downloadCsv(`/admin/audit/export.csv${filterQuery ? `?${filterQuery}` : ''}`, 'audit.csv'); }
    catch (e) { setError(String((e as ApiError).message)); }
  }

  // Fatal yalniz ilk yukleme basarisizsa (tekrar-dene ile); aksi halde inline banner (sayfa korunur).
  if (error && !list) return <div className="error" style={{ margin: 24 }}>{error} <button className="btn ghost sm" onClick={() => void load()} style={{ marginLeft: 8 }}>Retry</button></div>;
  const items = list?.items ?? [];

  return (
    <div>
      <div className="spread">
        <div>
          <div className="eyebrow fade-in">{t('nav.audit')}</div>
          <h1 className="h1 fade-in">Audit Log</h1>
          <p className="sub fade-in">Every action affecting money, roles, and plans is recorded here.</p>
        </div>
        <div className="row fade-in no-print" style={{ gap: 8 }}>
          {integrity && (
            <span className={`badge ${integrity.ok ? 'active' : 'failed'}`} title={integrity.brokenAt ? `Broken at ${integrity.brokenAt}` : undefined}>
              {integrity.ok ? `✓ Chain intact (${integrity.checked})` : '✗ Chain tampered'}
            </span>
          )}
          <button className="btn ghost" onClick={verifyIntegrity} disabled={verifying}>{verifying ? 'Verifying…' : '🔒 Verify integrity'}</button>
          <button className="btn ghost" onClick={exportCsv}>⇩ Export CSV</button>
        </div>
      </div>

      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

      <div className="row fade-in delay-1 no-print" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '14px 0' }}>
        <input placeholder="🔍  Search action or entity…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} style={{ flex: 1, minWidth: 180, maxWidth: 280 }} />
        <select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} style={{ width: 'auto' }} aria-label="Entity">
          <option value="">All entities</option>
          {ENTITIES.map((e) => <option key={e} value={e}>{ICON[e] ?? '•'} {e}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From" style={{ width: 'auto' }} />
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To" style={{ width: 'auto' }} />
        <span style={{ flex: 1 }} />
        <span className="faint" style={{ fontSize: 12 }}>{list ? `${list.total} events` : ''}</span>
      </div>

      <div className="card fade-in delay-2" style={{ padding: 0, overflow: 'hidden' }}>
        {!list ? <div style={{ padding: 16 }}><Loading rows={6} /></div> : items.length === 0 ? (
          <div className="muted" style={{ padding: 18 }}>No matching events.</div>
        ) : (
          <div>
            {items.map((a) => (
              <button key={a.id} onClick={() => setDetail(a)} className="row inbox-row" style={{ alignItems: 'flex-start' }}>
                <span style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: a.entity === 'security' ? 'color-mix(in srgb, var(--rose) 16%, transparent)' : 'rgba(255,255,255,.05)', fontSize: 15, flexShrink: 0 }}>
                  {ICON[a.entity] ?? '•'}
                </span>
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }} title={a.action}>{humanizeAction(a.action)}</span>
                  <span className="faint" style={{ fontSize: 11.5, display: 'block', marginTop: 2 }}>
                    {a.actorUserId ? a.actorName : '⚙ system'}{a.actorEmail ? ` · ${a.actorEmail}` : ''}
                  </span>
                </span>
                <span className="faint" style={{ fontSize: 11.5, whiteSpace: 'nowrap', flexShrink: 0 }}>{when(a.createdAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {list && <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={setPage} />}

      {detail && (
        <Drawer title={humanizeAction(detail.action)} subtitle={`${detail.entity}${detail.entityId ? ` · ${detail.entityId.slice(0, 8)}` : ''}`} onClose={() => setDetail(null)} width={520}>
          <div className="grid" style={{ gap: 16 }}>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="When" value={when(detail.createdAt)} />
              <Field label="Entity" value={detail.entity} />
              <Field label="Actor" value={detail.actorUserId ? detail.actorName : 'system'} />
              <Field label="Actor email" value={detail.actorEmail ?? '—'} />
              <Field label="IP" value={detail.ip ?? '—'} />
              <Field label="Entity ID" value={detail.entityId ?? '—'} />
            </div>
            <FieldDiff before={detail.before} after={detail.after} />
            <details>
              <summary className="faint" style={{ fontSize: 12, cursor: 'pointer' }}>Raw JSON</summary>
              <div style={{ marginTop: 8 }}>
                <Diff label="Before" data={detail.before} />
                <Diff label="After" data={detail.after} />
              </div>
            </details>
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
      <div style={{ fontSize: 13.5, marginTop: 2, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}

/** Alan-bazli once/sonra diff (#13): degisen alanlar vurgulu. */
function FieldDiff({ before, after }: { before: unknown; after: unknown }) {
  const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  const fmt = (v: unknown) => v === undefined ? '—' : v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (keys.length === 0) return <div className="muted" style={{ fontSize: 13 }}>No field-level detail.</div>;
  return (
    <table>
      <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
      <tbody>
        {keys.map((k) => {
          const changed = JSON.stringify(b[k]) !== JSON.stringify(a[k]);
          return (
            <tr key={k} style={{ background: changed ? 'color-mix(in srgb, var(--amber) 9%, transparent)' : undefined }}>
              <td className="faint" style={{ fontSize: 12 }}>{k}</td>
              <td className="tnum" style={{ fontSize: 12, color: changed ? 'var(--rose)' : 'var(--muted)' }}>{fmt(b[k])}</td>
              <td className="tnum" style={{ fontSize: 12, color: changed ? 'var(--emerald)' : 'var(--muted)' }}>{fmt(a[k])}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
