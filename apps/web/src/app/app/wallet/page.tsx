'use client';

import { FormEvent, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Confirm, Loading, Modal, MoneyCounter, Pagination, useToast } from '@/components/ui';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

// uye-dostu cek durumu: etiket + rozet varyanti + aciklama
type BadgeVariant = 'default' | 'secondary' | 'success' | 'destructive';
const CHECK_STATUS: Record<CheckStatus, { label: string; variant: BadgeVariant; hint: string }> = {
  pending_review: { label: 'Pending review', variant: 'default', hint: 'Your company is reviewing this payout.' },
  approved: { label: 'Preparing check', variant: 'default', hint: 'Approved — your check is being prepared.' },
  printed: { label: 'Check ready', variant: 'default', hint: 'Your check has been printed and will be mailed shortly.' },
  mailed: { label: 'Mailed', variant: 'success', hint: 'Your check was mailed to the address on your account.' },
  paid: { label: 'Paid', variant: 'success', hint: 'This payout was completed.' },
  declined: { label: 'Declined', variant: 'secondary', hint: 'This payout request was not approved.' },
};
const LEDGER_VARIANT: Record<string, BadgeVariant> = {
  paid: 'success', payable: 'default', pending: 'default', reversed: 'destructive',
};

const TYPES = ['', 'commission', 'reversal', 'adjustment'] as const;
const STATUSES = ['', 'pending', 'payable', 'paid', 'reversed'] as const;

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [history, setHistory] = useState<PayoutReq[]>([]);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
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
      setConfirmOpen(false);
      showToast('Your payout request has been received ✓');
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  if (error && !wallet) return <div className="text-destructive text-sm my-2">{error}</div>;
  if (!wallet) return <Loading />;
  const b = wallet.balance;
  const c = wallet.currency;
  const payable = Number(b.payableCents);
  const min = Number(wallet.payoutMinCents);
  const reached = payable >= min && payable > 0;
  const pct = min > 0 ? Math.min(100, (payable / min) * 100) : 100;
  const remaining = Math.max(0, min - payable);
  const receivedCents = history.filter((p) => p.checkStatus === 'mailed' || p.checkStatus === 'paid').reduce((a, p) => a + Number(p.totalCents), 0);
  const receivedCount = history.filter((p) => p.checkStatus === 'mailed' || p.checkStatus === 'paid').length;
  const inProgress = history.filter((p) => ['pending_review', 'approved', 'printed'].includes(p.checkStatus)).length;

  return (
    <div>
      <div className="fade-in text-[11px] font-bold uppercase tracking-[0.14em] text-primary">{t('anav.wallet')}</div>
      <h1 className="fade-in mb-1.5 font-display text-2xl font-bold tracking-tight">Your Wallet</h1>
      <p className="fade-in mb-5 text-sm text-muted-foreground">Track your payable balance and request a payout.</p>

      <Card className="fade-in delay-1 relative overflow-hidden p-5">
        <span aria-hidden className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[var(--gold-600)] to-transparent opacity-60" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">{t('me.payable')} balance</div>
            <div className="gradient-text mt-1.5 font-display text-3xl font-extrabold tracking-tight">
              <MoneyCounter cents={b.payableCents} currency={c} />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {t('me.pending')}: <b className="tnum text-foreground">{money(b.pendingCents, c)}</b> · {t('me.paid')}:{' '}
              <b className="tnum text-foreground">{money(b.paidCents, c)}</b>
            </div>
          </div>
          <Button variant="success" onClick={() => setConfirmOpen(true)} disabled={busy || !reached}>{t('me.requestPayout')}</Button>
        </div>

        {/* esik ilerleme cubugu */}
        <div className="mt-[18px]">
          <div className="h-[9px] overflow-hidden rounded-md bg-muted">
            <div
              className="h-full rounded-md transition-[width] duration-700 ease-[cubic-bezier(.2,.9,.3,1)]"
              style={{ width: `${pct}%`, background: reached ? 'var(--grad-emerald, var(--emerald))' : 'var(--grad-primary)' }}
            />
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            {reached
              ? <span className="font-medium text-[color:var(--emerald)]">✓ Threshold reached — you can request a payout.</span>
              : <>{money(remaining, c)} to go until the {money(min, c)} payout threshold.</>}
          </div>
        </div>
        {error && <div className="mt-2.5 text-sm text-destructive">{error}</div>}
      </Card>

      {/* guven — odeme nasil isliyor seffafligi */}
      <Card className="fade-in delay-1 mt-4 p-5">
        <strong className="mb-3.5 block text-[15px]">How you get paid</strong>
        <div className="grid gap-3.5">
          {[
            { n: 1, t: 'Record a sale', d: 'Log your sale — your company reviews and approves it.' },
            { n: 2, t: 'Commission is credited', d: 'Once approved, your commission is calculated and added to your balance automatically.' },
            { n: 3, t: 'Reach the threshold', d: `When your balance reaches ${money(min, c)}, a payout is requested (you, or automatically).` },
            { n: 4, t: 'A check is mailed to you', d: 'After your company approves it, a check is printed and mailed to your address on file. Track it under “Your checks” below.' },
          ].map((s, i, arr) => (
            <div key={s.n} className="flex items-start gap-3">
              <div className="flex flex-col items-center self-stretch">
                <span className="grid h-[26px] w-[26px] flex-shrink-0 place-items-center rounded-full bg-[var(--foil)] text-[13px] font-extrabold text-[color:var(--on-gold)]">{s.n}</span>
                {i < arr.length - 1 && <span className="mt-1 w-0.5 flex-1 bg-border" />}
              </div>
              <div className={i < arr.length - 1 ? 'pb-1' : ''}>
                <div className="text-[13.5px] font-semibold">{s.t}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.d}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3.5 border-t border-border pt-3 text-[11.5px] leading-relaxed text-muted-foreground">
          🔒 Commissions come from real, approved product sales only. Your company&apos;s books are checked for balance every day.
        </div>
      </Card>

      <PayoutProfileCard />

      <Card className="fade-in delay-2 mt-4 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <strong>{t('me.ledger')}{wallet.ledger.total ? ` · ${wallet.ledger.total}` : ''}</strong>
          <div className="flex items-center gap-2">
            <select value={fType} onChange={(e) => { setFType(e.target.value); setPage(1); }} className="w-auto" aria-label="Type">
              {TYPES.map((v) => <option key={v} value={v}>{v || 'All types'}</option>)}
            </select>
            <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); }} className="w-auto" aria-label="Status">
              {STATUSES.map((v) => <option key={v} value={v}>{v || 'All statuses'}</option>)}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead><tr><th>Date</th><th>Level</th><th>Type</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {wallet.ledger.items.map((e) => (
                <tr key={e.id}>
                  <td className="text-muted-foreground">{dateShort(e.createdAt)}</td>
                  <td>{levelLabel(e.level, true)}</td>
                  <td className="text-muted-foreground">{ledgerTypeLabel(e.type)}</td>
                  <td><Badge variant={LEDGER_VARIANT[e.status] ?? 'secondary'}>{e.status}</Badge></td>
                  <td className="tnum text-right font-semibold" style={Number(e.amountCents) < 0 ? { color: 'var(--rose)' } : undefined}>{money(e.amountCents, c)}</td>
                </tr>
              ))}
              {wallet.ledger.items.length === 0 && <tr><td colSpan={5} className="text-muted-foreground">{t('me.noData')}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={wallet.ledger.page} pageSize={wallet.ledger.pageSize} total={wallet.ledger.total} onPage={setPage} />
      </Card>

      <Card className="fade-in delay-3 mt-4 p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <strong>Your checks</strong>
          {history.length > 0 && (
            <span className="text-right text-xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-[color:var(--emerald)]">{money(receivedCents, c)}</span> received
              {receivedCount ? ` · ${receivedCount} check${receivedCount === 1 ? '' : 's'} mailed` : ''}
              {inProgress ? <><br />{inProgress} on the way</> : null}
            </span>
          )}
        </div>
        <p className="-mt-1 mb-3 text-xs text-muted-foreground">
          Checks are mailed to your account address once approved. Keep your <a href="/account" className="text-primary">mailing address</a> up to date.
        </p>
        <div className="overflow-x-auto rounded-xl bg-secondary">
          <table>
            <thead><tr><th>Period</th><th>Amount</th><th>Status</th><th>Check&nbsp;#</th><th>Date</th></tr></thead>
            <tbody>
              {history.map((p) => {
                const cs = CHECK_STATUS[p.checkStatus] ?? CHECK_STATUS.paid;
                return (
                  <tr key={p.id}>
                    <td>{p.period}</td>
                    <td className="tnum">{money(p.totalCents, c)}</td>
                    <td><Badge variant={cs.variant} title={cs.hint}>{cs.label}</Badge></td>
                    <td className="tnum text-muted-foreground">{p.checkNumber ?? '—'}</td>
                    <td className="text-muted-foreground">{p.mailedAt ? dateShort(p.mailedAt) : dateShort(p.paidAt)}</td>
                  </tr>
                );
              })}
              {history.length === 0 && <tr><td colSpan={5} className="text-muted-foreground">{t('me.noData')}</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {confirmOpen && (
        <Confirm
          title="Request payout"
          message={`Request a payout of ${money(b.payableCents, c)}? Your payable balance will be locked and a check will be mailed to your address on file after your company approves it.`}
          confirmLabel={busy ? 'Requesting…' : 'Request payout'}
          busy={busy}
          onConfirm={requestPayout}
          onClose={() => setConfirmOpen(false)}
        />
      )}

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
const PROFILE_BADGE: Record<string, BadgeVariant> = { verified: 'success', pending_review: 'default', rejected: 'destructive', unverified: 'secondary' };
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
    <Card className="fade-in delay-2 mt-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <strong>Payout profile</strong>
          <div className="mt-0.5 text-xs text-muted-foreground">Verified bank details are required to get paid (when your company enables it).</div>
        </div>
        <Badge variant={PROFILE_BADGE[status]}>{STATUS_LABEL[status]}</Badge>
      </div>
      {p ? (
        <div className="mt-3.5 flex flex-wrap gap-6">
          <Detail label="Legal name" value={p.legalName} />
          <Detail label="Tax ID" value={`${p.taxIdType.toUpperCase()} ••••${p.taxIdLast4}`} />
          <Detail label="Bank" value={`${p.bankName ? p.bankName + ' · ' : ''}${p.accountType} ••••${p.accountLast4}`} />
          <Detail label="Routing" value={p.routingNumber} />
        </div>
      ) : (
        <div className="mt-3 text-sm text-muted-foreground">You haven&apos;t added your payout details yet.</div>
      )}
      {p?.status === 'rejected' && p.rejectionReason && <div className="mt-2.5 text-sm text-destructive">Rejected: {p.rejectionReason}</div>}
      <div className="mt-3.5">
        <Button variant="ghost" size="sm" onClick={() => setEdit(true)}>{p ? 'Edit payout details' : 'Set up payout details'}</Button>
      </div>
      {edit && <ProfileForm existing={p} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); showToast('Submitted for verification'); void load(); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </Card>
  );
}

