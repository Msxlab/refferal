'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, Modal, Pagination } from '@/components/ui';
import { dateShort } from '@/lib/format';

interface AuditItem {
  seq: string;
  tenantId: string | null;
  tenantName: string | null;
  action: string;
  entity: string;
  actorName: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}
interface AuditPage { total: number; page: number; pageSize: number; items: AuditItem[] }

// snake_case dotted action -> plain English (mirrors admin/audit/page.tsx and companies/[id]/page.tsx)
const VERBS: Record<string, string> = {
  create: 'created', create_manual: 'added', update: 'updated', update_profile: 'profile updated', approve: 'approved',
  reject: 'rejected', void: 'voided', delete: 'deleted', deliver: 'delivered', lock: 'locked', unlock: 'unlocked',
  finalize: 'finalized', auto_finalize: 'auto-finalized', paid: 'paid', activate: 'activated', deactivate: 'deactivated',
  tenant_active: 'activated', tenant_suspended: 'suspended', tenant_setup_needed: 'moved to setup needed',
  set_role: 'role changed', set_leader: 'made leader', unset_leader: 'unmarked leader',
  admin_granted: 'admin granted', admin_revoked: 'admin revoked', package_created: 'package created',
  package_updated: 'package updated', package_deactivated: 'package deactivated',
  platform_impersonate_start: 'impersonation started', platform_impersonate_end: 'impersonation ended',
  tenant_branding: 'branding updated',
};
function humanizeAction(a: string): string {
  const [entity, ...rest] = a.split('.');
  const key = rest.join('.');
  const verb = VERBS[key] ?? key.replace(/[._]/g, ' ');
  const ent = entity.replace(/_/g, ' ');
  return `${ent.charAt(0).toUpperCase()}${ent.slice(1)} ${verb}`.trim();
}

/** Item 6: global (capraz-kiraci) audit akisi. */
export default function GlobalAuditPage() {
  const [data, setData] = useState<AuditPage | null>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<AuditItem | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page) });
    if (action) p.set('action', action);
    api.get<AuditPage>(`/platform/audit?${p.toString()}`).then(setData).catch((e) => setError(String((e as ApiError).message)));
  }, [page, action]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [action]);

  if (error && !data) return <div className="error">{error}</div>;
  const items = data?.items ?? [];

  return (
    <div>
      <div className="eyebrow fade-in">Platform</div>
      <h1 className="h1 fade-in">Audit</h1>
      <p className="sub fade-in" style={{ marginBottom: 16 }}>Every action across every company, in one feed.</p>

      <div className="row fade-in delay-1" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select aria-label="Filter by action" value={action} onChange={(e) => setAction(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="">All actions</option>
          <option value="tenant.create">Company created</option>
          <option value="platform.tenant_active">Company activated</option>
          <option value="platform.tenant_suspended">Company suspended</option>
          <option value="platform.tenant_branding">Branding updated</option>
          <option value="billing.invoice_paid">Invoice paid</option>
          <option value="billing.invoice_issued">Invoice issued</option>
          <option value="billing.invoice_void">Invoice voided</option>
          <option value="platform.admin_granted">Admin granted</option>
          <option value="platform.admin_revoked">Admin revoked</option>
          <option value="platform.package_created">Package created</option>
          <option value="platform.package_updated">Package updated</option>
          <option value="platform.package_deactivated">Package deactivated</option>
          <option value="security.platform_impersonate_start">Impersonation started</option>
          <option value="security.platform_impersonate_end">Impersonation ended</option>
        </select>
        <span style={{ flex: 1 }} />
        <span className="faint" style={{ fontSize: 12 }}>{data ? `${data.total} events` : ''}</span>
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      {!data ? (
        <Loading rows={6} />
      ) : (
        <div className="card fade-in delay-2" style={{ padding: 0, overflowX: 'auto' }}>
          <table aria-label="Global audit log">
            <thead>
              <tr>
                <th>Action</th>
                <th>Company</th>
                <th>Actor</th>
                <th>When</th>
                <th>Diff</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.seq}>
                  <td title={a.action}>{humanizeAction(a.action)}</td>
                  <td className="faint">{a.tenantName ?? '—'}</td>
                  <td className="faint">{a.actorName}</td>
                  <td className="muted">{dateShort(a.createdAt)}</td>
                  <td><button className="btn ghost sm" onClick={() => setDetail(a)}>View</button></td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={5} className="muted">No matching events.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}

      {detail && (
        <Modal title={humanizeAction(detail.action)} onClose={() => setDetail(null)}>
          <div style={{ width: 'min(520px, 100%)' }}>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <Field label="When" value={dateShort(detail.createdAt)} />
              <Field label="Company" value={detail.tenantName ?? '—'} />
              <Field label="Entity" value={detail.entity} />
              <Field label="Actor" value={detail.actorName} />
            </div>
            <AuditDiff before={detail.before} after={detail.after} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 13.5, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function AuditDiff({ before, after }: { before: unknown; after: unknown }) {
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
