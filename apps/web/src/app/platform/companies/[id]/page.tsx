'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, switchTenant } from '@/lib/api';
import { applyTenantSwitch, getSession, membershipForTenant } from '@/lib/auth';
import { Confirm, Loading, Modal, useToast } from '@/components/ui';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { NetworkExplorer, type ApiNode } from '@/components/NetworkExplorer';
import { bps, money, dateShort } from '@/lib/format';

interface Company {
  id: string; slug: string; name: string; currency: string; timezone: string; status: string;
  payoutMinCents: string; maturationRule: string; createdAt: string;
  kpis: { members: number; activeMembers: number; revenueThisMonthCents: string; salesThisMonth: number; outstandingPayableCents: string };
  plan: { name: string; poolRateBps: number; depth: number } | null;
}

interface Invoice { id: string; period: string; amountCents: string; currency: string; status: 'open' | 'paid' | 'void'; issuedAt: string; dueAt: string | null; paidAt: string | null; paidNote: string | null }
interface Billing { tenant: { id: string; name: string; currency: string }; config: { monthlyFeeCents: string; currency: string; active: boolean; notes: string | null } | null; outstandingCents: string; invoices: Invoice[] }

type BadgeVariant = 'default' | 'secondary' | 'success' | 'destructive' | 'pending' | 'payable';
const INV_VARIANT: Record<string, BadgeVariant> = { open: 'pending', paid: 'success', void: 'secondary' };

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [company, setCompany] = useState<Company | null>(null);
  const [nodes, setNodes] = useState<ApiNode[] | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

  // platform → isyeri kopru (prod)
  const [entering, setEntering] = useState(false);
  const [enterMsg, setEnterMsg] = useState('');

  // billing (C2) + suspend (C1)
  const [billing, setBilling] = useState<Billing | null>(null);
  const [feeInput, setFeeInput] = useState('');
  const [activeInput, setActiveInput] = useState(true);
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [payNote, setPayNote] = useState('');

  function loadCompany() {
    api.get<Company>(`/platform/companies/${id}`).then(setCompany).catch((e) => setError(String((e as ApiError).message)));
  }
  function loadBilling() {
    api.get<Billing>(`/platform/companies/${id}/billing`).then((b) => {
      setBilling(b);
      setFeeInput(b.config ? (Number(b.config.monthlyFeeCents) / 100).toString() : '');
      setActiveInput(b.config ? b.config.active : true);
    }).catch(() => {});
  }

  useEffect(() => {
    if (!id) return;
    loadCompany();
    loadBilling();
    api.get<ApiNode[]>(`/platform/companies/${id}/network`).then(setNodes).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveBilling() {
    setBusy(true);
    try {
      const cents = Math.round(parseFloat(feeInput || '0') * 100);
      await api.put(`/platform/companies/${id}/billing`, { monthlyFeeCents: cents, active: activeInput });
      loadBilling(); showToast('Billing saved ✓');
    } catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); }
  }
  async function issueInvoice() {
    setBusy(true);
    try { await api.post(`/platform/companies/${id}/invoices`, { period }); loadBilling(); showToast(`Invoice issued for ${period}`); }
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
  /** Platform → bu sirketin yonetim isyerine gir: uyeligi aktif yap (token'i tenant'a scope et) ve /admin'e gec. */
  async function enterWorkspace() {
    if (!company) return;
    const session = getSession();
    if (!session) { router.replace('/login'); return; }
    const membership = membershipForTenant(session, company.id);
    if (!membership) {
      setEnterMsg('You have no membership in this company yet, so its workspace can’t be opened.');
      return;
    }
    setEntering(true); setEnterMsg('');
    try {
      const res = await switchTenant(membership.id);
      applyTenantSwitch(res.accessToken, res.activeMembershipId);
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
          <Badge variant={company.status === 'active' ? 'success' : 'secondary'}>{company.status}</Badge>
          <Button size="sm" onClick={enterWorkspace} disabled={entering}>
            {entering ? 'Opening…' : 'Enter workspace →'}
          </Button>
          <Button variant="ghost" size="sm" className={company.status === 'active' ? 'text-destructive hover:text-destructive' : ''} onClick={() => setConfirmStatus(true)} disabled={busy}>
            {company.status === 'active' ? 'Suspend' : 'Reactivate'}
          </Button>
        </div>
      </div>
      {enterMsg && <div className="error" style={{ marginTop: 10 }}>{enterMsg}</div>}

      <div className="stat-grid fade-in delay-1" style={{ margin: '18px 0' }}>
        <Kpi label="Members" value={`${company.kpis.activeMembers} / ${company.kpis.members}`} icon="⬡" hint="active / total" />
        <Kpi label="Revenue this month" value={money(company.kpis.revenueThisMonthCents, c)} icon="◆" hint={`${company.kpis.salesThisMonth} approved sales`} />
        <Kpi label="Outstanding payable" value={money(company.kpis.outstandingPayableCents, c)} icon="◷" hint="awaiting payout" />
        <Kpi label="Plan" value={company.plan ? bps(company.plan.poolRateBps) : '—'} icon="◇" hint={company.plan ? `${company.plan.name} · depth ${company.plan.depth}` : 'no plan'} />
      </div>

      {/* ---- Billing (C2 — manuel, Stripe yok) ---- */}
      <Card className="fade-in delay-2" style={{ marginBottom: 20 }}>
        <div className="spread" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <strong style={{ fontSize: 15 }}>Billing</strong>
            <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>Subscription fee for this company. Payments are tracked manually (no card on file) — issue an invoice, mark it paid when the check/wire arrives.</div>
          </div>
          <span className="faint" style={{ fontSize: 12, textAlign: 'right' }}>Outstanding<br /><strong style={{ color: Number(billing?.outstandingCents ?? 0) > 0 ? 'var(--gold-600)' : 'var(--text)' }}>{money(billing?.outstandingCents ?? '0', c)}</strong></span>
        </div>

        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
          <div className="field" style={{ margin: 0 }}>
            <Label htmlFor="billing-fee" className="mb-1.5 block">Monthly fee ({c})</Label>
            <Input id="billing-fee" className="h-9" value={feeInput} onChange={(e) => setFeeInput(e.target.value)} inputMode="decimal" placeholder="99.00" style={{ maxWidth: 130 }} />
          </div>
          <label className="row" style={{ gap: 6, fontSize: 13, alignItems: 'center', paddingBottom: 8 }}>
            <input type="checkbox" checked={activeInput} onChange={(e) => setActiveInput(e.target.checked)} /> Active
          </label>
          <Button size="sm" onClick={saveBilling} disabled={busy}>Save</Button>
          <span style={{ flex: 1 }} />
          <div className="field" style={{ margin: 0 }}>
            <Label htmlFor="billing-period" className="mb-1.5 block">Issue invoice</Label>
            <Input id="billing-period" className="h-9" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-06" style={{ maxWidth: 110 }} />
          </div>
          <Button variant="ghost" size="sm" onClick={issueInvoice} disabled={busy || !billing?.config?.active}>+ Issue</Button>
        </div>

        <Card style={{ background: 'var(--panel-2)', padding: 0, overflowX: 'auto' }}>
          <table aria-label="Invoice history">
            <thead><tr><th>Period</th><th>Amount</th><th>Status</th><th>Due</th><th>Paid</th><th></th></tr></thead>
            <tbody>
              {(billing?.invoices ?? []).map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.period}</td>
                  <td className="tnum">{money(inv.amountCents, inv.currency)}</td>
                  <td><Badge variant={INV_VARIANT[inv.status]}>{inv.status}</Badge>{inv.paidNote && <span className="faint" style={{ fontSize: 11, marginLeft: 6 }}>{inv.paidNote}</span>}</td>
                  <td className="muted">{inv.dueAt ? dateShort(inv.dueAt) : '—'}</td>
                  <td className="muted">{inv.paidAt ? dateShort(inv.paidAt) : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {inv.status === 'open' && <>
                      <Button variant="success" size="sm" onClick={() => openMarkPaid(inv)} disabled={busy}>Mark paid</Button>{' '}
                      <Button variant="ghost" size="sm" onClick={() => voidInvoice(inv)} disabled={busy}>Void</Button>
                    </>}
                  </td>
                </tr>
              ))}
              {!billing && <tr><td colSpan={6} className="muted">Loading…</td></tr>}
              {billing && billing.invoices.length === 0 && <tr><td colSpan={6} className="muted">No invoices yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      </Card>

      <Card className="fade-in delay-2" style={{ marginBottom: 20 }}>
        <div className="spread" style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 15 }}>Referral network</strong>
          <span className="faint" style={{ fontSize: 12 }}>Tree / list · drill into anyone</span>
        </div>
        {!nodes ? <Loading rows={4} /> : <NetworkExplorer nodes={nodes} title={company.name} />}
      </Card>

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
      {payInvoice && (
        <Modal title={`Mark ${payInvoice.period} invoice paid`} onClose={() => setPayInvoice(null)}>
          <div style={{ width: 'min(420px, 100%)' }}>
            <p className="muted" style={{ marginTop: 0 }}>{money(payInvoice.amountCents, payInvoice.currency)} — record how it was paid (optional).</p>
            <div className="field">
              <Label htmlFor="pay-note" className="mb-1.5 block">Payment reference</Label>
              <Input id="pay-note" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="check #1234 / wire ref" autoFocus />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <Button variant="ghost" onClick={() => setPayInvoice(null)} disabled={busy}>Cancel</Button>
              <Button variant="success" onClick={doMarkPaid} disabled={busy}>{busy ? '…' : 'Mark paid'}</Button>
            </div>
          </div>
        </Modal>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
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
