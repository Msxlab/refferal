'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { NetworkExplorer, type ApiNode, type RankTierLite } from '@/components/NetworkExplorer';
import { money } from '@/lib/format';
import { t } from '@/lib/i18n';

interface Leader {
  id: string; fullName: string; referralCode: string; role: string;
  isTeamLeader: boolean; isOwnerRoot: boolean; teamSize: number;
  monthlyGroupVolumeCents: string; monthlyGroupCommissionCents: string;
}

const ALL = '__all__';

interface LeadersMeta { totalLeaders: number; shownLeaders: number; truncated: boolean }

export default function NetworkPage() {
  const [leaders, setLeaders] = useState<Leader[] | null>(null);
  const [meta, setMeta] = useState<LeadersMeta | null>(null);
  const [tiers, setTiers] = useState<RankTierLite[]>([]);
  const [root, setRoot] = useState<{ id: string; name: string } | null>(null); // null = liderler landing
  const [nodes, setNodes] = useState<ApiNode[] | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

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

      {!leaders ? <Loading rows={4} /> : (
        <div className="net-kpis" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {/* tüm ağ */}
          <button className="card hover" style={{ textAlign: 'left', cursor: 'pointer', border: '1px dashed var(--border-strong)' }} onClick={() => openTree(null, 'Whole network')}>
            <div style={{ fontWeight: 750, fontSize: 15 }}>◈ Whole network</div>
            <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>See the entire company as one tree</div>
          </button>

          {leaders.map((l) => (
            <button key={l.id} className="card hover" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => openTree(l.id, l.fullName)}>
              <div className="spread" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 750, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.fullName}</div>
                  <div className="faint" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{l.referralCode}</div>
                </div>
                {l.isOwnerRoot ? <span className="badge active" style={{ fontSize: 9 }}>owner</span> : <span className="badge payable" style={{ fontSize: 9 }}>🎖 leader</span>}
              </div>
              <div className="row" style={{ gap: 14, marginTop: 10 }}>
                <div><div className="faint" style={{ fontSize: 10 }}>Team</div><div style={{ fontWeight: 700 }}>⬡ {l.teamSize}</div></div>
                <div><div className="faint" style={{ fontSize: 10 }}>Revenue (mo)</div><div className="tnum" style={{ fontWeight: 700 }}>◇ {money(l.monthlyGroupVolumeCents)}</div></div>
                <div><div className="faint" style={{ fontSize: 10 }}>Commission (mo)</div><div className="tnum" style={{ fontWeight: 700, color: 'var(--gold-500)' }}>◆ {money(l.monthlyGroupCommissionCents)}</div></div>
              </div>
            </button>
          ))}
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
