'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, Toggle, useToast } from '@/components/ui';
import { t } from '@/lib/i18n';

interface Settings {
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  maturationRule: 'on_approval' | 'on_delivery' | 'days_after_approval';
  maturationDays: number | null;
  payoutMinCents: string;
  notifyNewMemberName: boolean;
  compressionEnabled: boolean;
  inactiveMembersEarn: boolean;
  requireSeparateApprover: boolean;
}

const MATURATION = [
  { v: 'on_approval', l: 'Onayda (hemen odenebilir)' },
  { v: 'on_delivery', l: 'Teslimde (teslim sonrasi olgunlasir)' },
  { v: 'days_after_approval', l: 'Onaydan N gun sonra' },
];

export default function SettingsPage() {
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
        maturationDays: s.maturationRule === 'days_after_approval' ? Number(s.maturationDays ?? 0) : null,
        payoutMinCents: Number(s.payoutMinCents),
        timezone: s.timezone,
        notifyNewMemberName: s.notifyNewMemberName,
        compressionEnabled: s.compressionEnabled,
        inactiveMembersEarn: s.inactiveMembersEarn,
        requireSeparateApprover: s.requireSeparateApprover,
      });
      setS(res);
      showToast('Ayarlar kaydedildi ✓');
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  if (error && !s) return <div className="error">{error}</div>;
  if (!s) return <Loading rows={4} />;

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.settings')}</div>
      <h1 className="h1 fade-in">Isletme ayarlari</h1>
      <p className="sub fade-in">Olgunlasma kurali, odeme esigi ve gizlilik tercihleri.</p>

      <form className="card fade-in delay-1" onSubmit={save} style={{ maxWidth: 560 }}>
        <div className="field">
          <label>Komisyon olgunlasma kurali</label>
          <select value={s.maturationRule} onChange={(e) => setS({ ...s, maturationRule: e.target.value as Settings['maturationRule'] })}>
            {MATURATION.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
          </select>
        </div>

        {s.maturationRule === 'days_after_approval' && (
          <div className="field">
            <label>Gun sayisi (N)</label>
            <input type="number" min={0} max={365} value={s.maturationDays ?? 0} onChange={(e) => setS({ ...s, maturationDays: Number(e.target.value) })} />
          </div>
        )}

        <div className="field">
          <label>Odeme esigi (cent) — su an {money(s.payoutMinCents, s.currency)}</label>
          <input type="number" min={0} value={s.payoutMinCents} onChange={(e) => setS({ ...s, payoutMinCents: e.target.value })} />
        </div>

        <div className="field">
          <label>Zaman dilimi</label>
          <input value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} />
        </div>

        <Toggle label="Gorevler ayrimi: satisi giren onaylayamasin (maker-checker)" checked={s.requireSeparateApprover} onChange={(v) => setS({ ...s, requireSeparateApprover: v })} />
        <Toggle label="Yeni katilim bildiriminde uye adini goster" checked={s.notifyNewMemberName} onChange={(v) => setS({ ...s, notifyNewMemberName: v })} />
        <Toggle label="Pasif uye komisyon almaya devam etsin" checked={s.inactiveMembersEarn} onChange={(v) => setS({ ...s, inactiveMembersEarn: v })} />
        <Toggle label="Compression (pasifi atla) — gelismis" checked={s.compressionEnabled} onChange={(v) => setS({ ...s, compressionEnabled: v })} />

        {error && <div className="error">{error}</div>}
        <button className="btn" style={{ marginTop: 8 }} disabled={busy}>{busy ? t('common.loading') : t('common.save')}</button>
      </form>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function money(cents: string, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents) / 100);
}
