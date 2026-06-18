'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { money } from '@/lib/format';

interface Ar { totals: { openCents: string; overdueCents: string; paidCents: string }; invoices: unknown[] }

interface Company {
  id: string;
  slug: string;
  name: string;
  currency: string;
  status: 'active' | 'suspended';
  members: number;
  activeMembers: number;
  revenueThisMonthCents: string;
  salesThisMonth: number;
  createdAt: string;
}

export default function CompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [ar, setAr] = useState<Ar | null>(null);
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  function loadAr() { api.get<Ar>('/platform/billing').then(setAr).catch(() => {}); }
  useEffect(() => {
    api.get<Company[]>('/platform/companies').then(setCompanies).catch((e) => setError(String((e as ApiError).message)));
    loadAr();
  }, []);

  async function runInvoices() {
    setBusy(true);
    try {
      const r = await api.post<{ created: number; skipped: number }>('/platform/invoices/run', { period });
      showToast(`${period}: ${r.created} invoice${r.created === 1 ? '' : 's'} issued${r.skipped ? `, ${r.skipped} already existed` : ''}`);
      loadAr();
    } catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  const filtered = useMemo(
    () => (companies ?? []).filter((c) => !q.trim() || c.name.toLowerCase().includes(q.toLowerCase()) || c.slug.includes(q.toLowerCase())),
    [companies, q],
  );

  const totals = useMemo(() => {
    const list = companies ?? [];
    return {
      companies: list.length,
      members: list.reduce((a, c) => a + c.members, 0),
      revenue: list.reduce((a, c) => a + Number(c.revenueThisMonthCents), 0),
    };
  }, [companies]);

  if (error) return <div className="error">{error}</div>;
  if (!companies) return <Loading rows={4} />;

  return (
    <div>
      <div className="eyebrow fade-in">Platform</div>
      <h1 className="h1 fade-in">Companies</h1>
      <p className="sub fade-in" style={{ marginBottom: 16 }}>Every workspace on Refearn. Open one to manage its network and settings.</p>

      <div className="stat-grid fade-in delay-1" style={{ marginBottom: 18 }}>
        <Kpi label="Companies" value={String(totals.companies)} icon="◳" />
        <Kpi label="Members (all)" value={totals.members.toLocaleString('en-US')} icon="⬡" />
        <Kpi label="Revenue this month" value={money(totals.revenue, 'USD')} icon="◆" />
      </div>

      {/* Billing (AR) — manuel takip: faturalandır, ödeme gelince şirket sayfasından işaretle */}
      {ar && (
        <div className="card fade-in delay-1" style={{ marginBottom: 18, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div className="faint" style={{ fontSize: 11 }}>Outstanding</div>
            <div className="tnum" style={{ fontSize: 18, fontWeight: 700 }}>{money(ar.totals.openCents, 'USD')}</div>
          </div>
          <div>
            <div className="faint" style={{ fontSize: 11 }}>Overdue</div>
            <div className="tnum" style={{ fontSize: 18, fontWeight: 700, color: Number(ar.totals.overdueCents) > 0 ? 'var(--rose, #e11d48)' : 'var(--text)' }}>{money(ar.totals.overdueCents, 'USD')}</div>
          </div>
          <div>
            <div className="faint" style={{ fontSize: 11 }}>Collected</div>
            <div className="tnum" style={{ fontSize: 18, fontWeight: 700, color: 'var(--emerald)' }}>{money(ar.totals.paidCents, 'USD')}</div>
          </div>
          <span style={{ flex: 1 }} />
          <div className="field" style={{ margin: 0 }}>
            <label>Bill all active companies</label>
            <div className="row" style={{ gap: 8 }}>
              <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-06" style={{ maxWidth: 110 }} />
              <button className="btn sm" onClick={runInvoices} disabled={busy}>Run invoices</button>
            </div>
          </div>
        </div>
      )}

      <div className="row fade-in delay-1" style={{ marginBottom: 14, justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <input placeholder="Search companies…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <span className="badge draft" style={{ fontSize: 11, alignSelf: 'center' }}>New-company onboarding — coming soon</span>
      </div>

      <div className="grid fade-in delay-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
        {filtered.map((c) => (
          <button key={c.id} className="card hover" onClick={() => router.push(`/platform/companies/${c.id}`)}
            style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="spread">
              <div className="row" style={{ gap: 11 }}>
                <span style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'var(--foil)', color: 'var(--on-gold)', fontWeight: 800, fontSize: 17, fontFamily: 'var(--font-display)' }}>
                  {c.name.charAt(0).toUpperCase()}
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                  <div className="faint" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{c.slug}</div>
                </div>
              </div>
              <span className={`badge ${c.status === 'active' ? 'active' : 'inactive'}`} style={{ fontSize: 9 }}>{c.status}</span>
            </div>
            <div className="row" style={{ gap: 18 }}>
              <Mini label="Members" value={`${c.activeMembers}/${c.members}`} />
              <Mini label="Revenue (mo)" value={money(c.revenueThisMonthCents, c.currency)} />
              <Mini label="Sales (mo)" value={String(c.salesThisMonth)} />
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 'auto' }}>Open company →</div>
          </button>
        ))}
        {filtered.length === 0 && <div className="muted">No companies match.</div>}
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="card stat">
      <div className="spread"><span className="k">{label}</span><span className="icon">{icon}</span></div>
      <div className="v">{value}</div>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="faint" style={{ fontSize: 10.5 }}>{label}</div>
      <div className="tnum" style={{ fontWeight: 700, fontSize: 13.5, marginTop: 1 }}>{value}</div>
    </div>
  );
}
