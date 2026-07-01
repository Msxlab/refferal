'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { money, levelLabel } from '@/lib/format';

interface PlanBonus { planName: string | null; fastStartBps: number; fastStartDays: number; matchingBps: number }
interface PlanLevel { level: number; rateBps: number }
interface PlanVersion { id: string; name: string; poolRateBps: number; depth: number; effectiveFrom: string; active: boolean; levels: PlanLevel[] }
interface PlanList { activeId: string | null; plans: PlanVersion[] }

const PREVIEW_CENTS = 100_000; // $1,000 ornek satis

export default function Plan() {
  const uid = useId();
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

  if (error && !p && !list) return <div className="error">{error}</div>;
  if (!p || !list) return <Loading rows={3} />;

  return (
    <div className="grid" style={{ gap: 16, maxWidth: 620 }}>
      {/* ---- cekirdek komisyon plani (yuzdeler) ---- */}
      <Card>
        <div className="spread" style={{ marginBottom: 10 }}>
          <div>
            <strong style={{ fontSize: 14 }}>Commission plan (percentages)</strong>
            <div className="faint" style={{ fontSize: 12 }}>Pool rate + each level (tier) %. Saving creates a new <em>version</em>; past sales keep the plan that was effective on their date.</div>
          </div>
          <Badge variant="success" className="text-[10px]">{list.plans.length} versions</Badge>
        </div>

        <div className="row" style={{ gap: 12, alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="field" style={{ flex: 2, margin: 0 }}><Label htmlFor={`${uid}-name`} className="mb-1.5 block">Version name</Label><Input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2026 plan" /></div>
          <div className="field" style={{ flex: 1, margin: 0 }}><Label htmlFor={`${uid}-pool`} className="mb-1.5 block">Pool rate (%)</Label><Input id={`${uid}-pool`} type="number" step="0.01" min={0} max={100} value={poolPct} onChange={(e) => setPoolPct(Number(e.target.value))} /></div>
        </div>

        <table>
          <thead><tr><th>Tier</th><th style={{ textAlign: 'right' }}>Rate (%)</th><th style={{ textAlign: 'right' }}>On a $1,000 sale</th><th /></tr></thead>
          <tbody>
            {levels.map((l, i) => (
              <tr key={i}>
                <td>{levelLabel(i)}{i === 0 && <span className="faint" style={{ fontSize: 11 }}> (seller)</span>}</td>
                <td style={{ textAlign: 'right' }}><Input type="number" step="0.01" min={0} max={100} name={`level-${i}-rate`} value={l.ratePct} onChange={(e) => setLevels(levels.map((x, j) => j === i ? { ratePct: Number(e.target.value) } : x))} aria-label={`${levelLabel(i)} rate percent`} className="h-9 ml-auto text-right" style={{ width: 90 }} /></td>
                <td className="tnum" style={{ textAlign: 'right' }}>{money(preview[i]?.amountCents ?? 0)}</td>
                <td style={{ textAlign: 'right' }}>{i === levels.length - 1 && levels.length > 1 && <Button variant="ghost" size="sm" onClick={() => setLevels(levels.slice(0, -1))} title="Remove last tier">✕</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row spread" style={{ marginTop: 8 }}>
          <Button variant="ghost" size="sm" onClick={() => setLevels([...levels, { ratePct: 0 }])} disabled={levels.length >= 20}>＋ Add tier</Button>
          {overPool
            ? <Badge variant="destructive" className="text-xs">Levels total {levelSumPct.toFixed(2)}% / pool {poolPct.toFixed(2)}% — exceeds the pool!</Badge>
            : <span className="faint" style={{ fontSize: 12 }}>Levels total {levelSumPct.toFixed(2)}% / pool {poolPct.toFixed(2)}% </span>}
        </div>

        <Card style={{ background: 'var(--panel-2)', marginTop: 12, padding: 12 }}>
          <div className="row spread"><span className="faint" style={{ fontSize: 12 }}>Preview: total commission distributed on a $1,000 sale</span><strong className="tnum" style={{ color: 'var(--gold-500)' }}>{money(previewTotal)}</strong></div>
          <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>The remaining {money(PREVIEW_CENTS - previewTotal)} stays with the company (a missing upline level also stays with the company).</div>
        </Card>

        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
        <div className="row" style={{ marginTop: 12 }}><Button onClick={savePlan} disabled={savingPlan || overPool}>{savingPlan ? 'Saving…' : 'Save new version'}</Button></div>
      </Card>

      {/* ---- bonus katmanlari (mevcut) ---- */}
      <Card>
        <strong style={{ fontSize: 14 }}>Plan bonus layers (MLM)</strong>
        <div className="faint" style={{ fontSize: 12, marginBottom: 14 }}>Extra payouts to the direct sponsor, on top of the base unilevel plan{p.planName ? ` — “${p.planName}”` : ''}. Set 0 to disable.</div>

        <Card style={{ background: 'var(--panel-2)', padding: 14, marginBottom: 12 }}>
          <strong style={{ fontSize: 13 }}>⚡ Fast-start bonus</strong>
          <div className="faint" style={{ fontSize: 11, marginBottom: 8 }}>Direct sponsor earns this % of a new member&apos;s sale, if the sale is within the window after they joined.</div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><Label htmlFor={`${uid}-fsr`} className="mb-1.5 block">Rate (%)</Label><Input id={`${uid}-fsr`} type="number" step="0.01" min={0} value={p.fastStartBps / 100} onChange={(e) => setP({ ...p, fastStartBps: Math.round(Number(e.target.value) * 100) })} /></div>
            <div className="field" style={{ margin: 0 }}><Label htmlFor={`${uid}-fsd`} className="mb-1.5 block">Window (days)</Label><Input id={`${uid}-fsd`} type="number" min={0} max={365} value={p.fastStartDays} onChange={(e) => setP({ ...p, fastStartDays: Number(e.target.value) })} /></div>
          </div>
        </Card>

        <Card style={{ background: 'var(--panel-2)', padding: 14, marginBottom: 12 }}>
          <strong style={{ fontSize: 13 }}>🤝 Sponsor matching bonus</strong>
          <div className="faint" style={{ fontSize: 11, marginBottom: 8 }}>Direct sponsor earns this % of the seller&apos;s own (level-0) commission on every sale.</div>
          <div className="field" style={{ margin: 0, maxWidth: 200 }}><Label htmlFor={`${uid}-match`} className="mb-1.5 block">Match rate (%)</Label><Input id={`${uid}-match`} type="number" step="0.01" min={0} value={p.matchingBps / 100} onChange={(e) => setP({ ...p, matchingBps: Math.round(Number(e.target.value) * 100) })} /></div>
        </Card>

        <div className="row"><Button variant="ghost" onClick={saveBonus} disabled={busy}>{busy ? 'Saving…' : 'Save plan bonuses'}</Button></div>
      </Card>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
