'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';

interface PlanLevel {
  level: number;
  rateBps: number;
}

interface Plan {
  id: string;
  name: string;
  poolRateBps: number;
  depth: number;
  effectiveFrom: string;
  levels: PlanLevel[];
}

interface Simulation {
  amountCents: string;
  distributedCents: string;
  retainedCents: string;
  lines: Array<{ level: number; beneficiary: string; rateBps: number; amountCents: string }>;
}

function money(cents: string) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

export default function Plans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('Standard plan');
  const [poolRateBps, setPoolRateBps] = useState(3000);
  const [rates, setRates] = useState<number[]>([1000, 800, 600, 400, 200]);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [amountCents, setAmountCents] = useState('100000');
  const [sim, setSim] = useState<Simulation | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const depth = rates.length;
  const selected = useMemo(() => plans.find((p) => p.id === selectedId) ?? plans[0], [plans, selectedId]);

  async function load() {
    try {
      const rows = await api.get<Plan[]>('/admin/plans');
      setPlans(rows);
      if (!selectedId && rows[0]) setSelectedId(rows[0].id);
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }

  useEffect(() => { void load(); }, []);

  function setRate(index: number, value: number) {
    setRates((current) => current.map((rate, i) => (i === index ? value : rate)));
  }

  function resize(nextDepth: number) {
    setRates((current) => Array.from({ length: nextDepth }, (_, i) => current[i] ?? 0));
  }

  async function createPlan() {
    setBusy('create'); setError('');
    try {
      await api.post<Plan>('/admin/plans', {
        name,
        poolRateBps,
        depth,
        levels: rates.map((rateBps, level) => ({ level, rateBps })),
        effectiveFrom: effectiveFrom || undefined,
      });
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(''); }
  }

  async function simulate() {
    const planId = selected?.id;
    if (!planId) return;
    setBusy('simulate'); setError('');
    try {
      setSim(await api.post<Simulation>('/admin/plans/simulate', { planId, amountCents }));
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(''); }
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      {error && <div className="error">{error}</div>}

      <section>
        <div style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 15 }}>Commission plan versions</strong>
          <div className="faint" style={{ fontSize: 12 }}>Newest effective plan is used when sales are approved.</div>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead><tr><th>Name</th><th>Pool</th><th>Depth</th><th>Effective</th><th>Levels</th></tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} onClick={() => setSelectedId(p.id)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 700 }}>{p.name}</td>
                  <td>{(p.poolRateBps / 100).toFixed(2)}%</td>
                  <td>{p.depth}</td>
                  <td>{new Date(p.effectiveFrom).toLocaleDateString()}</td>
                  <td className="faint">{p.levels.map((l) => `${l.level}:${(l.rateBps / 100).toFixed(2)}%`).join(' / ')}</td>
                </tr>
              ))}
              {plans.length === 0 && <tr><td colSpan={5} className="muted">No plans yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 15 }}>Create version</strong>
          <div className="faint" style={{ fontSize: 12 }}>Plans are versioned by effective date; historical sales keep their plan.</div>
        </div>
        <div className="card">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Pool bps</label>
              <input type="number" min={0} max={10000} value={poolRateBps} onChange={(e) => setPoolRateBps(Number(e.target.value))} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Depth</label>
              <input type="number" min={1} max={12} value={depth} onChange={(e) => resize(Number(e.target.value))} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Effective from</label>
              <input type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginTop: 12 }}>
            {rates.map((rate, level) => (
              <div className="field" style={{ margin: 0 }} key={level}>
                <label>Level {level} bps</label>
                <input type="number" min={0} max={10000} value={rate} onChange={(e) => setRate(level, Number(e.target.value))} />
              </div>
            ))}
          </div>
          <button className="btn" type="button" disabled={busy === 'create'} onClick={createPlan} style={{ marginTop: 12 }}>
            Create plan
          </button>
        </div>
      </section>

      <section>
        <div style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 15 }}>Simulator</strong>
          <div className="faint" style={{ fontSize: 12 }}>Uses fake upline members to show level payouts.</div>
        </div>
        <div className="card">
          <div className="row" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
            <div className="field" style={{ margin: 0, minWidth: 220 }}>
              <label>Plan</label>
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0, minWidth: 160 }}>
              <label>Amount cents</label>
              <input value={amountCents} onChange={(e) => setAmountCents(e.target.value)} />
            </div>
            <button className="btn" type="button" disabled={!selected || busy === 'simulate'} onClick={simulate}>Simulate</button>
          </div>
          {sim && (
            <div style={{ marginTop: 14 }}>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <Stat label="Sale" value={money(sim.amountCents)} />
                <Stat label="Distributed" value={money(sim.distributedCents)} />
                <Stat label="Retained" value={money(sim.retainedCents)} />
              </div>
              <table style={{ marginTop: 12 }}>
                <thead><tr><th>Level</th><th>Rate</th><th>Beneficiary</th><th>Amount</th></tr></thead>
                <tbody>
                  {sim.lines.map((l) => (
                    <tr key={l.level}>
                      <td>{l.level}</td><td>{(l.rateBps / 100).toFixed(2)}%</td><td>{l.beneficiary}</td><td>{money(l.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 800 }}>{value}</div>
    </div>
  );
}
