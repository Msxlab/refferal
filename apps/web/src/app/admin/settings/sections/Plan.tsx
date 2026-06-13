'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';

interface PlanBonus { planName: string | null; fastStartBps: number; fastStartDays: number; matchingBps: number }

export default function Plan() {
  const [p, setP] = useState<PlanBonus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

  useEffect(() => {
    api.get<PlanBonus>('/admin/settings/plan-bonus').then(setP).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  async function save() {
    if (!p) return;
    setBusy(true); setError('');
    try {
      const res = await api.post<PlanBonus>('/admin/settings/plan-bonus', { fastStartBps: p.fastStartBps, fastStartDays: p.fastStartDays, matchingBps: p.matchingBps });
      setP(res); showToast('Plan bonuses saved ✓');
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  if (error && !p) return <div className="error">{error}</div>;
  if (!p) return <Loading rows={3} />;

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <strong style={{ fontSize: 14 }}>Plan bonus layers (MLM)</strong>
      <div className="faint" style={{ fontSize: 12, marginBottom: 14 }}>Extra payouts to the direct sponsor, on top of the base unilevel plan{p.planName ? ` — “${p.planName}”` : ''}. Set 0 to disable.</div>

      <div className="card" style={{ background: 'var(--panel-2)', padding: 14, marginBottom: 12 }}>
        <strong style={{ fontSize: 13 }}>⚡ Fast-start bonus</strong>
        <div className="faint" style={{ fontSize: 11, marginBottom: 8 }}>Direct sponsor earns this % of a new member&apos;s sale, if the sale is within the window after they joined.</div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field" style={{ margin: 0 }}><label>Rate (%)</label><input type="number" step="0.01" min={0} value={p.fastStartBps / 100} onChange={(e) => setP({ ...p, fastStartBps: Math.round(Number(e.target.value) * 100) })} /></div>
          <div className="field" style={{ margin: 0 }}><label>Window (days)</label><input type="number" min={0} max={365} value={p.fastStartDays} onChange={(e) => setP({ ...p, fastStartDays: Number(e.target.value) })} /></div>
        </div>
      </div>

      <div className="card" style={{ background: 'var(--panel-2)', padding: 14, marginBottom: 12 }}>
        <strong style={{ fontSize: 13 }}>🤝 Sponsor matching bonus</strong>
        <div className="faint" style={{ fontSize: 11, marginBottom: 8 }}>Direct sponsor earns this % of the seller&apos;s own (level-0) commission on every sale.</div>
        <div className="field" style={{ margin: 0, maxWidth: 200 }}><label>Match rate (%)</label><input type="number" step="0.01" min={0} value={p.matchingBps / 100} onChange={(e) => setP({ ...p, matchingBps: Math.round(Number(e.target.value) * 100) })} /></div>
      </div>

      {error && <div className="error">{error}</div>}
      <div className="row"><button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save plan bonuses'}</button></div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
