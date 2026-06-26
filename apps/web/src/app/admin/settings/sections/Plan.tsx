'use client';

import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { money, levelLabel } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';

// Shared section heading: display font, consistent size/weight across settings cards.
const SECTION_TITLE: CSSProperties = {
  fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, letterSpacing: '-.01em', margin: 0,
};

interface PlanBonus { planName: string | null; fastStartBps: number; fastStartDays: number; matchingBps: number }
interface PlanLevel { level: number; rateBps: number }
interface PlanVersion { id: string; name: string; poolRateBps: number; depth: number; effectiveFrom: string; active: boolean; levels: PlanLevel[] }
interface PlanList { activeId: string | null; plans: PlanVersion[] }

const PREVIEW_CENTS = 100_000; // $1,000 ornek satis

export default function Plan() {
  const [p, setP] = useState<PlanBonus | null>(null);
  const [list, setList] = useState<PlanList | null>(null);
  // duzenlenebilir cekirdek plan
  const [name, setName] = useState('');
  const [poolPct, setPoolPct] = useState(0);
  const [levels, setLevels] = useState<{ ratePct: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

  function hydrate(active: PlanVersion | undefined) {
    if (!active) return;
    setName(`${active.name} v${(list?.plans.length ?? 0) + 1}`);
    setPoolPct(active.poolRateBps / 100);
    const byLevel = new Map(active.levels.map((l) => [l.level, l.rateBps]));
    setLevels(Array.from({ length: active.depth }, (_, i) => ({ ratePct: (byLevel.get(i) ?? 0) / 100 })));
  }

  useEffect(() => {
    api.get<PlanBonus>('/admin/settings/plan-bonus').then(setP).catch((e) => setError(String((e as ApiError).message)));
    api.get<PlanList>('/admin/plans').then((l) => { setList(l); hydrate(l.plans.find((x) => x.active) ?? l.plans[0]); }).catch(() => { /* opsiyonel */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const levelSumPct = useMemo(() => levels.reduce((a, l) => a + (Number(l.ratePct) || 0), 0), [levels]);
  const overPool = levelSumPct > poolPct + 1e-9;
  // canli $1,000 dagilim onizlemesi (client-side, kaydedilmemis duzenlemeleri yansitir)
  const preview = useMemo(() => levels.map((l, i) => ({ level: i, amountCents: Math.round((PREVIEW_CENTS * (Number(l.ratePct) || 0)) / 100) })), [levels]);
  const previewTotal = preview.reduce((a, r) => a + r.amountCents, 0);

  async function savePlan() {
    if (overPool) { setError('Level rates total cannot exceed the pool rate.'); return; }
    setSavingPlan(true); setError('');
    try {
      await api.post('/admin/plans', {
        name: name.trim() || 'Plan',
        poolRateBps: Math.round(poolPct * 100),
        depth: levels.length,
        levels: levels.map((l, i) => ({ level: i, rateBps: Math.round((Number(l.ratePct) || 0) * 100) })),
        // mevcut bonuslari yeni versiyona tasi
        ...(p ? { fastStartBps: p.fastStartBps, fastStartDays: p.fastStartDays, matchingBps: p.matchingBps } : {}),
      });
      showToast('New plan version saved ✓');
      const l = await api.get<PlanList>('/admin/plans'); setList(l); hydrate(l.plans.find((x) => x.active) ?? l.plans[0]);
    } catch (e) { setError(String((e as ApiError).message)); } finally { setSavingPlan(false); }
  }

  async function saveBonus() {
    if (!p) return;
    setBusy(true); setError('');
    try {
      const res = await api.post<PlanBonus>('/admin/settings/plan-bonus', { fastStartBps: p.fastStartBps, fastStartDays: p.fastStartDays, matchingBps: p.matchingBps });
      setP(res); showToast('Plan bonuses saved ✓');
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  if (error && !p && !list) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;
  if (!p || !list) return <Loading rows={3} />;

  return (
    <div className="grid" style={{ gap: 16, maxWidth: 620 }}>
      {/* ---- cekirdek komisyon plani (yuzdeler) ---- */}
      <div className="card">
        <div className="spread" style={{ marginBottom: 10 }}>
          <div>
            <h2 style={SECTION_TITLE}>Commission plan (percentages)</h2>
            <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>Pool rate + each level (tier) %. Saving creates a new <em>version</em>; past sales keep the plan that was effective on their date.</div>
          </div>
          <span className="badge active" style={{ fontSize: 10 }}>{list.plans.length} versions</span>
        </div>

        <div className="row" style={{ gap: 12, alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="field" style={{ flex: 2, margin: 0 }}><label>Version name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2026 plan" /></div>
          <div className="field" style={{ flex: 1, margin: 0 }}><label>Pool rate (%)</label><input type="number" step="0.01" min={0} max={100} value={poolPct} onChange={(e) => setPoolPct(Number(e.target.value))} /></div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Tier</th><th style={{ textAlign: 'right' }}>Rate (%)</th><th style={{ textAlign: 'right' }}>On a $1,000 sale</th><th /></tr></thead>
            <tbody>
              {levels.length === 0 && (
                <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: '20px 0', fontSize: 13 }}>No tiers yet — add a tier to start distributing commission down the upline.</td></tr>
              )}
              {levels.map((l, i) => (
                <tr key={i}>
                  <td>{levelLabel(i)}{i === 0 && <span className="faint" style={{ fontSize: 11 }}> (seller)</span>}</td>
                  <td style={{ textAlign: 'right' }}><input type="number" step="0.01" min={0} max={100} value={l.ratePct} onChange={(e) => setLevels(levels.map((x, j) => j === i ? { ratePct: Number(e.target.value) } : x))} style={{ width: 90, textAlign: 'right' }} /></td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{money(preview[i]?.amountCents ?? 0)}</td>
                  <td style={{ textAlign: 'right' }}>{i === levels.length - 1 && levels.length > 1 && <button className="btn ghost sm" onClick={() => setLevels(levels.slice(0, -1))} title="Remove last tier" aria-label="Remove last tier">✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row spread" style={{ marginTop: 8 }}>
          <button className="btn ghost sm" onClick={() => setLevels([...levels, { ratePct: 0 }])} disabled={levels.length >= 20}>＋ Add tier</button>
          <span className={overPool ? 'badge failed' : 'faint'} style={{ fontSize: 12 }}>
            Levels total {levelSumPct.toFixed(2)}% / pool {poolPct.toFixed(2)}% {overPool ? '— exceeds the pool!' : ''}
          </span>
        </div>
        <Progress
          value={Math.min(100, poolPct > 0 ? (levelSumPct / poolPct) * 100 : 0)}
          aria-label="Share of the pool allocated to levels"
          className={`mt-2 ${overPool ? '[&>div]:bg-destructive' : ''}`}
        />

        <div className="card" style={{ background: 'var(--panel-2)', marginTop: 12, padding: 12 }}>
          <div className="row spread"><span className="faint" style={{ fontSize: 12 }}>Preview: total commission distributed on a $1,000 sale</span><strong className="tnum" style={{ color: 'var(--gold-500)' }}>{money(previewTotal)}</strong></div>
          <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>The remaining {money(PREVIEW_CENTS - previewTotal)} stays with the company (a missing upline level also stays with the company).</div>
        </div>

        {error && <Alert variant="destructive" className="mt-2.5"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="row" style={{ marginTop: 12 }}><button className="btn" onClick={savePlan} disabled={savingPlan || overPool}>{savingPlan ? 'Saving…' : 'Save new version'}</button></div>
      </div>

      {/* ---- bonus katmanlari (mevcut) ---- */}
      <div className="card">
        <h2 style={SECTION_TITLE}>Plan bonus layers (MLM)</h2>
        <div className="faint" style={{ fontSize: 12, marginTop: 4, marginBottom: 14 }}>Extra payouts to the direct sponsor, on top of the base unilevel plan{p.planName ? ` — “${p.planName}”` : ''}. Set 0 to disable.</div>

        <div className="card" style={{ background: 'var(--panel-2)', padding: 14, marginBottom: 12 }}>
          <h3 style={{ ...SECTION_TITLE, fontSize: 13 }}><span aria-hidden>⚡</span> Fast-start bonus</h3>
          <div className="faint" style={{ fontSize: 11, marginBottom: 8 }}>Direct sponsor earns this % of a new member&apos;s sale, if the sale is within the window after they joined.</div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label>Rate (%)</label><input type="number" step="0.01" min={0} value={p.fastStartBps / 100} onChange={(e) => setP({ ...p, fastStartBps: Math.round(Number(e.target.value) * 100) })} /></div>
            <div className="field" style={{ margin: 0 }}><label>Window (days)</label><input type="number" min={0} max={365} value={p.fastStartDays} onChange={(e) => setP({ ...p, fastStartDays: Number(e.target.value) })} /></div>
          </div>
        </div>

        <div className="card" style={{ background: 'var(--panel-2)', padding: 14, marginBottom: 12 }}>
          <h3 style={{ ...SECTION_TITLE, fontSize: 13 }}><span aria-hidden>🤝</span> Sponsor matching bonus</h3>
          <div className="faint" style={{ fontSize: 11, marginBottom: 8 }}>Direct sponsor earns this % of the seller&apos;s own (level-0) commission on every sale.</div>
          <div className="field" style={{ margin: 0, maxWidth: 200 }}><label>Match rate (%)</label><input type="number" step="0.01" min={0} value={p.matchingBps / 100} onChange={(e) => setP({ ...p, matchingBps: Math.round(Number(e.target.value) * 100) })} /></div>
        </div>

        <div className="row"><button className="btn ghost" onClick={saveBonus} disabled={busy}>{busy ? 'Saving…' : 'Save plan bonuses'}</button></div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
