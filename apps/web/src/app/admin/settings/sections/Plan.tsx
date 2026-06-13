'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { money, levelLabel } from '@/lib/format';

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
    if (overPool) { setError('Seviye oranları toplamı havuz oranını aşamaz.'); return; }
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
      showToast('Yeni plan versiyonu kaydedildi ✓');
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
            <strong style={{ fontSize: 14 }}>Komisyon planı (yüzdeler)</strong>
            <div className="faint" style={{ fontSize: 12 }}>Havuz oranı + her seviyenin (kademe) %&apos;si. Kaydetmek yeni bir <em>versiyon</em> oluşturur; geçmiş satışlar kendi tarihindeki planla kalır.</div>
          </div>
          <span className="badge active" style={{ fontSize: 10 }}>{list.plans.length} versiyon</span>
        </div>

        <div className="row" style={{ gap: 12, alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="field" style={{ flex: 2, margin: 0 }}><label>Versiyon adı</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ör. 2026 planı" /></div>
          <div className="field" style={{ flex: 1, margin: 0 }}><label>Havuz oranı (%)</label><input type="number" step="0.01" min={0} max={100} value={poolPct} onChange={(e) => setPoolPct(Number(e.target.value))} /></div>
        </div>

        <table>
          <thead><tr><th>Kademe</th><th style={{ textAlign: 'right' }}>Oran (%)</th><th style={{ textAlign: 'right' }}>$1.000 satışta</th><th /></tr></thead>
          <tbody>
            {levels.map((l, i) => (
              <tr key={i}>
                <td>{levelLabel(i)}{i === 0 && <span className="faint" style={{ fontSize: 11 }}> (satıcı)</span>}</td>
                <td style={{ textAlign: 'right' }}><input type="number" step="0.01" min={0} max={100} value={l.ratePct} onChange={(e) => setLevels(levels.map((x, j) => j === i ? { ratePct: Number(e.target.value) } : x))} style={{ width: 90, textAlign: 'right' }} /></td>
                <td className="tnum" style={{ textAlign: 'right' }}>{money(preview[i]?.amountCents ?? 0)}</td>
                <td style={{ textAlign: 'right' }}>{i === levels.length - 1 && levels.length > 1 && <button className="btn ghost sm" onClick={() => setLevels(levels.slice(0, -1))} title="Son kademeyi sil">✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row spread" style={{ marginTop: 8 }}>
          <button className="btn ghost sm" onClick={() => setLevels([...levels, { ratePct: 0 }])} disabled={levels.length >= 20}>＋ Kademe ekle</button>
          <span className={overPool ? 'badge failed' : 'faint'} style={{ fontSize: 12 }}>
            Seviye toplamı %{levelSumPct.toFixed(2)} / havuz %{poolPct.toFixed(2)} {overPool ? '— havuzu aşıyor!' : ''}
          </span>
        </div>

        <div className="card" style={{ background: 'var(--panel-2)', marginTop: 12, padding: 12 }}>
          <div className="row spread"><span className="faint" style={{ fontSize: 12 }}>Önizleme: $1.000&apos;lık bir satışta toplam dağıtılan komisyon</span><strong className="tnum" style={{ color: 'var(--gold-500)' }}>{money(previewTotal)}</strong></div>
          <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Kalan {money(PREVIEW_CENTS - previewTotal)} şirkette kalır (eksik üst-sponsor olduğunda da pay şirkette kalır).</div>
        </div>

        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
        <div className="row" style={{ marginTop: 12 }}><button className="btn" onClick={savePlan} disabled={savingPlan || overPool}>{savingPlan ? 'Kaydediliyor…' : 'Yeni versiyon kaydet'}</button></div>
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
