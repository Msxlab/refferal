'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { NetworkExplorer, type ApiNode, type RankTierLite } from '@/components/NetworkExplorer';
import { money } from '@/lib/format';
import { t } from '@/lib/i18n';

interface Leader {
  id: string; fullName: string; referralCode: string; role: string;
  isTeamLeader: boolean; isOwnerRoot: boolean; teamSize: number;
  activeCount: number; trend: string[];
  monthlyGroupVolumeCents: string; monthlyGroupCommissionCents: string;
}

const ALL = '__all__';

type LeaderStatus = 'healthy' | 'cooling' | 'dormant';
type SortKey = 'volume' | 'team' | 'growth' | 'active';

const STATUS_META: Record<LeaderStatus, { label: string; color: string }> = {
  healthy: { label: 'healthy', color: 'var(--emerald)' },
  cooling: { label: 'cooling', color: 'var(--amber)' },
  dormant: { label: 'dormant', color: 'var(--rose)' },
};

/** Lider durumu: bu-ay grup cirosu + trend yonu + aktif oranindan turetilir. */
function leaderStatus(l: Leader): LeaderStatus {
  const vol = Number(l.monthlyGroupVolumeCents);
  const tr = l.trend.map(Number);
  const cur = tr[tr.length - 1] ?? vol;
  const prev = tr[tr.length - 2] ?? 0;
  const total = l.teamSize + 1;
  const activeRatio = total > 0 ? l.activeCount / total : 0;
  if (vol <= 0) return 'dormant';
  if (cur < prev || activeRatio < 0.5) return 'cooling';
  return 'healthy';
}
function growthOf(l: Leader): number {
  const tr = l.trend.map(Number);
  return (tr[tr.length - 1] ?? 0) - (tr[tr.length - 2] ?? 0);
}
function activeRatioOf(l: Leader): number {
  const total = l.teamSize + 1;
  return total > 0 ? l.activeCount / total : 0;
}

/** Kompakt para etiketi: $12.3k / $1.2M. */
function compactMoney(cents: string | number): string {
  const d = Number(cents) / 100;
  const a = Math.abs(d);
  if (a >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (a >= 1000) return `$${(d / 1000).toFixed(1)}k`;
  return `$${d.toFixed(0)}`;
}

/** Mini sparkline (cent string serisinden). Tum-sifir ise kesik taban cizgisi. */
function Sparkline({ data, color = 'var(--muted)', w = 84, h = 22 }: { data: string[]; color?: string; w?: number; h?: number }) {
  const nums = data.map(Number);
  const max = Math.max(1, ...nums);
  const allZero = nums.every((v) => v === 0);
  const pts = nums.map((v, i) => {
    const x = nums.length > 1 ? (i / (nums.length - 1)) * (w - 2) + 1 : w / 2;
    const y = h - 2 - (v / max) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ display: 'block' }}>
      {allZero
        ? <line x1="1" y1={h - 2} x2={w - 1} y2={h - 2} stroke="var(--border-strong)" strokeWidth="1.5" strokeDasharray="2 3" />
        : <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
  );
}

function StatusPill({ s }: { s: LeaderStatus }) {
  const m = STATUS_META[s];
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap',
      color: m.color, background: `color-mix(in srgb, ${m.color} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${m.color} 32%, transparent)` }}>
      {m.label}
    </span>
  );
}

interface LeadersMeta { totalLeaders: number; shownLeaders: number; truncated: boolean }

interface DormantCluster { leaderId: string; leaderName: string; referralCode: string; teamSize: number }
interface NetworkHealth {
  month: string;
  totals: { members: number; active: number; inactive: number };
  noSaleActive: { count: number; total: number; pct: number };
  dormantClusters: DormantCluster[];
}

