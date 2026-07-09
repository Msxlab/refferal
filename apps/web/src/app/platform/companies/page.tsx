'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Loading, Modal, Pagination, useToast } from '@/components/ui';
import { money } from '@/lib/format';
import { StatusBadge } from '@/components/platform/statusBadge';
import { APP_NAME } from '@/lib/brand';

interface Company {
  id: string;
  slug: string;
  name: string;
  currency: string;
  status: string;
  members: number;
  activeMembers: number;
  revenueThisMonthCents: string;
  salesThisMonth: number;
  createdAt: string;
}
interface Page { total: number; page: number; pageSize: number; rows: Company[] }

/** Sirket dizini: sunucu taraflı sayfalama + durum filtresi + debounced arama (item 1, 11). */
export default function CompaniesPage() {
  const router = useRouter();
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

  function load() {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status) params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    api.get<Page>(`/platform/companies?${params}`).then(setData).catch((e) => setError(String((e as ApiError).message)));
  }

  useEffect(() => {
    const h = setTimeout(load, 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, q]);

  // filtre/arama degisince ilk sayfaya don
  useEffect(() => { setPage(1); }, [status, q]);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <Loading rows={4} />;

  return (
    <div>
      <div className="eyebrow fade-in">Platform</div>
      <h1 className="h1 fade-in">Companies</h1>
      <p className="sub fade-in" style={{ marginBottom: 16 }}>Every workspace on {APP_NAME}. Open one to manage its network and settings.</p>

      <div className="row fade-in delay-1" style={{ marginBottom: 14, justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input aria-label="Search companies" placeholder="Search companies…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
          <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="setup_needed">Setup needed</option>
          </select>
        </div>
        <button className="btn" onClick={() => setShowNew(true)}>＋ New company</button>
      </div>

      {data.rows.length === 0 ? (
        <div className="card muted fade-in delay-2">No companies match.</div>
      ) : (
        <div className="grid fade-in delay-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
          {data.rows.map((c) => (
            <button key={c.id} className="card hover" aria-label={`Open ${c.name} company details`} onClick={() => router.push(`/platform/companies/${c.id}`)}
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
                <StatusBadge status={c.status} />
              </div>
              <div className="row" style={{ gap: 18 }}>
                <Mini label="Members" value={`${c.activeMembers}/${c.members}`} />
                <Mini label="Revenue (mo)" value={money(c.revenueThisMonthCents, c.currency)} />
                <Mini label="Sales (mo)" value={String(c.salesThisMonth)} />
              </div>
              <div className="faint" style={{ fontSize: 12, marginTop: 'auto' }}>Open company →</div>
            </button>
          ))}
        </div>
      )}

      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />

      {showNew && (
        <NewCompanyModal
          onClose={() => setShowNew(false)}
          onCreated={() => { load(); showToast('Company created ✓'); }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
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

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

interface CreatedCompany {
  id: string; slug: string; name: string; ownerEmail: string; ownerExisting: boolean; tempPassword: string | null;
}

/**
 * Yeni sirket kurma sihirbazi: tenant + varsayilan plan + owner. Owner yeniyse gecici sifre YERINE
 * e-posta davet gonderilir (tempPassword hep null doner — platform.service.ts item 8).
 * NOT: Task 14'te <OnboardingWizard> ile degistirilecek; su an icin mevcut modal tasindi.
 */
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
        {err && <div className="error">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create company'}</button>
        </div>
      </form>
    </Modal>
  );
}
