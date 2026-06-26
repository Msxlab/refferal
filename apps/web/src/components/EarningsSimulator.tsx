'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';

interface MemberPlan {
  active: boolean;
  name?: string;
  poolRateBps?: number;
  depth?: number;
  levels?: { level: number; rateBps: number }[];
}

/**
 * Faz D4: uye kazanc simulatoru. "Ben/ekibim su kadar satarsa ne kazanirim?" — GIZLILIK-GUVENLI:
 * yalniz UYENIN KENDI kazancini gosterir (kim/ne kadar kazaniyor degil), planin ACIK oranlarindan.
 * level 0 = uye kendi satisi (direkt); level N = N kademe ALTINDAKI ekip uyesinin satisindan pay.
 */
export function EarningsSimulator() {
  const [plan, setPlan] = useState<MemberPlan | null>(null);
  const [dollars, setDollars] = useState('1000');

  useEffect(() => {
    api.get<MemberPlan>('/app/plan').then(setPlan).catch(() => setPlan({ active: false }));
  }, []);

  const rows = useMemo(() => {
    if (!plan?.active || !plan.levels?.length) return [];
    const cents = Math.max(0, Math.round(parseFloat(dollars || '0') * 100));
    return [...plan.levels]
      .sort((a, b) => a.level - b.level)
      .map((l) => ({
        level: l.level,
        rateBps: l.rateBps,
        earnCents: Math.floor((cents * l.rateBps) / 10000),
      }));
  }, [plan, dollars]);

  // plan henuz yuklenmedi: kart pop'lamasin diye hafif iskelet goster (kardes kartlarla uyumlu)
  if (!plan) {
    return (
      <div className="card fade-in delay-2" style={{ marginTop: 16 }} aria-busy="true" aria-label="Loading earnings simulator">
        <div className="spread" style={{ alignItems: 'flex-start', marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ width: 160, height: 16, borderRadius: 6 }} />
            <div className="skeleton" style={{ width: 240, height: 12, borderRadius: 6, marginTop: 8 }} />
          </div>
          <div className="skeleton" style={{ width: 96, height: 34, borderRadius: 8 }} />
        </div>
        <div className="skeleton" style={{ width: '100%', height: 64, borderRadius: 12 }} />
      </div>
    );
  }
  if (!plan.active) return null;

  const direct = rows.find((r) => r.level === 0);
  const teamRows = rows.filter((r) => r.level > 0 && r.rateBps > 0);

  return (
    <div className="card fade-in delay-2" style={{ marginTop: 16 }}>
      <div className="spread" style={{ alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <strong style={{ fontSize: 'var(--text-lg)' }}>Earnings simulator</strong>
          <div className="faint" style={{ fontSize: 'var(--text-sm)', marginTop: 2 }}>See what you&apos;d earn on a sale — by you, or by your team.</div>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label style={{ fontSize: 'var(--text-xs)' }}>Sale amount ($)</label>
          <input value={dollars} onChange={(e) => setDollars(e.target.value)} inputMode="decimal" style={{ maxWidth: 120 }} />
        </div>
      </div>

      {direct && (
        <div className="card" style={{ background: 'color-mix(in srgb, var(--emerald) 9%, transparent)', borderColor: 'color-mix(in srgb, var(--emerald) 25%, transparent)', padding: 14, marginBottom: 12 }}>
          <div className="spread" style={{ alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700 }}>If <span style={{ color: 'var(--emerald)' }}>you</span> make this sale</div>
              <div className="faint" style={{ fontSize: 'var(--text-sm)' }}>Your direct commission ({(direct.rateBps / 100).toFixed(2)}%)</div>
            </div>
            <div className="tnum" style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--emerald)' }}>{money(direct.earnCents, 'USD')}</div>
          </div>
        </div>
      )}

      {teamRows.length > 0 && (
        <>
          <div className="faint" style={{ fontSize: 'var(--text-sm)', marginBottom: 6 }}>…and when your team sells, you earn too:</div>
          <div className="card" style={{ background: 'var(--panel-2)', padding: 0, overflowX: 'auto' }}>
            <table>
              <thead><tr><th>If a teammate sells</th><th>Your rate</th><th style={{ textAlign: 'right' }}>You earn</th></tr></thead>
              <tbody>
                {teamRows.map((r) => (
                  <tr key={r.level}>
                    <td>{r.level} level{r.level === 1 ? '' : 's'} below you</td>
                    <td className="faint">{(r.rateBps / 100).toFixed(2)}%</td>
                    <td className="tnum" style={{ textAlign: 'right', fontWeight: 650 }}>{money(r.earnCents, 'USD')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="faint" style={{ fontSize: 'var(--text-xs)', marginTop: 12, lineHeight: 1.5 }}>
        Estimates from your company&apos;s active plan{plan.name ? ` (“${plan.name}”)` : ''}. Actual commission depends on approval, your rank, and active campaigns.
      </div>
    </div>
  );
}
