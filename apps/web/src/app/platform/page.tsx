'use client';

import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Building2, Plus, Users, Wallet } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { CountUp, Loading, Modal, MoneyCounter, useToast } from '@/components/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { money } from '@/lib/format';
import { APP_NAME } from '@/lib/brand';

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
  const [showNew, setShowNew] = useState(false);

  function load() {
    api.get<Company[]>('/platform/companies').then(setCompanies).catch((e) => setError(String((e as ApiError).message)));
  }
  function loadAr() { api.get<Ar>('/platform/billing').then(setAr).catch(() => {}); }
  useEffect(() => {
    load();
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

  if (error) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;
  if (!companies) return <Loading rows={4} />;

  return (
    <div>
      <div className="eyebrow fade-in">Platform</div>
      <h1 className="h1 fade-in">Companies</h1>
      <p className="sub fade-in" style={{ marginBottom: 16 }}>Every workspace on {APP_NAME}. Open one to manage its network and settings.</p>

      <div className="stat-grid fade-in delay-1" style={{ marginBottom: 18 }}>
        <Kpi label="Companies" value={<CountUp value={totals.companies} />} icon={<Building2 className="size-[18px]" aria-hidden />} />
        <Kpi label="Members (all)" value={<CountUp value={totals.members} />} icon={<Users className="size-[18px]" aria-hidden />} />
        <Kpi label="Revenue this month" value={<MoneyCounter cents={totals.revenue} currency="USD" />} icon={<Wallet className="size-[18px]" aria-hidden />} />
      </div>

      {/* Billing (AR) — manuel takip: faturalandır, ödeme gelince şirket sayfasından işaretle */}
      {ar && (
        <div className="card lift beam glow-primary fade-in delay-1" style={{ marginBottom: 18, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div className="faint" style={{ fontSize: 11 }}>Outstanding</div>
            <div className="tnum" style={{ fontSize: 18, fontWeight: 700 }}>{money(ar.totals.openCents, 'USD')}</div>
          </div>
          <div>
            <div className="faint" style={{ fontSize: 11 }}>Overdue</div>
            <div className="tnum" style={{ fontSize: 18, fontWeight: 700, color: Number(ar.totals.overdueCents) > 0 ? 'var(--rose)' : 'var(--text)' }}>{money(ar.totals.overdueCents, 'USD')}</div>
          </div>
          <div>
            <div className="faint" style={{ fontSize: 11 }}>Collected</div>
            <div className="tnum" style={{ fontSize: 18, fontWeight: 700, color: 'var(--emerald)' }}>{money(ar.totals.paidCents, 'USD')}</div>
          </div>
          <span style={{ flex: 1, minWidth: 12 }} />
          <div className="field" style={{ margin: 0, minWidth: 220 }}>
            <label htmlFor="bill-all-period">Bill all active companies</label>
            <div className="row" style={{ gap: 8 }}>
              <input id="bill-all-period" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-06" style={{ maxWidth: 110 }} />
              <button className="btn sm" onClick={runInvoices} disabled={busy}>Run invoices</button>
            </div>
          </div>
        </div>
      )}

      <div className="row fade-in delay-1" style={{ marginBottom: 14, justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <input aria-label="Search companies" placeholder="Search companies…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <button className="btn" onClick={() => setShowNew(true)}><Plus className="size-4" aria-hidden /> New company</button>
      </div>

      <div className="grid fade-in delay-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
        {filtered.map((c) => (
          <button key={c.id} className="card hover lift" aria-label={`Open ${c.name} company details`} onClick={() => router.push(`/platform/companies/${c.id}`)}
            style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="spread">
              <div className="row" style={{ gap: 12 }}>
                <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'var(--foil)', color: 'var(--on-gold)', fontWeight: 800, fontSize: 16, fontFamily: 'var(--font-display)' }}>
                  {c.name.charAt(0).toUpperCase()}
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                  <div className="faint" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{c.slug}</div>
                </div>
              </div>
              <span className={`badge ${c.status === 'active' ? 'active' : 'inactive'}`} style={{ fontSize: 10 }}>{c.status}</span>
            </div>
            <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
              <Mini label="Members" value={`${c.activeMembers}/${c.members}`} />
              <Mini label="Revenue (mo)" value={money(c.revenueThisMonthCents, c.currency)} />
              <Mini label="Sales (mo)" value={String(c.salesThisMonth)} />
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Open company <ArrowRight className="size-[13px]" aria-hidden /></div>
          </button>
        ))}
        {filtered.length === 0 && <div className="muted">No companies match.</div>}
      </div>

      {showNew && (
        <NewCompanyModal
          onClose={() => setShowNew(false)}
          onCreated={() => { load(); loadAr(); showToast('Company created ✓'); }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Kpi({ label, value, icon }: { label: string; value: ReactNode; icon: ReactNode }) {
  return (
    <div className="card stat lift">
      <div className="spread"><span className="k">{label}</span><span className="icon" aria-hidden="true">{icon}</span></div>
      <div className="v">{value}</div>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div className="tnum" style={{ fontWeight: 700, fontSize: 13, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

interface CreatedCompany {
  id: string; slug: string; name: string; ownerEmail: string; ownerExisting: boolean; tempPassword: string | null;
}

/** Yeni sirket kurma sihirbazi: tenant + varsayilan plan + owner. Owner yeniyse gecici sifre bir kez gosterilir. */
function NewCompanyModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: CreatedCompany) => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [currency, setCurrency] = useState('USD');
  const [timezone, setTimezone] = useState('America/New_York');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<CreatedCompany | null>(null);

  const effSlug = slugTouched ? slug : slugify(name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const res = await api.post<CreatedCompany>('/platform/companies', {
        name: name.trim(), slug: effSlug, currency, timezone, ownerEmail: ownerEmail.trim(), ownerName: ownerName.trim(),
      });
      setDone(res);
      onCreated(res);
    } catch (e) {
      setErr(String((e as ApiError).message));
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title="Company created ✓" onClose={onClose}>
        <p className="muted" style={{ marginTop: 0 }}>
          <strong>{done.name}</strong> (<span style={{ fontFamily: 'ui-monospace, monospace' }}>{done.slug}</span>) is ready. Open it from the list and use “Enter workspace”.
        </p>
        {done.tempPassword ? (
          <div className="card" style={{ marginTop: 4 }}>
            <div className="faint" style={{ fontSize: 11, marginBottom: 6 }}>Owner sign-in — share securely, shown once</div>
            <div style={{ fontSize: 13 }}>Email: <strong>{done.ownerEmail}</strong></div>
            <div style={{ fontSize: 13 }}>Temporary password: <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{done.tempPassword}</strong></div>
            <button type="button" className="btn ghost sm" style={{ marginTop: 8 }}
              onClick={() => navigator.clipboard.writeText(`${done.ownerEmail} / ${done.tempPassword}`)}>Copy</button>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>Owner <strong>{done.ownerEmail}</strong> already had an account — they sign in with their existing password.</div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="New company" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Company name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="Acme Rewards" />
        </div>
        <div className="field">
          <label>Slug (URL id)</label>
          <input value={effSlug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} required placeholder="acme-rewards" />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Currency</label>
            <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label>Timezone</label>
            <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Owner full name</label>
          <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required placeholder="Jane Doe" />
        </div>
        <div className="field">
          <label>Owner email</label>
          <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} required placeholder="owner@acme.com" />
        </div>
        {err && <Alert variant="destructive" className="mt-2"><AlertDescription>{err}</AlertDescription></Alert>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create company'}</button>
        </div>
      </form>
    </Modal>
  );
}