export default function NetworkPage() {
  const [leaders, setLeaders] = useState<Leader[] | null>(null);
  const [meta, setMeta] = useState<LeadersMeta | null>(null);
  const [health, setHealth] = useState<NetworkHealth | null>(null);
  const [tiers, setTiers] = useState<RankTierLite[]>([]);
  const [root, setRoot] = useState<{ id: string; name: string } | null>(null); // null = liderler landing
  const [nodes, setNodes] = useState<ApiNode[] | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  // leaderboard kontrolleri
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [view, setView] = useState<'cards' | 'table'>('cards');

  const q = query.trim().toLowerCase();
  const sortedLeaders = useMemo(() => {
    const arr = (leaders ?? []).filter((l) => !q || l.fullName.toLowerCase().includes(q) || l.referralCode.toLowerCase().includes(q));
    arr.sort((a, b) => {
      if (sortKey === 'team') return b.teamSize - a.teamSize;
      if (sortKey === 'growth') return growthOf(b) - growthOf(a);
      if (sortKey === 'active') return activeRatioOf(b) - activeRatioOf(a);
      return Number(b.monthlyGroupVolumeCents) - Number(a.monthlyGroupVolumeCents);
    });
    return arr;
  }, [leaders, q, sortKey]);
  // spotlight: en iyi SAHA lideri (owner-root haric), ciroya gore; arama yokken gosterilir
  const spotlight = useMemo(() => {
    const perf = (leaders ?? []).filter((l) => !l.isOwnerRoot);
    if (perf.length === 0) return null;
    return [...perf].sort((a, b) => Number(b.monthlyGroupVolumeCents) - Number(a.monthlyGroupVolumeCents) || b.teamSize - a.teamSize)[0];
  }, [leaders]);

  const loadLeaders = useCallback(() => {
    api.get<{ leaders: Leader[] } & Partial<LeadersMeta>>('/admin/members/leaders')
      .then((r) => {
        setLeaders(r.leaders);
        if (r.totalLeaders !== undefined) setMeta({ totalLeaders: r.totalLeaders, shownLeaders: r.shownLeaders ?? r.leaders.length, truncated: !!r.truncated });
      })
      .catch((e) => setError(String((e as ApiError).message)));
  }, []);

  useEffect(() => {
    loadLeaders();
    api.get<{ tiers: RankTierLite[] }>('/admin/ranks').then((r) => setTiers(r.tiers)).catch(() => { /* opsiyonel */ });
    api.get<NetworkHealth>('/admin/members/network-health').then(setHealth).catch(() => { /* opsiyonel */ });
  }, [loadLeaders]);

  const openTree = useCallback((rootId: string | null, name: string) => {
    setNodes(null);
    setRoot({ id: rootId ?? ALL, name });
    const q = rootId ? `?root=${rootId}` : '';
    api.get<ApiNode[]>(`/admin/members/tree${q}`).then(setNodes).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  const toggleLeader = useCallback(async (n: ApiNode) => {
    try {
      await api.post(`/admin/members/${n.id}/leader`, { isTeamLeader: !n.isTeamLeader });
      showToast(n.isTeamLeader ? 'Removed as leader' : 'Marked as leader 🎖');
      loadLeaders();
      if (root) openTree(root.id === ALL ? null : root.id, root.name);
    } catch (e) { setError(String((e as ApiError).message)); }
  }, [root, openTree, loadLeaders, showToast]);

  if (error) return <div className="error">{error}</div>;

  // ---- bir lider/ağ seçiliyse: o ağacı göster ----
  if (root) {
    return (
      <div>
        <div className="row" style={{ gap: 10, marginBottom: 12, alignItems: 'center' }}>
          <button className="btn ghost sm" onClick={() => { setRoot(null); setNodes(null); }}>← Leaders</button>
          <div className="eyebrow" style={{ margin: 0 }}>{root.id === ALL ? 'Whole network' : 'Team tree'}</div>
          <h1 className="h1" style={{ margin: 0, fontSize: 22 }}>{root.name}</h1>
        </div>
        {!nodes ? <Loading rows={5} /> : <NetworkExplorer nodes={nodes} tiers={tiers} title={root.name} onToggleLeader={toggleLeader} />}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    );
  }

  // ---- liderler landing'i ----
  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.tree')}</div>
      <h1 className="h1 fade-in">Team leaders</h1>
      <p className="sub fade-in" style={{ marginBottom: 16 }}>
        Open each leader as its own tree — see their team, sales and <strong>this month&apos;s commission</strong> live. Open any member in the tree and use <em>“Make leader”</em> to mark them a leader.
      </p>

      {meta?.truncated && (
        <div className="row fade-in" style={{ gap: 8, padding: '8px 12px', borderRadius: 10, marginBottom: 12, fontSize: 13,
          background: 'color-mix(in srgb, var(--amber) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 32%, transparent)' }}>
          <span aria-hidden>⚠</span>
          <span>Showing the first <strong>{meta.shownLeaders}</strong> of <strong>{meta.totalLeaders}</strong> leaders. Search &amp; pagination are coming soon.</span>
        </div>
      )}

      {/* ---- ag saglik seridi ---- */}
      {health && (
        <div className="card fade-in" style={{ marginBottom: 16 }}>
          <div className="net-kpis" style={{ marginBottom: health.dormantClusters.length > 0 ? 14 : 0 }}>
            <div className="net-kpi"><span className="faint" style={{ fontSize: 11 }}>Members</span><div style={{ fontWeight: 750, fontSize: 17 }}>⬡ {health.totals.members}</div></div>
            <div className="net-kpi"><span className="faint" style={{ fontSize: 11 }}>Active</span><div style={{ fontWeight: 750, fontSize: 17 }}>● {health.totals.active}<span className="faint" style={{ fontSize: 11, fontWeight: 400 }}> / {health.totals.inactive} inactive</span></div></div>
            <div className="net-kpi">
              <span className="faint" style={{ fontSize: 11 }}>No sale this month</span>
              <div style={{ fontWeight: 750, fontSize: 17, color: health.noSaleActive.pct >= 50 ? 'var(--amber)' : 'var(--text)' }}>
                {health.noSaleActive.pct}%<span className="faint" style={{ fontSize: 11, fontWeight: 400 }}> ({health.noSaleActive.count}/{health.noSaleActive.total} active)</span>
              </div>
            </div>
            <div className="net-kpi"><span className="faint" style={{ fontSize: 11 }}>Dormant teams</span><div style={{ fontWeight: 750, fontSize: 17, color: health.dormantClusters.length > 0 ? 'var(--amber)' : 'var(--emerald)' }}>{health.dormantClusters.length}</div></div>
          </div>
          {health.dormantClusters.length > 0 && (
            <div>
              <div className="faint" style={{ fontSize: 11, marginBottom: 6 }}>Teams with no group sales this month — open to investigate:</div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {health.dormantClusters.map((d) => (
                  <button key={d.leaderId} className="btn ghost sm" onClick={() => openTree(d.leaderId, d.leaderName)} title={`${d.referralCode} · team of ${d.teamSize}`}>
                    {d.leaderName} <span className="faint">⬡{d.teamSize}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!leaders ? <Loading rows={4} /> : (
        <>
          {/* tum ag girisi */}
          <button className="card hover" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: '1px dashed var(--border-strong)', marginBottom: 14, padding: '12px 16px' }} onClick={() => openTree(null, 'Whole network')}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>◈ Whole network</span>
            <span className="faint" style={{ fontSize: 12 }}> — see the entire company as one tree</span>
          </button>

          {/* toolbar: arama + siralama + gorunum */}
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
            <input placeholder="Search leader or code…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, minWidth: 180, maxWidth: 300 }} />
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sort leaders" style={{ width: 'auto' }}>
              <option value="volume">Sort: group volume</option>
              <option value="team">Team size</option>
              <option value="growth">Growth</option>
              <option value="active">Activity</option>
            </select>
            <div className="seg-tabs" role="tablist" style={{ padding: 4 }}>
              <button className={`seg-tab ${view === 'cards' ? 'on' : ''}`} onClick={() => setView('cards')}>▦ Cards</button>
              <button className={`seg-tab ${view === 'table' ? 'on' : ''}`} onClick={() => setView('table')}>☰ Table</button>
            </div>
            <span className="faint" style={{ fontSize: 12 }}>{sortedLeaders.length} {sortedLeaders.length === 1 ? 'leader' : 'leaders'}</span>
          </div>

          {/* spotlight: en iyi saha lideri (arama yokken) */}
          {!q && spotlight && (
            <>
              <div className="faint" style={{ fontSize: 11, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 6 }}>★ Top performer this month</div>
              <button className="card hover" onClick={() => openTree(spotlight.id, spotlight.fullName)}
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--gold-500)', boxShadow: 'var(--shadow-glow)', marginBottom: 18, padding: '14px 18px' }}>
                <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--foil)', color: 'var(--on-gold)', display: 'grid', placeItems: 'center', fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 16, flexShrink: 0 }}>{spotlight.fullName.charAt(0).toUpperCase()}</span>
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <span style={{ fontWeight: 750, fontSize: 16 }}>{spotlight.fullName}</span>
                      <span className="faint" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{spotlight.referralCode}</span>
                      <StatusPill s={leaderStatus(spotlight)} />
                    </div>
                    <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
                      ⬡ {spotlight.teamSize} team · {Math.round(activeRatioOf(spotlight) * 100)}% active
                      {growthOf(spotlight) !== 0 && <> · {growthOf(spotlight) > 0 ? '▲' : '▼'} {compactMoney(Math.abs(growthOf(spotlight)))} vs last mo</>}
                    </div>
                  </div>
                  <Sparkline data={spotlight.trend} color="var(--gold-500)" w={120} h={40} />
                  <div style={{ textAlign: 'right', minWidth: 120 }}>
                    <div className="faint" style={{ fontSize: 11 }}>Group volume (mo)</div>
                    <div className="tnum" style={{ fontWeight: 800, fontSize: 22 }}>{money(spotlight.monthlyGroupVolumeCents)}</div>
                    <div className="tnum" style={{ fontSize: 12, color: 'var(--gold-500)' }}>{money(spotlight.monthlyGroupCommissionCents)} commission</div>
                  </div>
                </div>
              </button>
            </>
          )}

          {/* leaderboard: kart ya da tablo */}
          {sortedLeaders.length === 0 ? (
            <div className="muted" style={{ padding: '18px 0' }}>No leaders match “{query}”.</div>
          ) : view === 'cards' ? (
            <div className="net-kpis" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {sortedLeaders.map((l) => {
                const st = leaderStatus(l);
                return (
                  <button key={l.id} className="card hover" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => openTree(l.id, l.fullName)}>
                    <div className="spread" style={{ alignItems: 'flex-start' }}>
                      <div className="row" style={{ gap: 10, minWidth: 0 }}>
                        <span style={{ width: 34, height: 34, borderRadius: 9, background: l.isOwnerRoot ? 'var(--foil)' : 'var(--panel-3)', color: l.isOwnerRoot ? 'var(--on-gold)' : 'var(--text)', display: 'grid', placeItems: 'center', fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 13, flexShrink: 0 }}>{l.fullName.charAt(0).toUpperCase()}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 750, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.fullName}</div>
                          <div className="faint" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{l.referralCode}</div>
                        </div>
                      </div>
                      <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                        {l.isOwnerRoot ? <span className="badge active" style={{ fontSize: 9 }}>owner</span> : <span className="badge payable" style={{ fontSize: 9 }}>🎖</span>}
                        <StatusPill s={st} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                      <span className="faint" style={{ fontSize: 10, minWidth: 40 }}>⬡ {l.teamSize}</span>
                      <div style={{ flex: 1, height: 4, background: 'var(--panel-3)', borderRadius: 2 }}>
                        <div style={{ width: `${Math.round(activeRatioOf(l) * 100)}%`, height: '100%', background: STATUS_META[st].color, borderRadius: 2 }} />
                      </div>
                      <span className="faint" style={{ fontSize: 10 }}>{Math.round(activeRatioOf(l) * 100)}%</span>
                    </div>
                    <div className="spread" style={{ marginTop: 12, alignItems: 'flex-end' }}>
                      <div>
                        <div className="faint" style={{ fontSize: 10 }}>Volume (mo)</div>
                        <div className="tnum" style={{ fontWeight: 700, fontSize: 15 }}>{money(l.monthlyGroupVolumeCents)}</div>
                        <div className="tnum" style={{ fontSize: 11, color: 'var(--gold-500)' }}>{money(l.monthlyGroupCommissionCents)}</div>
                      </div>
                      <Sparkline data={l.trend} color={STATUS_META[st].color} w={80} h={30} />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table>
                <thead>
                  <tr>
                    <th>Leader</th>
                    <th style={{ textAlign: 'right' }}>Team</th>
                    <th style={{ textAlign: 'right' }}>Volume (mo)</th>
                    <th style={{ textAlign: 'right' }}>Commission (mo)</th>
                    <th>6-mo</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLeaders.map((l, i) => {
                    const st = leaderStatus(l);
                    return (
                      <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => openTree(l.id, l.fullName)}>
                        <td>
                          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                            <span className="faint tnum" style={{ fontSize: 11, minWidth: 16 }}>{i + 1}</span>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{l.fullName}{l.isOwnerRoot ? <span className="faint" style={{ fontWeight: 400 }}> · owner</span> : l.isTeamLeader ? ' 🎖' : ''}</div>
                              <div className="faint" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{l.referralCode}</div>
                            </div>
                          </div>
                        </td>
                        <td className="tnum" style={{ textAlign: 'right' }}>{l.teamSize}<div className="faint" style={{ fontSize: 10 }}>{Math.round(activeRatioOf(l) * 100)}% act</div></td>
                        <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{money(l.monthlyGroupVolumeCents)}</td>
                        <td className="tnum" style={{ textAlign: 'right', color: 'var(--gold-500)' }}>{money(l.monthlyGroupCommissionCents)}</td>
                        <td><Sparkline data={l.trend} color={STATUS_META[st].color} w={70} h={20} /></td>
                        <td><StatusPill s={st} /></td>
                        <td style={{ textAlign: 'right' }}><span className="faint" style={{ fontSize: 12 }}>Open →</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
