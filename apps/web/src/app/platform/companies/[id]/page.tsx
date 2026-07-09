'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { getSession, startImpersonation } from '@/lib/auth';
import { Confirm, Loading, Modal, Pagination, SortableTh, useToast, type SortDir } from '@/components/ui';
import { NetworkExplorer, type ApiNode } from '@/components/NetworkExplorer';
import { StatusBadge } from '@/components/platform/statusBadge';
import { Tabs, type TabDef } from '@/components/platform/Tabs';
import { bps, money, dateShort } from '@/lib/format';

interface Company {
  id: string; slug: string; name: string; currency: string; timezone: string; status: string;
  payoutMinCents: string; maturationRule: string; createdAt: string;
  kpis: { members: number; activeMembers: number; revenueThisMonthCents: string; salesThisMonth: number; outstandingPayableCents: string };
  plan: { name: string; poolRateBps: number; depth: number } | null;
  setup: { hasPlan: boolean; hasBranding: boolean; hasOwnerAccepted: boolean; memberCount: number };
}

interface Invoice { id: string; period: string; amountCents: string; currency: string; status: 'open' | 'paid' | 'void'; issuedAt: string; dueAt: string | null; paidAt: string | null; paidNote: string | null }
interface Billing { tenant: { id: string; name: string; currency: string }; config: { monthlyFeeCents: string; currency: string; active: boolean; notes: string | null } | null; outstandingCents: string; invoices: Invoice[] }

interface MemberRow { id: string; fullName: string; email: string; referralCode: string; role: string; status: string; depth: number; joinedAt: string }
interface MemberList { total: number; page: number; pageSize: number; rows: MemberRow[] }

interface PayoutRow { id: string; memberName: string; referralCode: string; totalCents: string; method: string; status: string; period: string; createdAt: string; paidAt: string | null }
interface PayoutList { total: number; page: number; pageSize: number; rows: PayoutRow[] }

interface AuditItem {
  seq: string; tenantId: string | null; action: string; entity: string; entityId: string | null;
  actorUserId: string | null; actorName: string; actorEmail: string | null;
  before: unknown; after: unknown; createdAt: string;
}
interface AuditList { total: number; page: number; pageSize: number; items: AuditItem[] }

interface ImpersonateResponse { accessToken: string; membershipId: string }

interface HealthJob { name: string; at: string; ok: boolean; detail?: string; stale: boolean }
interface Health { db: boolean; jobs: HealthJob[]; backups: { lastBackupAt: string | null } }

interface BillingPackage { id: string; key: string; name: string; monthlyFeeCents: string; features: unknown; limits: unknown; active: boolean }

const INV_BADGE: Record<string, string> = { open: 'pending', paid: 'active', void: 'inactive' };

const TABS: TabDef[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'plans', label: 'Plans' },
  { key: 'payouts', label: 'Payouts' },
  { key: 'audit', label: 'Audit' },
  { key: 'health', label: 'Health' },
  { key: 'settings', label: 'Settings' },
];

// snake_case dotted action -> plain English (mirrors apps/web/src/app/admin/audit/page.tsx)
const VERBS: Record<string, string> = {
  create: 'created', create_manual: 'added', update: 'updated', update_profile: 'profile updated', approve: 'approved',
  reject: 'rejected', void: 'voided', delete: 'deleted', deliver: 'delivered', lock: 'locked', unlock: 'unlocked',
  finalize: 'finalized', auto_finalize: 'auto-finalized', paid: 'paid', activate: 'activated', deactivate: 'deactivated',
  tenant_active: 'activated', tenant_suspended: 'suspended', tenant_setup_needed: 'moved to setup needed',
  set_role: 'role changed', set_leader: 'made leader', unset_leader: 'unmarked leader',
};
function humanizeAction(a: string): string {
  const [entity, ...rest] = a.split('.');
  const key = rest.join('.');
  const verb = VERBS[key] ?? key.replace(/[._]/g, ' ');
  const ent = entity.replace(/_/g, ' ');
  return `${ent.charAt(0).toUpperCase()}${ent.slice(1)} ${verb}`.trim();
}

export default function CompanyPage() {
  return (
    <Suspense fallback={<Loading rows={4} />}>
      <CompanyPageInner />
    </Suspense>
  );
}

function CompanyPageInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get('tab') || 'overview');

  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

  // platform -> isyeri kopru (prod); "Open company admin" (impersonation wiring: Task 16)
  const [entering, setEntering] = useState(false);
  const [enterMsg, setEnterMsg] = useState('');

  const [busy, setBusy] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [activateBlockedMsg, setActivateBlockedMsg] = useState('');

  function changeTab(key: string) {
    setTab(key);
    router.replace(`?tab=${key}`, { scroll: false });
  }

  function loadCompany() {
    api.get<Company>(`/platform/companies/${id}`).then(setCompany).catch((e) => setError(String((e as ApiError).message)));
  }

  useEffect(() => {
    if (!id) return;
    loadCompany();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** Platform -> bu sirketin isyerine salt-okunur gir (impersonation, item 4): owner uyeligine scoped, imp claim'li token. */
  async function openCompanyAdmin() {
    if (!company) return;
    setEntering(true); setEnterMsg('');
    try {
      const res = await api.post<ImpersonateResponse>(`/platform/companies/${company.id}/impersonate`);
      const session = getSession();
      if (!session) { router.replace('/login'); return; }
      // build an impersonation session: platform session backed up, token scoped read-only to owner
      const impSession = { ...session, accessToken: res.accessToken, activeMembershipId: res.membershipId };
      startImpersonation(impSession);
      window.sessionStorage.setItem('refearn.platform.returnPath', `/platform/companies/${company.id}`);
      window.sessionStorage.setItem('refearn.platform.viewingTenant', company.name);
      router.push('/admin');
    } catch (e) {
      setEntering(false);
      setEnterMsg(String((e as ApiError).message));
    }
  }

  async function toggleStatus() {
    if (!company) return;
    setBusy(true);
    const next = company.status === 'active' ? 'suspended' : 'active';
    try { await api.patch(`/platform/companies/${id}/status`, { status: next }); loadCompany(); showToast(next === 'suspended' ? 'Company suspended' : 'Company reactivated'); }
    catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); setConfirmStatus(false); }
  }

  function requestActivate() {
    if (!company) return;
    if (!company.setup.hasPlan) {
      setActivateBlockedMsg('This company has no commission plan yet — assign a plan before activating.');
      return;
    }
    setActivateBlockedMsg('');
    setConfirmStatus(true);
  }

  if (error) return <div className="error">{error}</div>;
  if (!company) return <Loading rows={4} />;

  const c = company.currency;
  return (
    <div>
      <div className="row fade-in" style={{ gap: 8, marginBottom: 6 }}>
        <Link href="/platform" className="faint" style={{ fontSize: 12, textDecoration: 'none' }}>← Companies</Link>
      </div>
      <div className="spread fade-in" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 13 }}>
          <span style={{ width: 46, height: 46, borderRadius: 13, display: 'grid', placeItems: 'center', background: 'var(--foil)', color: 'var(--on-gold)', fontWeight: 800, fontSize: 20, fontFamily: 'var(--font-display)' }}>
            {company.name.charAt(0).toUpperCase()}
          </span>
          <div>
            <h1 className="h1" style={{ margin: 0 }}>{company.name}</h1>
            <div className="faint" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{company.slug} · {company.timezone}</div>
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <StatusBadge status={company.status} />
          <button className="btn sm" onClick={openCompanyAdmin} disabled={entering}>
            {entering ? 'Opening…' : 'Open company admin'}
          </button>
          <button className={`btn ${company.status === 'active' ? 'ghost danger' : 'ghost'} sm`} onClick={() => (company.status === 'active' ? setConfirmStatus(true) : requestActivate())} disabled={busy}>
            {company.status === 'active' ? 'Suspend' : 'Reactivate'}
          </button>
        </div>
      </div>
      {enterMsg && <div className="error" style={{ marginTop: 10 }}>{enterMsg}</div>}

      <div className="fade-in delay-1" style={{ margin: '18px 0' }}>
        <Tabs tabs={TABS} active={tab} onChange={changeTab} />
      </div>

      {tab === 'overview' && (
        <OverviewTab
          company={company}
          activateBlockedMsg={activateBlockedMsg}
          onActivateClick={requestActivate}
        />
      )}
      {tab === 'users' && <UsersTab tenantId={id} tenantName={company.name} />}
      {tab === 'plans' && <PlansTab company={company} />}
      {tab === 'payouts' && <PayoutsTab tenantId={id} currency={c} />}
      {tab === 'audit' && <AuditTab tenantId={id} />}
      {tab === 'health' && <HealthTab />}
      {tab === 'settings' && <SettingsTab tenantId={id} currency={c} showToast={showToast} />}

      {confirmStatus && (
        <Confirm
          title={company.status === 'active' ? 'Suspend this company?' : 'Reactivate this company?'}
          message={company.status === 'active'
            ? `${company.name} will be suspended — members and admins lose access (writes immediately, reads shortly). You can reactivate any time.`
            : `${company.name} will be reactivated and regain access.`}
          confirmLabel={company.status === 'active' ? 'Suspend' : 'Reactivate'}
          danger={company.status === 'active'}
          busy={busy}
          onConfirm={toggleStatus}
          onClose={() => setConfirmStatus(false)}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Overview */
function OverviewTab({ company, activateBlockedMsg, onActivateClick }: {
  company: Company;
  activateBlockedMsg: string;
  onActivateClick: () => void;
}) {
  const c = company.currency;
  const { setup } = company;
  const checklist: Array<{ label: string; done: boolean; hint?: string }> = [
    { label: 'Commission plan assigned', done: setup.hasPlan },
    { label: 'Branding configured', done: setup.hasBranding },
    { label: 'Owner has accepted invite', done: setup.hasOwnerAccepted },
    { label: `Members joined`, done: setup.memberCount > 0, hint: `${setup.memberCount} member${setup.memberCount === 1 ? '' : 's'}` },
  ];

  return (
    <div>
      <div className="stat-grid fade-in delay-1" style={{ margin: '18px 0' }}>
        <Kpi label="Members" value={`${company.kpis.activeMembers} / ${company.kpis.members}`} icon="⬡" hint="active / total" />
        <Kpi label="Revenue this month" value={money(company.kpis.revenueThisMonthCents, c)} icon="◆" hint={`${company.kpis.salesThisMonth} approved sales`} />
        <Kpi label="Outstanding payable" value={money(company.kpis.outstandingPayableCents, c)} icon="◷" hint="awaiting payout" />
        <Kpi label="Plan" value={company.plan ? bps(company.plan.poolRateBps) : '—'} icon="◇" hint={company.plan ? `${company.plan.name} · depth ${company.plan.depth}` : 'no plan'} />
      </div>

      <div className="card fade-in delay-2" style={{ marginBottom: 20 }}>
        <div className="spread" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <strong style={{ fontSize: 15 }}>Setup checklist</strong>
            <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>What needs to be in place before this company can be activated.</div>
          </div>
          {company.status !== 'active' && (
            <button className="btn sm" onClick={onActivateClick} disabled={!setup.hasPlan} title={!setup.hasPlan ? 'Assign a commission plan first' : undefined}>
              Activate company
            </button>
          )}
        </div>
        {activateBlockedMsg && <div className="error" style={{ marginBottom: 12 }}>{activateBlockedMsg}</div>}
        <div className="grid" style={{ gap: 8 }}>
          {checklist.map((item) => (
            <div key={item.label} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 900, background: item.done ? 'var(--emerald)' : 'rgba(255,255,255,.08)', color: item.done ? '#fff' : 'var(--muted)' }}>
                {item.done ? '✓' : '·'}
              </span>
              <span style={{ fontSize: 13.5 }}>{item.label}</span>
              {item.hint && <span className="faint" style={{ fontSize: 12 }}>({item.hint})</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon, hint }: { label: string; value: string; icon: string; hint?: string }) {
  return (
    <div className="card stat">
      <div className="spread"><span className="k">{label}</span><span className="icon">{icon}</span></div>
      <div className="v">{value}</div>
      {hint && <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Users */
function UsersTab({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [nodes, setNodes] = useState<ApiNode[] | null>(null);
  const [members, setMembers] = useState<MemberList | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.get<ApiNode[]>(`/platform/companies/${tenantId}/network`).then(setNodes).catch(() => {});
  }, [tenantId]);

  useEffect(() => {
    api.get<MemberList>(`/platform/companies/${tenantId}/members?page=${page}`).then(setMembers).catch(() => {});
  }, [tenantId, page]);

  return (
    <div>
      <div className="card fade-in delay-2" style={{ marginBottom: 20 }}>
        <div className="spread" style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 15 }}>Referral network</strong>
          <span className="faint" style={{ fontSize: 12 }}>Tree / list · drill into anyone</span>
        </div>
        {!nodes ? <Loading rows={4} /> : <NetworkExplorer nodes={nodes} title={tenantName} />}
      </div>

      <div className="card fade-in delay-2" style={{ marginBottom: 20 }}>
        <div className="spread" style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 15 }}>Members</strong>
          <span className="faint" style={{ fontSize: 12 }}>{members ? `${members.total} total` : ''}</span>
        </div>
        <div className="card" style={{ background: 'var(--panel-2)', padding: 0, overflowX: 'auto' }}>
          <table aria-label="Members">
            <thead><tr><th>Name</th><th>Email</th><th>Code</th><th>Role</th><th>Status</th><th>Depth</th><th>Joined</th></tr></thead>
            <tbody>
              {(members?.rows ?? []).map((m) => (
                <tr key={m.id}>
                  <td>{m.fullName}</td>
                  <td className="faint">{m.email}</td>
                  <td className="tnum">{m.referralCode}</td>
                  <td>{m.role}</td>
                  <td><span className={`badge ${m.status === 'active' ? 'active' : 'inactive'}`}>{m.status}</span></td>
                  <td className="tnum">{m.depth}</td>
                  <td className="muted">{dateShort(m.joinedAt)}</td>
                </tr>
              ))}
              {!members && <tr><td colSpan={7} className="muted">Loading…</td></tr>}
              {members && members.rows.length === 0 && <tr><td colSpan={7} className="muted">No members yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {members && <Pagination page={members.page} pageSize={members.pageSize} total={members.total} onPage={setPage} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Plans */
function PlansTab({ company }: { company: Company }) {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [packages, setPackages] = useState<BillingPackage[] | null>(null);

  useEffect(() => {
    api.get<Billing>(`/platform/companies/${company.id}/billing`).then(setBilling).catch(() => {});
    api.get<BillingPackage[]>('/platform/packages').then(setPackages).catch(() => {});
  }, [company.id]);

  return (
    <div>
      <div className="card fade-in delay-1" style={{ marginBottom: 20 }}>
        <strong style={{ fontSize: 15 }}>Commission plan</strong>
        <div className="faint" style={{ fontSize: 12, marginTop: 2, marginBottom: 14 }}>Read-only — edit plans from the tenant admin workspace.</div>
        {company.plan ? (
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <Field label="Name" value={company.plan.name} />
            <Field label="Pool rate" value={bps(company.plan.poolRateBps)} />
            <Field label="Depth" value={String(company.plan.depth)} />
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>No commission plan assigned yet.</div>
        )}
      </div>

      <div className="card fade-in delay-2">
        <strong style={{ fontSize: 15 }}>Billing package</strong>
        <div className="faint" style={{ fontSize: 12, marginTop: 2, marginBottom: 14 }}>Assigned subscription package (edit in Settings tab).</div>
        {!billing || !packages ? <Loading rows={2} /> : (
          <div className="grid" style={{ gap: 6 }}>
            <div className="muted" style={{ fontSize: 13 }}>
              Monthly fee: <strong style={{ color: 'var(--text)' }}>{billing.config ? money(billing.config.monthlyFeeCents, billing.config.currency) : '—'}</strong>
              {' '}· <span className={`badge ${billing.config?.active ? 'active' : 'inactive'}`}>{billing.config?.active ? 'active' : 'inactive'}</span>
            </div>
            <div className="faint" style={{ fontSize: 12 }}>
              Available packages: {packages.map((p) => p.name).join(', ') || 'none configured'}
            </div>
            <div className="faint" style={{ fontSize: 11 }}>
              Note: the billing config for this tenant does not currently expose which catalog package (if any) was used — only the resulting monthly fee/active/notes are stored per-tenant.
            </div>
          </div>
        )}
      </div>
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

/* ------------------------------------------------------------------ Payouts */
function PayoutsTab({ tenantId, currency }: { tenantId: string; currency: string }) {
  const [payouts, setPayouts] = useState<PayoutList | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.get<PayoutList>(`/platform/companies/${tenantId}/payouts?page=${page}`).then(setPayouts).catch(() => {});
  }, [tenantId, page]);

  return (
    <div className="card fade-in delay-1" style={{ marginBottom: 20 }}>
      <div className="spread" style={{ marginBottom: 14 }}>
        <strong style={{ fontSize: 15 }}>Payouts</strong>
        <span className="faint" style={{ fontSize: 12 }}>{payouts ? `${payouts.total} total` : ''}</span>
      </div>
      <div className="card" style={{ background: 'var(--panel-2)', padding: 0, overflowX: 'auto' }}>
        <table aria-label="Payouts">
          <thead><tr><th>Member</th><th>Code</th><th>Amount</th><th>Method</th><th>Status</th><th>Period</th><th>Created</th><th>Paid</th></tr></thead>
          <tbody>
            {(payouts?.rows ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.memberName}</td>
                <td className="tnum">{p.referralCode}</td>
                <td className="tnum">{money(p.totalCents, currency)}</td>
                <td>{p.method}</td>
                <td><span className={`badge ${p.status === 'paid' ? 'active' : p.status === 'failed' ? 'failed' : 'pending'}`}>{p.status}</span></td>
                <td>{p.period}</td>
                <td className="muted">{dateShort(p.createdAt)}</td>
                <td className="muted">{p.paidAt ? dateShort(p.paidAt) : '—'}</td>
              </tr>
            ))}
            {!payouts && <tr><td colSpan={8} className="muted">Loading…</td></tr>}
            {payouts && payouts.rows.length === 0 && <tr><td colSpan={8} className="muted">No payouts yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {payouts && <Pagination page={payouts.page} pageSize={payouts.pageSize} total={payouts.total} onPage={setPage} />}
    </div>
  );
}

/* ------------------------------------------------------------------ Audit */
function AuditTab({ tenantId }: { tenantId: string }) {
  const [audit, setAudit] = useState<AuditList | null>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [sort] = useState('createdAt');
  const [dir, setDir] = useState<SortDir>('desc');
  const [detail, setDetail] = useState<AuditItem | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    if (action) p.set('action', action);
    api.get<AuditList>(`/platform/companies/${tenantId}/audit?${p.toString()}`).then(setAudit).catch(() => {});
  }, [tenantId, page, action]);

  useEffect(() => { load(); }, [load]);

  const rows = audit?.items ?? [];
  const sorted = [...rows].sort((a, b) => {
    const av = a.createdAt, bv = b.createdAt;
    return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  return (
    <div className="card fade-in delay-1" style={{ marginBottom: 20 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <strong style={{ fontSize: 15 }}>Audit log</strong>
        <span style={{ flex: 1 }} />
        <input aria-label="Filter by action" placeholder="Filter action…" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} style={{ maxWidth: 200 }} />
        <span className="faint" style={{ fontSize: 12 }}>{audit ? `${audit.total} events` : ''}</span>
      </div>
      <div className="card" style={{ background: 'var(--panel-2)', padding: 0, overflowX: 'auto' }}>
        <table aria-label="Audit log">
          <thead>
            <tr>
              <th>Action</th>
              <th>Actor</th>
              <SortableTh label="When" field="createdAt" sort={sort} dir={dir} onSort={(_f, d) => setDir(d)} />
              <th>Diff</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <tr key={a.seq}>
                <td title={a.action}>{humanizeAction(a.action)}</td>
                <td className="faint">{a.actorUserId ? a.actorName : '⚙ system'}</td>
                <td className="muted">{dateShort(a.createdAt)}</td>
                <td>
                  <button className="btn ghost sm" onClick={() => setDetail(a)}>View</button>
                </td>
              </tr>
            ))}
            {!audit && <tr><td colSpan={4} className="muted">Loading…</td></tr>}
            {audit && rows.length === 0 && <tr><td colSpan={4} className="muted">No matching events.</td></tr>}
          </tbody>
        </table>
      </div>
      {audit && <Pagination page={audit.page} pageSize={audit.pageSize} total={audit.total} onPage={setPage} />}

      {detail && (
        <Modal title={humanizeAction(detail.action)} onClose={() => setDetail(null)}>
          <div style={{ width: 'min(520px, 100%)' }}>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <Field label="When" value={dateShort(detail.createdAt)} />
              <Field label="Entity" value={detail.entity} />
              <Field label="Actor" value={detail.actorUserId ? detail.actorName : 'system'} />
              <Field label="Actor email" value={detail.actorEmail ?? '—'} />
            </div>
            <AuditDiff before={detail.before} after={detail.after} />
          </div>
        </Modal>
      )}
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

/* ------------------------------------------------------------------ Health */
function HealthTab() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    api.get<Health>('/platform/health').then(setHealth).catch(() => {});
  }, []);

  return (
    <div className="card fade-in delay-1" style={{ marginBottom: 20 }}>
      <div className="spread" style={{ marginBottom: 14 }}>
        <strong style={{ fontSize: 15 }}>System health</strong>
        <span className="faint" style={{ fontSize: 12 }}>Platform-wide (not tenant-specific)</span>
      </div>
      <div className="faint" style={{ fontSize: 12, marginBottom: 14 }}>
        This is the global platform health snapshot — background jobs and backups are shared infrastructure, not scoped per company.
      </div>
      {!health ? <Loading rows={3} /> : (
        <div className="grid" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className={`badge ${health.db ? 'active' : 'failed'}`}>{health.db ? 'DB reachable' : 'DB unreachable'}</span>
            <span className="faint" style={{ fontSize: 12 }}>Last backup: {health.backups.lastBackupAt ? dateShort(health.backups.lastBackupAt) : '—'}</span>
          </div>
          <div className="card" style={{ background: 'var(--panel-2)', padding: 0, overflowX: 'auto' }}>
            <table aria-label="Jobs">
              <thead><tr><th>Job</th><th>Last run</th><th>Status</th></tr></thead>
              <tbody>
                {health.jobs.map((j) => (
                  <tr key={j.name} style={j.stale ? { background: 'color-mix(in srgb, var(--rose) 10%, transparent)' } : undefined}>
                    <td>{j.name}</td>
                    <td className="muted">{dateShort(j.at)}</td>
                    <td>
                      {j.stale ? (
                        <span className="badge failed">Stale</span>
                      ) : (
                        <span className={`badge ${j.ok ? 'active' : 'failed'}`}>{j.ok ? 'OK' : 'Failed'}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {health.jobs.length === 0 && <tr><td colSpan={3} className="muted">No scheduled jobs reporting.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Settings */
function SettingsTab({ tenantId, currency, showToast }: { tenantId: string; currency: string; showToast: (msg: string) => void }) {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [feeInput, setFeeInput] = useState('');
  const [activeInput, setActiveInput] = useState(true);
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [payNote, setPayNote] = useState('');

  // branding
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryHex, setPrimaryHex] = useState('');
  const [accentHex, setAccentHex] = useState('');
  const [brandingBusy, setBrandingBusy] = useState(false);

  function loadBilling() {
    api.get<Billing>(`/platform/companies/${tenantId}/billing`).then((b) => {
      setBilling(b);
      setFeeInput(b.config ? (Number(b.config.monthlyFeeCents) / 100).toString() : '');
      setActiveInput(b.config ? b.config.active : true);
    }).catch(() => {});
  }

  useEffect(() => { loadBilling(); }, [tenantId]);

  async function saveBilling() {
    setBusy(true);
    try {
      const cents = Math.round(parseFloat(feeInput || '0') * 100);
      await api.put(`/platform/companies/${tenantId}/billing`, { monthlyFeeCents: cents, active: activeInput });
      loadBilling(); showToast('Billing saved ✓');
    } catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); }
  }
  async function issueInvoice() {
    setBusy(true);
    try { await api.post(`/platform/companies/${tenantId}/invoices`, { period }); loadBilling(); showToast(`Invoice issued for ${period}`); }
    catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); }
  }
  function openMarkPaid(inv: Invoice) { setPayNote(''); setPayInvoice(inv); }
  async function doMarkPaid() {
    if (!payInvoice) return;
    setBusy(true);
    try { await api.post(`/platform/invoices/${payInvoice.id}/paid`, { note: payNote.trim() || undefined }); loadBilling(); showToast('Marked paid ✓'); setPayInvoice(null); }
    catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); }
  }
  async function voidInvoice(inv: Invoice) {
    setBusy(true);
    try { await api.post(`/platform/invoices/${inv.id}/void`); loadBilling(); showToast('Invoice voided'); }
    catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); }
  }
  async function saveBranding() {
    setBrandingBusy(true);
    try {
      await api.put(`/platform/companies/${tenantId}/branding`, {
        logoUrl: logoUrl.trim() || undefined,
        primaryHex: primaryHex.trim() || undefined,
        accentHex: accentHex.trim() || undefined,
      });
      showToast('Branding saved ✓');
    } catch (e) { showToast(String((e as ApiError).message)); } finally { setBrandingBusy(false); }
  }

  return (
    <div>
      <div className="card fade-in delay-1" style={{ marginBottom: 20 }}>
        <div className="spread" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <strong style={{ fontSize: 15 }}>Billing</strong>
            <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>Subscription fee for this company. Payments are tracked manually (no card on file) — issue an invoice, mark it paid when the check/wire arrives.</div>
          </div>
          <span className="faint" style={{ fontSize: 12, textAlign: 'right' }}>Outstanding<br /><strong style={{ color: Number(billing?.outstandingCents ?? 0) > 0 ? 'var(--gold-600)' : 'var(--text)' }}>{money(billing?.outstandingCents ?? '0', currency)}</strong></span>
        </div>

        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Monthly fee ({currency})</label>
            <input value={feeInput} onChange={(e) => setFeeInput(e.target.value)} inputMode="decimal" placeholder="99.00" style={{ maxWidth: 130 }} />
          </div>
          <label className="row" style={{ gap: 6, fontSize: 13, alignItems: 'center', paddingBottom: 8 }}>
            <input type="checkbox" checked={activeInput} onChange={(e) => setActiveInput(e.target.checked)} /> Active
          </label>
          <button className="btn sm" onClick={saveBilling} disabled={busy}>Save</button>
          <span style={{ flex: 1 }} />
          <div className="field" style={{ margin: 0 }}>
            <label>Issue invoice</label>
            <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-06" style={{ maxWidth: 110 }} />
          </div>
          <button className="btn ghost sm" onClick={issueInvoice} disabled={busy || !billing?.config?.active}>+ Issue</button>
        </div>

        <div className="card" style={{ background: 'var(--panel-2)', padding: 0, overflowX: 'auto' }}>
          <table aria-label="Invoice history">
            <thead><tr><th>Period</th><th>Amount</th><th>Status</th><th>Due</th><th>Paid</th><th></th></tr></thead>
            <tbody>
              {(billing?.invoices ?? []).map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.period}</td>
                  <td className="tnum">{money(inv.amountCents, inv.currency)}</td>
                  <td><span className={`badge ${INV_BADGE[inv.status]}`}>{inv.status}</span>{inv.paidNote && <span className="faint" style={{ fontSize: 11, marginLeft: 6 }}>{inv.paidNote}</span>}</td>
                  <td className="muted">{inv.dueAt ? dateShort(inv.dueAt) : '—'}</td>
                  <td className="muted">{inv.paidAt ? dateShort(inv.paidAt) : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {inv.status === 'open' && <>
                      <button className="btn success sm" onClick={() => openMarkPaid(inv)} disabled={busy}>Mark paid</button>{' '}
                      <button className="btn ghost sm" onClick={() => voidInvoice(inv)} disabled={busy}>Void</button>
                    </>}
                  </td>
                </tr>
              ))}
              {!billing && <tr><td colSpan={6} className="muted">Loading…</td></tr>}
              {billing && billing.invoices.length === 0 && <tr><td colSpan={6} className="muted">No invoices yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card fade-in delay-2">
        <strong style={{ fontSize: 15 }}>Branding</strong>
        <div className="faint" style={{ fontSize: 12, marginTop: 2, marginBottom: 14 }}>Logo and brand colors shown in this company&apos;s workspace.</div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 200 }}>
            <label>Logo URL</label>
            <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Primary hex</label>
            <input value={primaryHex} onChange={(e) => setPrimaryHex(e.target.value)} placeholder="#123456" style={{ maxWidth: 110 }} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Accent hex</label>
            <input value={accentHex} onChange={(e) => setAccentHex(e.target.value)} placeholder="#123456" style={{ maxWidth: 110 }} />
          </div>
          <button className="btn sm" onClick={saveBranding} disabled={brandingBusy}>Save</button>
        </div>
      </div>

      {payInvoice && (
        <Modal title={`Mark ${payInvoice.period} invoice paid`} onClose={() => setPayInvoice(null)}>
          <div style={{ width: 'min(420px, 100%)' }}>
            <p className="muted" style={{ marginTop: 0 }}>{money(payInvoice.amountCents, payInvoice.currency)} — record how it was paid (optional).</p>
            <div className="field">
              <label htmlFor="pay-note">Payment reference</label>
              <input id="pay-note" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="check #1234 / wire ref" autoFocus />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button className="btn ghost" onClick={() => setPayInvoice(null)} disabled={busy}>Cancel</button>
              <button className="btn success" onClick={doMarkPaid} disabled={busy}>{busy ? '…' : 'Mark paid'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
