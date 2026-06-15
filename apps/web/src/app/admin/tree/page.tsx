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

export default function NetworkPage() {
  const [leaders, setLeaders] = useState<Leader[] | null>(null);
  const [tiers, setTiers] = useState<RankTierLite[]>([]);
  const [root, setRoot] = useState<{ id: string; name: string } | null>(null); // null = liderler landing
  const [nodes, setNodes] = useState<ApiNode[] | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

  const loadLeaders = useCallback(() => {
    api.get<{ leaders: Leader[] }>('/admin/members/leaders').then((r) => setLeaders(r.leaders)).catch((e) => setError(String((e as ApiError).message)));
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
      showToast(n.isTeamLeader ? 'Liderlikten çıkarıldı' : 'Lider yapıldı 🎖');
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
          <button className="btn ghost sm" onClick={() => { setRoot(null); setNodes(null); }}>← Liderler</button>
          <div className="eyebrow" style={{ margin: 0 }}>{root.id === ALL ? 'Tüm ağ' : 'Ekip ağacı'}</div>
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
      <h1 className="h1 fade-in">Takım liderleri</h1>
      <p className="sub fade-in" style={{ marginBottom: 16 }}>
        Her lideri ayrı bir ağaç olarak aç — ekibini, satışlarını ve <strong>bu ayki komisyonlarını</strong> canlı gör. Bir üyeyi ağaçta açıp <em>“Lider yap”</em> ile lider işaretleyebilirsin.
      </p>

      {!leaders ? <Loading rows={4} /> : (
        <div className="net-kpis" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {/* tüm ağ */}
          <button className="card hover" style={{ textAlign: 'left', cursor: 'pointer', border: '1px dashed var(--border-strong)' }} onClick={() => openTree(null, 'Tüm ağ')}>
            <div style={{ fontWeight: 750, fontSize: 15 }}>◈ Tüm ağ</div>
            <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>Şirketin tamamını tek ağaçta gör</div>
          </button>

          {leaders.map((l) => (
            <button key={l.id} className="card hover" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => openTree(l.id, l.fullName)}>
              <div className="spread" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 750, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.fullName}</div>
                  <div className="faint" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{l.referralCode}</div>
                </div>
                {l.isOwnerRoot ? <span className="badge active" style={{ fontSize: 9 }}>owner</span> : <span className="badge payable" style={{ fontSize: 9 }}>🎖 lider</span>}
              </div>
              <div className="row" style={{ gap: 14, marginTop: 10 }}>
                <div><div className="faint" style={{ fontSize: 10 }}>Ekip</div><div style={{ fontWeight: 700 }}>⬡ {l.teamSize}</div></div>
                <div><div className="faint" style={{ fontSize: 10 }}>Ciro (ay)</div><div className="tnum" style={{ fontWeight: 700 }}>◇ {money(l.monthlyGroupVolumeCents)}</div></div>
                <div><div className="faint" style={{ fontSize: 10 }}>Komisyon (ay)</div><div className="tnum" style={{ fontWeight: 700, color: 'var(--gold-500)' }}>◆ {money(l.monthlyGroupCommissionCents)}</div></div>
              </div>
            </button>
          ))}
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
