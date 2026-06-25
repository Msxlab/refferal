'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Loading, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

interface Settings {
  currency: string;
  payoutMinCents: string;
}

const METHODS = [
  { title: 'Manual payout', desc: 'Mark payouts paid after external bank transfer.', state: 'active' },
  { title: 'CSV batch export', desc: 'Download paid payout rows for bank operations.', state: 'active' },
  { title: 'Stripe payout', desc: 'Reserved for a future connected-account integration.', state: 'planned' },
] as const;

export default function Payments() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  useEffect(() => {
    api.get<Settings>('/admin/settings').then(setSettings).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError('');
    try {
      const next = await api.patch<Settings>('/admin/settings', {
        payoutMinCents: Number(settings.payoutMinCents),
      });
      setSettings(next);
      showToast('Payment settings saved');
    } catch (e) {
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  if (error && !settings) return <div className="error">{error}</div>;
  if (!settings) return <Loading rows={4} />;

  return (
    <form className="grid" onSubmit={save} style={{ gap: 18, maxWidth: 720 }}>
      <div className="card">
        <strong style={{ fontSize: 14 }}>Payout threshold</strong>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Minimum payable balance - currently {money(settings.payoutMinCents, settings.currency)}</label>
          <input
            type="number"
            min={0}
            value={settings.payoutMinCents}
            onChange={(e) => setSettings({ ...settings, payoutMinCents: e.target.value })}
          />
        </div>
      </div>

      <section>
        <strong style={{ fontSize: 15 }}>Payout methods</strong>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12, marginTop: 12 }}>
          {METHODS.map((method) => (
            <div className="card" style={{ padding: 15 }} key={method.title}>
              <div className="spread">
                <strong style={{ fontSize: 13.5 }}>{method.title}</strong>
                <span className={`badge ${method.state === 'active' ? 'active' : 'pending'}`} style={{ fontSize: 9 }}>
                  {method.state}
                </span>
              </div>
              <div className="faint" style={{ fontSize: 12, marginTop: 7, lineHeight: 1.5 }}>{method.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {error && <div className="error">{error}</div>}
      <div className="row"><button className="btn" disabled={busy}>{busy ? 'Saving...' : 'Save payment settings'}</button></div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </form>
  );
}

function money(cents: string, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents) / 100);
}
