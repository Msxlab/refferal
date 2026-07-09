'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { money, levelLabel } from '@/lib/format';

interface PlanBonus { planName: string | null; fastStartBps: number; fastStartDays: number; matchingBps: number }
interface PlanLevel { level: number; rateBps: number }
interface PlanVersion { id: string; name: string; poolRateBps: number; depth: number; effectiveFrom: string; active: boolean; levels: PlanLevel[] }
interface PlanList { activeId: string | null; plans: PlanVersion[] }

interface SimLevel { level: number; rateBps: number; amountCents: string; beneficiary: { name: string; code: string } | null; retainedByCompany: boolean }
interface SimResult { planName: string; poolRateBps: number; depth: number; amountCents: string; levels: SimLevel[]; distributedCents: string; companyKeepsCents: string }
// GET /admin/members list item: `id` alani membership uuid'sidir (backend `id: m.id` doner)
interface MemberHit { id: string; fullName: string; referralCode: string }

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

  // ---- komisyon simulatoru (gercek POST /admin/plans/simulate) ----
  const [simDollars, setSimDollars] = useState('1000');
  const [sellerQuery, setSellerQuery] = useState('');
  const [sellerHits, setSellerHits] = useState<MemberHit[]>([]);
  const [seller, setSeller] = useState<MemberHit | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [simError, setSimError] = useState('');

  // dolar -> cent (float'siz, iki ondaliga kadar)
  function dollarsToCents(v: string): number {
    const s = v.replace(/[$\s,]/g, '');
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return NaN;
    const dot = s.indexOf('.');
    const whole = dot === -1 ? s : s.slice(0, dot);
    const frac = dot === -1 ? '' : s.slice(dot + 1);
    return parseInt(whole || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
  }

  async function searchSellers(q: string) {
    setSellerQuery(q);
    if (q.trim().length < 2) { setSellerHits([]); return; }
    try {
      const res = await api.get<{ items: MemberHit[] }>(`/admin/members?search=${encodeURIComponent(q.trim())}&pageSize=8`);
      setSellerHits(res.items);
    } catch { setSellerHits([]); }
  }

  async function runSimulate() {
    const cents = dollarsToCents(simDollars);
    if (!Number.isFinite(cents) || cents <= 0) { setSimError('Enter a positive amount.'); return; }
    if (cents > 1_000_000_000) { setSimError('Amount too large.'); return; }
    setSimBusy(true); setSimError('');
    try {
      const res = await api.post<SimResult>('/admin/plans/simulate', {
        amountCents: cents,
        ...(seller ? { sellerMembershipId: seller.id } : {}),
      });
      setSim(res);
    } catch (e) { setSimError(String((e as ApiError).message)); } finally { setSimBusy(false); }
  }

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
      <div className="card">
        <div className="spread" style={{ marginBottom: 10 }}>
          <div>
            <strong style={{ fontSize: 14 }}>Commission plan (percentages)</strong>
            <div className="faint" style={{ fontSize: 12 }}>Pool rate + each level (tier) %. Saving creates a new <em>version</em>; past sales keep the plan that was effective on their date.</div>
          </div>
          <span className="badge active" style={{ fontSize: 10 }}>{list.plans.length} versions</span>
        </div>

        <div className="row" style={{ gap: 12, alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="field" style={{ flex: 2, margin: 0 }}><label>Version name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2026 plan" /></div>
          <div className="field" style={{ flex: 1, margin: 0 }}><label>Pool rate (%)</label><input type="number" step="0.01" min={0} max={100} value={poolPct} onChange={(e) => setPoolPct(Number(e.target.value))} /></div>
        </div>

        <table>
          <thead><tr><th>Tier</th><th style={{ textAlign: 'right' }}>Rate (%)</th><th /></tr></thead>
          <tbody>
            {levels.map((l, i) => (
              <tr key={i}>
                <td>{levelLabel(i)}{i === 0 && <span className="faint" style={{ fontSize: 11 }}> (seller)</span>}</td>
                <td style={{ textAlign: 'right' }}><input type="number" step="0.01" min={0} max={100} value={l.ratePct} onChange={(e) => setLevels(levels.map((x, j) => j === i ? { ratePct: Number(e.target.value) } : x))} style={{ width: 90, textAlign: 'right' }} /></td>
                <td style={{ textAlign: 'right' }}>{i === levels.length - 1 && levels.length > 1 && <button className="btn ghost sm" onClick={() => setLevels(levels.slice(0, -1))} title="Remove last tier">✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row spread" style={{ marginTop: 8 }}>
          <button className="btn ghost sm" onClick={() => setLevels([...levels, { ratePct: 0 }])} disabled={levels.length >= 20}>＋ Add tier</button>
          <span className={overPool ? 'badge failed' : 'faint'} style={{ fontSize: 12 }}>
            Levels total {levelSumPct.toFixed(2)}% / pool {poolPct.toFixed(2)}% {overPool ? '— exceeds the pool!' : ''}
          </span>
        </div>

        <div className="card" style={{ background: 'var(--panel-2)', marginTop: 12, padding: 12 }}>
          <strong style={{ fontSize: 13 }}>Commission simulator</strong>
          <div className="faint" style={{ fontSize: 11, marginBottom: 8 }}>
            Uses the active plan + real upline chain. Pick a seller to resolve who actually receives each tier; leave empty for a full-depth hypothetical.
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Sale amount ($)</label>
              <input value={simDollars} onChange={(e) => setSimDollars(e.target.value)} inputMode="decimal" style={{ width: 130 }} />
            </div>
            <div className="field" style={{ margin: 0, position: 'relative', flex: 1, minWidth: 200 }}>
              <label>Seller (optional)</label>
              {seller ? (
                <div className="row" style={{ gap: 8 }}>
                  <span className="badge active">{seller.fullName} · {seller.referralCode}</span>
                  <button className="btn ghost sm" onClick={() => { setSeller(null); setSellerQuery(''); setSellerHits([]); }}>✕</button>
                </div>
              ) : (
                <>
                  <input value={sellerQuery} onChange={(e) => searchSellers(e.target.value)} placeholder="Search name or code…" />
                  {sellerHits.length > 0 && (
                    <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, maxHeight: 200, overflow: 'auto', padding: 4 }}>
                      {sellerHits.map((h) => (
                        <button key={h.id} className="btn ghost sm" style={{ display: 'block', width: '100%', textAlign: 'left' }}
                          onClick={() => { setSeller(h); setSellerHits([]); setSellerQuery(''); }}>
                          {h.fullName} <span className="faint">· {h.referralCode}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <button className="btn" onClick={runSimulate} disabled={simBusy}>{simBusy ? 'Simulating…' : 'Simulate'}</button>
          </div>
          {simError && <div className="error" style={{ marginTop: 10 }}>{simError}</div>}
          {sim && (
            <div style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th>Tier</th><th>Beneficiary</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {sim.levels.map((l) => (
                    <tr key={l.level}>
                      <td>{levelLabel(l.level)}</td>
                      <td className="faint" style={{ fontSize: 12 }}>
                        {l.beneficiary ? `${l.beneficiary.name} · ${l.beneficiary.code}` : l.retainedByCompany ? 'Company (no upline)' : '—'}
                      </td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{(l.rateBps / 100).toFixed(2)}%</td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{money(l.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row spread" style={{ marginTop: 8 }}>
                <span className="faint" style={{ fontSize: 12 }}>Distributed {money(sim.distributedCents)} · Company keeps {money(sim.companyKeepsCents)}</span>
                <strong className="tnum" style={{ color: 'var(--gold-500)' }}>{money(sim.amountCents)}</strong>
              </div>
            </div>
          )}
        </div>

        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
        <div className="row" style={{ marginTop: 12 }}><button className="btn" onClick={savePlan} disabled={savingPlan || overPool}>{savingPlan ? 'Saving…' : 'Save new version'}</button></div>
      </div>

      {/* ---- bonus katmanlari (mevcut) ---- */}
      <div className="card">
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

        <div className="row"><button className="btn ghost" onClick={saveBonus} disabled={busy}>{busy ? 'Saving…' : 'Save plan bonuses'}</button></div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