function ProfileForm({ existing, onClose, onSaved }: { existing: PayoutProfile | null; onClose: () => void; onSaved: () => void }) {
  const uid = useId();
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
      <form onSubmit={submit} className="w-full">
        <div className="mb-3.5">
          <Label htmlFor={`${uid}-name`} className="mb-1.5 block">Legal name (as on tax documents)</Label>
          <Input id={`${uid}-name`} value={legalName} onChange={(e) => setLegalName(e.target.value)} required autoFocus />
        </div>
        <div className="grid grid-cols-[1fr_2fr] gap-2.5">
          <div>
            <Label htmlFor={`${uid}-taxtype`} className="mb-1.5 block">Tax ID type</Label>
            <select id={`${uid}-taxtype`} value={taxIdType} onChange={(e) => setTaxIdType(e.target.value as 'ssn' | 'ein')}><option value="ssn">SSN</option><option value="ein">EIN</option></select>
          </div>
          <div>
            <Label htmlFor={`${uid}-taxid`} className="mb-1.5 block">Tax ID (9 digits){existing ? ' — re-enter to update' : ''}</Label>
            <Input id={`${uid}-taxid`} value={taxId} onChange={(e) => setTaxId(e.target.value)} inputMode="numeric" placeholder="123456789" required />
          </div>
        </div>
        <div className="mt-3.5">
          <Label htmlFor={`${uid}-bank`} className="mb-1.5 block">Bank name (optional)</Label>
          <Input id={`${uid}-bank`} value={bankName} onChange={(e) => setBankName(e.target.value)} />
        </div>
        <div className="mt-3.5 grid grid-cols-2 gap-2.5">
          <div>
            <Label htmlFor={`${uid}-routing`} className="mb-1.5 block">Routing number (9 digits)</Label>
            <Input id={`${uid}-routing`} value={routingNumber} onChange={(e) => setRoutingNumber(e.target.value)} inputMode="numeric" required />
          </div>
          <div>
            <Label htmlFor={`${uid}-acctype`} className="mb-1.5 block">Account type</Label>
            <select id={`${uid}-acctype`} value={accountType} onChange={(e) => setAccountType(e.target.value as 'checking' | 'savings')}><option value="checking">Checking</option><option value="savings">Savings</option></select>
          </div>
        </div>
        <div className="mt-3.5">
          <Label htmlFor={`${uid}-accnum`} className="mb-1.5 block">Account number{existing ? ' — re-enter to update' : ''}</Label>
          <Input id={`${uid}-accnum`} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} inputMode="numeric" placeholder="account number" required />
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">We store only the last 4 digits. Changing these details restarts verification and a short security hold.</div>
        {err && <div className="mt-2 text-sm text-destructive">{err}</div>}
        <div className="mt-3.5 flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit for verification'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[13.5px]">{value}</div>
    </div>
  );
}
