'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, Modal, MoneyCounter, Pagination, useToast } from '@/components/ui';
import { dateShort, money, levelLabel, ledgerTypeLabel } from '@/lib/format';
import { t } from '@/lib/i18n';

interface LedgerItem {
  id: string;
  level: number;
  amountCents: string;
  type: string;
  status: string;
  createdAt: string;
}
interface Wallet {
  currency: string;
  payoutMinCents: string;
  balance: { pendingCents: string; payableCents: string; paidCents: string };
  ledger: { total: number; page: number; pageSize: number; items: LedgerItem[] };
}
type CheckStatus = 'pending_review' | 'approved' | 'printed' | 'mailed' | 'paid' | 'declined';
interface PayoutReq {
  id: string; totalCents: string; status: string; period: string; paidAt: string | null;
  checkNumber: number | null; mailedAt: string | null; checkStatus: CheckStatus;
}

// uye-dostu cek durumu: etiket + rozet sinifi + aciklama
const CHECK_STATUS: Record<CheckStatus, { label: string; cls: string; hint: string }> = {
  pending_review: { label: 'Pending review', cls: 'pending', hint: 'Your company is reviewing this payout.' },
  approved: { label: 'Preparing check', cls: 'processing', hint: 'Approved — your check is being prepared.' },
  printed: { label: 'Check ready', cls: 'processing', hint: 'Your check has been printed and will be mailed shortly.' },
  mailed: { label: 'Mailed', cls: 'active', hint: 'Your check was mailed to the address on your account.' },
  paid: { label: 'Paid', cls: 'active', hint: 'This payout was completed.' },
  declined: { label: 'Declined', cls: 'inactive', hint: 'This payout request was not approved.' },
};

