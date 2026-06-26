'use client';

import { CSSProperties, FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, Toggle, useToast } from '@/components/ui';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Settings {
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  maturationRule: 'on_approval' | 'on_delivery' | 'days_after_approval' | 'days_after_delivery';
  maturationDays: number | null;
  payoutMinCents: string;
  notifyNewMemberName: boolean;
  compressionEnabled: boolean;
  inactiveMembersEarn: boolean;
  requireSeparateApprover: boolean;
  requireKycForPayout: boolean;
  requirePayoutApproval: boolean;
  autoRequestPayouts: boolean;
}

const MATURATION = [
  { v: 'on_approval', l: 'On approval — payable immediately' },
  { v: 'on_delivery', l: 'On delivery — matures after delivery' },
  { v: 'days_after_approval', l: 'N days after approval' },
  { v: 'days_after_delivery', l: 'N days after delivery (return window)' },
];
const USES_DAYS = (r: string) => r === 'days_after_approval' || r === 'days_after_delivery';

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
];

// Shared section heading: display font, consistent size/weight across all settings cards.
const SECTION_TITLE: CSSProperties = {
  fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, letterSpacing: '-.01em', margin: 0,
};

export default function General() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Settings>('/admin/settings').then(setS).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    setBusy(true); setError('');
    try {
      const res = await api.patch<Settings>('/admin/settings', {
        maturationRule: s.maturationRule,
        maturationDays: USES_DAYS(s.maturationRule) ? Number(s.maturationDays ?? 0) : null,
        payoutMinCents: Number(s.payoutMinCents),
        timezone: s.timezone,
        notifyNewMemberName: s.notifyNewMemberName,
        compressionEnabled: s.compressionEnabled,
        inactiveMembersEarn: s.inactiveMembersEarn,
        requireSeparateApprover: s.requireSeparateApprover,
        requireKycForPayout: s.requireKycForPayout,
        requirePayoutApproval: s.requirePayoutApproval,
        autoRequestPayouts: s.autoRequestPayouts,
      });
      setS(res);
      showToast('Settings saved ✓');
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  if (error && !s) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;
  if (!s) return <Loading rows={4} />;

  return (
    <form className="grid" onSubmit={save} style={{ gap: 18, maxWidth: 620 }}>
      <div className="card">
        <h2 style={SECTION_TITLE}>Workspace</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 14, marginTop: 12 }}>
          <Read label="Business name" value={s.name} />
          <Read label="Workspace slug" value={s.slug} />
          <Read label="Currency" value={s.currency} />
          <div className="field" style={{ margin: 0 }}>
            <label>Time zone</label>
            <Select value={s.timezone} onValueChange={(v) => setS({ ...s, timezone: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(TIMEZONES.includes(s.timezone) ? TIMEZONES : [s.timezone, ...TIMEZONES]).map((tz) => (
                  <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={SECTION_TITLE}>Commissions &amp; payouts</h2>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Commission maturation rule</label>
          <Select value={s.maturationRule} onValueChange={(v) => setS({ ...s, maturationRule: v as Settings['maturationRule'] })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MATURATION.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {USES_DAYS(s.maturationRule) && (
          <div className="field">
            <label>Days (N){s.maturationRule === 'days_after_delivery' ? ' — return window' : ''}</label>
            <input type="number" min={0} max={365} value={s.maturationDays ?? 0} onChange={(e) => setS({ ...s, maturationDays: Number(e.target.value) })} />
          </div>
        )}
        <div className="field">
          <label>Payout threshold — currently <span className="tnum">{money(s.payoutMinCents, s.currency)}</span></label>
          <input type="number" min={0} step="0.01" value={Number(s.payoutMinCents) / 100} onChange={(e) => setS({ ...s, payoutMinCents: String(Math.round(Number(e.target.value) * 100)) })} />
        </div>
      </div>

      <div className="card">
        <h2 style={SECTION_TITLE}>Policy &amp; privacy</h2>
        <div style={{ marginTop: 4 }}>
          <Toggle label="Require a verified payout profile (KYC) before paying members" checked={s.requireKycForPayout} onChange={(v) => setS({ ...s, requireKycForPayout: v })} />
          <Toggle label="Maker-checker — a payout run must be approved by a second admin (4-eyes)" checked={s.requirePayoutApproval} onChange={(v) => setS({ ...s, requirePayoutApproval: v })} />
          <Toggle label="Auto-request payouts — nightly, create a check request for members who reach the threshold (admin still approves)" checked={s.autoRequestPayouts} onChange={(v) => setS({ ...s, autoRequestPayouts: v })} />
          <Toggle label="Separation of duties — the seller can't approve their own sale (maker-checker)" checked={s.requireSeparateApprover} onChange={(v) => setS({ ...s, requireSeparateApprover: v })} />
          <Toggle label="Show member name in join notifications" checked={s.notifyNewMemberName} onChange={(v) => setS({ ...s, notifyNewMemberName: v })} />
          <Toggle label="Inactive members keep earning commissions" checked={s.inactiveMembersEarn} onChange={(v) => setS({ ...s, inactiveMembersEarn: v })} />
          <Toggle label="Compression — skip inactive uplines (advanced)" checked={s.compressionEnabled} onChange={(v) => setS({ ...s, compressionEnabled: v })} />
        </div>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="row"><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </form>
  );
}

function Read({ label, value }: { label: string; value: string }) {
  return (
    <div className="field" style={{ margin: 0 }}>
      <label>{label}</label>
      <input value={value} disabled />
    </div>
  );
}

function money(cents: string, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents) / 100);
}
