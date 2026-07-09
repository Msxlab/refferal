'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, Toggle, useToast } from '@/components/ui';
import { useDirty } from '@/hooks/useDirty';
import { SaveBar } from '@/components/SaveBar';
import { SettingsSection } from '@/components/SettingsSection';

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

export default function General() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);

  // yalniz DUZENLENEBILIR alanlar dirty karsilastirmasina girer (read-only name/slug/currency haric)
  const editable = s && {
    timezone: s.timezone,
    maturationRule: s.maturationRule,
    maturationDays: s.maturationDays,
    payoutMinCents: s.payoutMinCents,
    notifyNewMemberName: s.notifyNewMemberName,
    compressionEnabled: s.compressionEnabled,
    inactiveMembersEarn: s.inactiveMembersEarn,
    requireSeparateApprover: s.requireSeparateApprover,
    requireKycForPayout: s.requireKycForPayout,
    requirePayoutApproval: s.requirePayoutApproval,
    autoRequestPayouts: s.autoRequestPayouts,
  };
  const { dirty, setBaseline } = useDirty(editable ?? null, null);

  useEffect(() => {
    api.get<Settings>('/admin/settings').then((res) => {
      setS(res);
      setBaseline({
        timezone: res.timezone,
        maturationRule: res.maturationRule,
        maturationDays: res.maturationDays,
        payoutMinCents: res.payoutMinCents,
        notifyNewMemberName: res.notifyNewMemberName,
        compressionEnabled: res.compressionEnabled,
        inactiveMembersEarn: res.inactiveMembersEarn,
        requireSeparateApprover: res.requireSeparateApprover,
        requireKycForPayout: res.requireKycForPayout,
        requirePayoutApproval: res.requirePayoutApproval,
        autoRequestPayouts: res.autoRequestPayouts,
      });
    }).catch((e) => setError(String((e as ApiError).message)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setBaseline({
        timezone: res.timezone,
        maturationRule: res.maturationRule,
        maturationDays: res.maturationDays,
        payoutMinCents: res.payoutMinCents,
        notifyNewMemberName: res.notifyNewMemberName,
        compressionEnabled: res.compressionEnabled,
        inactiveMembersEarn: res.inactiveMembersEarn,
        requireSeparateApprover: res.requireSeparateApprover,
        requireKycForPayout: res.requireKycForPayout,
        requirePayoutApproval: res.requirePayoutApproval,
        autoRequestPayouts: res.autoRequestPayouts,
      });
      showToast('Settings saved ✓');
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  function discard() {
    api.get<Settings>('/admin/settings').then((res) => setS(res)).catch((e) => setError(String((e as ApiError).message)));
  }

  if (error && !s) return <div className="error">{error}</div>;
  if (!s) return <Loading rows={4} />;

  return (
    <SettingsSection maxWidth={620}>
      <form className="grid" onSubmit={save} style={{ gap: 18 }}>
      <div className="card">
        <strong style={{ fontSize: 14 }}>Workspace</strong>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 12 }}>
          <Read label="Business name" value={s.name} />
          <Read label="Workspace slug" value={s.slug} />
          <Read label="Currency" value={s.currency} />
          <div className="field" style={{ margin: 0 }}>
            <label>Time zone</label>
            <select value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })}>
              {(TIMEZONES.includes(s.timezone) ? TIMEZONES : [s.timezone, ...TIMEZONES]).map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <strong style={{ fontSize: 14 }}>Commissions & payouts</strong>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Commission maturation rule</label>
          <select value={s.maturationRule} onChange={(e) => setS({ ...s, maturationRule: e.target.value as Settings['maturationRule'] })}>
            {MATURATION.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
          </select>
        </div>
        {USES_DAYS(s.maturationRule) && (
          <div className="field">
            <label>Days (N){s.maturationRule === 'days_after_delivery' ? ' — return window' : ''}</label>
            <input type="number" min={0} max={365} value={s.maturationDays ?? 0} onChange={(e) => setS({ ...s, maturationDays: Number(e.target.value) })} />
          </div>
        )}
        <div className="field">
          <label>Payout threshold — currently {money(s.payoutMinCents, s.currency)}</label>
          <input type="number" min={0} step="0.01" value={Number(s.payoutMinCents) / 100} onChange={(e) => setS({ ...s, payoutMinCents: String(Math.round(Number(e.target.value) * 100)) })} />
        </div>
      </div>

      <div className="card">
        <strong style={{ fontSize: 14 }}>Policy & privacy</strong>
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

      {error && <div className="error">{error}</div>}
      <div className="row"><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
      <SaveBar dirty={dirty} busy={busy} onSave={() => save(new Event('submit') as unknown as FormEvent)} onDiscard={discard} />
      {toast && <div className="toast" role="status">{toast}</div>}
      </form>
    </SettingsSection>
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