const TYPES = ['', 'commission', 'reversal', 'adjustment'] as const;
const STATUSES = ['', 'pending', 'payable', 'paid', 'reversed'] as const;

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [history, setHistory] = useState<PayoutReq[]>([]);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);
  const [fType, setFType] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [page, setPage] = useState(1);

  const ledgerQuery = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (fType) p.set('type', fType);
    if (fStatus) p.set('status', fStatus);
    return p.toString();
  }, [fType, fStatus, page]);

  const load = useCallback(async () => {
    try {
      const [w, h] = await Promise.all([api.get<Wallet>(`/app/wallet?${ledgerQuery}`), api.get<PayoutReq[]>('/app/payout-requests')]);
      setWallet(w);
      setHistory(h);
    } catch (e) { setError(String((e as ApiError).message)); }
  }, [ledgerQuery]);

  useEffect(() => { void load(); }, [load]);

  async function requestPayout() {
    setBusy(true); setError('');
    try {
      await api.post('/app/payout-requests');
      showToast('Your payout request has been received ✓');
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  if (error && !wallet) return <div className="error">{error}</div>;
  if (!wallet) return <Loading />;
  const b = wallet.balance;
  const c = wallet.currency;
  const payable = Number(b.payableCents);
  const min = Number(wallet.payoutMinCents);
  const reached = payable >= min;
  const pct = min > 0 ? Math.min(100, (payable / min) * 100) : 100;
  const remaining = Math.max(0, min - payable);
  // Faz A4: cek makbuzu ozeti — postalanan/odenen toplam + yolda olan sayisi
  const receivedCents = history.filter((p) => p.checkStatus === 'mailed' || p.checkStatus === 'paid').reduce((a, p) => a + Number(p.totalCents), 0);
  const receivedCount = history.filter((p) => p.checkStatus === 'mailed' || p.checkStatus === 'paid').length;
  const inProgress = history.filter((p) => ['pending_review', 'approved', 'printed'].includes(p.checkStatus)).length;

  return (
    <div>
      <div className="eyebrow fade-in">{t('anav.wallet')}</div>
      <h1 className="h1 fade-in">Your Wallet</h1>
      <p className="sub fade-in">Track your payable balance and request a payout.</p>

      <div className="card hero fade-in delay-1">
        <div className="spread">
          <div>
            <div className="faint" style={{ fontSize: 12 }}>{t('me.payable')} balance</div>
            <div className="bignum gradient-text" style={{ marginTop: 6 }}>
              <MoneyCounter cents={b.payableCents} currency={c} />
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
              {t('me.pending')}: <b className="tnum">{money(b.pendingCents, c)}</b> · {t('me.paid')}:{' '}
              <b className="tnum">{money(b.paidCents, c)}</b>
            </div>
          </div>
          <button className="btn success" onClick={requestPayout} disabled={busy || !reached}>{t('me.requestPayout')}</button>
        </div>

        {/* esik ilerleme cubugu */}
        <div style={{ marginTop: 18 }}>
          <div style={{ height: 9, borderRadius: 6, background: 'rgba(255,255,255,.06)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, borderRadius: 6, background: reached ? 'var(--grad-emerald, var(--emerald))' : 'var(--grad-primary)', transition: 'width .7s cubic-bezier(.2,.9,.3,1)' }} />
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
            {reached
              ? <span style={{ color: 'var(--emerald)' }}>✓ Threshold reached — you can request a payout.</span>
              : <>{money(remaining, c)} to go until the {money(min, c)} payout threshold.</>}
          </div>
        </div>
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      {/* Faz D2: guven — odeme nasil isliyor seffafligi */}
      <div className="card fade-in delay-1" style={{ marginTop: 16 }}>
        <strong style={{ fontSize: 15, display: 'block', marginBottom: 14 }}>How you get paid</strong>
        <div style={{ display: 'grid', gap: 14 }}>
          {[
            { n: 1, t: 'Record a sale', d: 'Log your sale — your company reviews and approves it.' },
            { n: 2, t: 'Commission is credited', d: 'Once approved, your commission is calculated and added to your balance automatically.' },
            { n: 3, t: 'Reach the threshold', d: `When your balance reaches ${money(min, c)}, a payout is requested (you, or automatically).` },
            { n: 4, t: 'A check is mailed to you', d: 'After your company approves it, a check is printed and mailed to your address on file. Track it under “Your checks” below.' },
          ].map((s, i, arr) => (
            <div key={s.n} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', alignSelf: 'stretch' }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--foil)', color: 'var(--on-gold)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{s.n}</span>
                {i < arr.length - 1 && <span style={{ width: 2, flex: 1, background: 'var(--border)', marginTop: 4 }} />}
              </div>
              <div style={{ paddingBottom: i < arr.length - 1 ? 4 : 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{s.t}</div>
                <div className="faint" style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.5 }}>{s.d}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="faint" style={{ fontSize: 11.5, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', lineHeight: 1.5 }}>
          🔒 Commissions come from real, approved product sales only. Your company&apos;s books are checked for balance every day.
        </div>
      </div>

      <PayoutProfileCard />

      <div className="card fade-in delay-2" style={{ marginTop: 16 }}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <strong>{t('me.ledger')}{wallet.ledger.total ? ` · ${wallet.ledger.total}` : ''}</strong>
          <div className="row" style={{ gap: 8 }}>
            <select value={fType} onChange={(e) => { setFType(e.target.value); setPage(1); }} style={{ width: 'auto' }} aria-label="Type">
              {TYPES.map((v) => <option key={v} value={v}>{v || 'All types'}</option>)}
            </select>
            <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); }} style={{ width: 'auto' }} aria-label="Status">
              {STATUSES.map((v) => <option key={v} value={v}>{v || 'All statuses'}</option>)}
            </select>
          </div>
        </div>
        <table>
          <thead><tr><th>Date</th><th>Level</th><th>Type</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            {wallet.ledger.items.map((e) => (
              <tr key={e.id}>
                <td className="muted">{dateShort(e.createdAt)}</td>
                <td>{levelLabel(e.level, true)}</td>
                <td className="faint">{ledgerTypeLabel(e.type)}</td>
                <td><span className={`badge ${e.status}`}>{e.status}</span></td>
                <td className="tnum" style={{ textAlign: 'right', fontWeight: 650, color: Number(e.amountCents) < 0 ? 'var(--rose)' : undefined }}>{money(e.amountCents, c)}</td>
              </tr>
            ))}
            {wallet.ledger.items.length === 0 && <tr><td colSpan={5} className="muted">{t('me.noData')}</td></tr>}
          </tbody>
        </table>
        <Pagination page={wallet.ledger.page} pageSize={wallet.ledger.pageSize} total={wallet.ledger.total} onPage={setPage} />
      </div>

      <div className="card fade-in delay-3" style={{ marginTop: 16 }}>
        <div className="spread" style={{ alignItems: 'flex-start', marginBottom: 12 }}>
          <strong>Your checks</strong>
          {history.length > 0 && (
            <span className="faint" style={{ fontSize: 12, textAlign: 'right', lineHeight: 1.5 }}>
              <span style={{ color: 'var(--emerald)', fontWeight: 600 }}>{money(receivedCents, c)}</span> received
              {receivedCount ? ` · ${receivedCount} check${receivedCount === 1 ? '' : 's'} mailed` : ''}
              {inProgress ? <><br />{inProgress} on the way</> : null}
            </span>
          )}
        </div>
        <p className="faint" style={{ fontSize: 12, marginTop: -4, marginBottom: 12 }}>
          Checks are mailed to your account address once approved. Keep your <a href="/account" style={{ color: 'var(--accent)' }}>mailing address</a> up to date.
        </p>
        <div className="card" style={{ background: 'var(--panel-2)', padding: 0, overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Period</th><th>Amount</th><th>Status</th><th>Check&nbsp;#</th><th>Date</th></tr></thead>
            <tbody>
              {history.map((p) => {
                const cs = CHECK_STATUS[p.checkStatus] ?? CHECK_STATUS.paid;
                return (
                  <tr key={p.id}>
                    <td>{p.period}</td>
                    <td className="tnum">{money(p.totalCents, c)}</td>
                    <td><span className={`badge ${cs.cls}`} title={cs.hint}>{cs.label}</span></td>
                    <td className="muted tnum">{p.checkNumber ?? '—'}</td>
                    <td className="muted">{p.mailedAt ? dateShort(p.mailedAt) : dateShort(p.paidAt)}</td>
                  </tr>
                );
              })}
              {history.length === 0 && <tr><td colSpan={5} className="muted">{t('me.noData')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* --------------------------------------------------- odeme profili (KYC) karti */
interface PayoutProfile {
  legalName: string; country: string; taxIdType: 'ssn' | 'ein'; taxIdLast4: string;
  bankName: string | null; routingNumber: string; accountType: 'checking' | 'savings'; accountLast4: string;
  status: 'unverified' | 'pending_review' | 'verified' | 'rejected'; rejectionReason: string | null;
}
const STATUS_BADGE: Record<string, string> = { verified: 'paid', pending_review: 'pending', rejected: 'failed', unverified: 'draft' };
const STATUS_LABEL: Record<string, string> = { verified: 'Verified', pending_review: 'Pending review', rejected: 'Rejected', unverified: 'Not set up' };

function PayoutProfileCard() {
  const [p, setP] = useState<PayoutProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [edit, setEdit] = useState(false);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try { setP(await api.get<PayoutProfile | null>('/app/payout-profile')); } catch { /* yok */ } finally { setLoaded(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!loaded) return null;
  const status = p?.status ?? 'unverified';

  return (
    <div className="card fade-in delay-2" style={{ marginTop: 16 }}>
      <div className="spread">
        <div>
          <strong>Payout profile</strong>
          <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>Verified bank details are required to get paid (when your company enables it).</div>
        </div>
        <span className={`badge ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>
      </div>
      {p ? (
        <div className="row" style={{ gap: 24, marginTop: 14, flexWrap: 'wrap' }}>
          <Detail label="Legal name" value={p.legalName} />
          <Detail label="Tax ID" value={`${p.taxIdType.toUpperCase()} ••••${p.taxIdLast4}`} />
          <Detail label="Bank" value={`${p.bankName ? p.bankName + ' · ' : ''}${p.accountType} ••••${p.accountLast4}`} />
          <Detail label="Routing" value={p.routingNumber} />
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>You haven&apos;t added your payout details yet.</div>
      )}
      {p?.status === 'rejected' && p.rejectionReason && <div className="error" style={{ marginTop: 10 }}>Rejected: {p.rejectionReason}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn ghost sm" onClick={() => setEdit(true)}>{p ? 'Edit payout details' : 'Set up payout details'}</button>
      </div>
      {edit && <ProfileForm existing={p} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); showToast('Submitted for verification'); void load(); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function ProfileForm({ existing, onClose, onSaved }: { existing: PayoutProfile | null; onClose: () => void; onSaved: () => void }) {
  const [legalName, setLegalName] = useState(existing?.legalName ?? '');
  const [taxIdType, setTaxIdType] = useState<'ssn' | 'ein'>(existing?.taxIdType ?? 'ssn');
  const [taxId, setTaxId] = useState('');
  const [bankName, setBankName] = useState(existing?.bankName ?? '');
  const [routingNumber, setRoutingNumber] = useState(existing?.routingNumber ?? '');
  const [accountType, setAccountType] = useState<'checking' | 'savings'>(existing?.accountType ?? 'checking');
  const [accountNumber, setAccountNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (!/^\d{9}$/.test(taxId)) { setErr('Tax ID must be 9 digits.'); return; }
    if (!/^\d{9}$/.test(routingNumber)) { setErr('Routing number must be 9 digits.'); return; }
    if (!/^\d{4,17}$/.test(accountNumber)) { setErr('Enter a valid account number.'); return; }
    setBusy(true);
    try {
      await api.put('/app/payout-profile', {
        legalName: legalName.trim(), country: 'US', taxIdType, taxId,
        bankName: bankName.trim() || undefined, routingNumber, accountType, accountNumber,
      });
      onSaved();
    } catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  return (
    <Modal title="Payout details" onClose={onClose}>
      <form onSubmit={submit} style={{ width: 'min(460px, 100%)' }}>
        <div className="field"><label>Legal name (as on tax documents)</label><input value={legalName} onChange={(e) => setLegalName(e.target.value)} required autoFocus /></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 2fr', gap: 10 }}>
          <div className="field" style={{ margin: 0 }}><label>Tax ID type</label>
            <select aria-label="Tax ID type" value={taxIdType} onChange={(e) => setTaxIdType(e.target.value as 'ssn' | 'ein')}><option value="ssn">SSN</option><option value="ein">EIN</option></select>
          </div>
          <div className="field" style={{ margin: 0 }}><label>Tax ID (9 digits){existing ? ' — re-enter to update' : ''}</label><input value={taxId} onChange={(e) => setTaxId(e.target.value)} inputMode="numeric" placeholder="123456789" required /></div>
        </div>
        <div className="field"><label>Bank name (optional)</label><input value={bankName} onChange={(e) => setBankName(e.target.value)} /></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field" style={{ margin: 0 }}><label>Routing number (9 digits)</label><input value={routingNumber} onChange={(e) => setRoutingNumber(e.target.value)} inputMode="numeric" required /></div>
          <div className="field" style={{ margin: 0 }}><label>Account type</label>
            <select aria-label="Account type" value={accountType} onChange={(e) => setAccountType(e.target.value as 'checking' | 'savings')}><option value="checking">Checking</option><option value="savings">Savings</option></select>
          </div>
        </div>
        <div className="field"><label>Account number{existing ? ' — re-enter to update' : ''}</label><input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} inputMode="numeric" placeholder="account number" required /></div>
        <div className="faint" style={{ fontSize: 11 }}>We store only the last 4 digits. Changing these details restarts verification and a short security hold.</div>
        {err && <div className="error">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Submitting…' : 'Submit for verification'}</button>
        </div>
      </form>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 13.5, marginTop: 2 }}>{value}</div>
    </div>
  );
}
