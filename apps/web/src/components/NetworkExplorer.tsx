'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { stratify, tree } from 'd3-hierarchy';
import { toPng } from 'html-to-image';
import '@xyflow/react/dist/style.css';
import { Drawer } from '@/components/Drawer';

export interface ApiNode {
  id: string;
  parentId: string | null;
  fullName: string;
  referralCode: string;
  role: string;
  status: string;
  depth: number;
  // tree() ucundan gelir (bu ay); platform ag verisinde olmayabilir
  salesCount?: number;
  revenueCents?: string;
  joinedAt?: string;
  earningsCents?: string; // yasam-boyu (payable+paid)
  monthlyCommissionCents?: string; // BU AY komisyon (pending+payable+paid)
  isTeamLeader?: boolean;
}

export interface RankTierLite { name: string; minTeam: number; minEarningsCents: string }

type NodeData = {
  node: ApiNode; team: number; direct: number; match: boolean; isFocus: boolean;
  rank: string | null;
  // isi haritasi: secilen metrige gore tonlama
  revenue: number; sales: number; heatValue: number; heatMax: number;
};

/** kompakt para: $12.3k / $1.2M (dugum rozeti icin). */
function compactMoney(cents: number): string {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1000) return `$${(d / 1000).toFixed(1)}k`;
  return `$${d.toFixed(0)}`;
}

const ROLE_BG: Record<string, string> = {
  tenant_owner: 'var(--foil)',
  tenant_admin: 'var(--foil)',
  tenant_staff: 'rgba(91,124,250,.9)',
  member: 'rgba(255,255,255,.1)',
};

/* ---- ozel agac dugumu ---- */
function MemberNode({ data }: NodeProps<Node<NodeData>>) {
  const n = data.node;
  const owner = n.role === 'tenant_owner';
  // isi haritasi: secilen metrik/max oranina gore altin tonu (0..0.7)
  const intensity = data.heatMax > 0 ? Math.min(0.72, data.heatValue / data.heatMax) : 0;
  const bg = intensity > 0
    ? `color-mix(in srgb, var(--gold-500) ${Math.round(intensity * 100)}%, var(--panel))`
    : 'var(--panel)';
  return (
    <div
      style={{
        width: 196, background: bg, cursor: 'pointer',
        border: `1px solid ${data.isFocus ? 'var(--gold-500)' : data.match ? 'var(--gold-500)' : 'var(--border)'}`,
        borderRadius: 14, padding: '10px 12px',
        boxShadow: data.match || data.isFocus ? 'var(--shadow-glow)' : 'var(--shadow-lg)',
        color: 'var(--text)', transition: 'border-color .2s, box-shadow .2s, background .3s',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13,
          color: owner ? 'var(--on-gold)' : 'var(--text)', background: ROLE_BG[n.role] ?? 'rgba(255,255,255,.1)', flexShrink: 0, fontFamily: 'var(--font-display)' }}>
          {n.fullName.charAt(0).toUpperCase()}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.fullName}</div>
          <div style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'ui-monospace, monospace' }}>{n.referralCode}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {n.isTeamLeader && <span className="badge payable" style={{ fontSize: 9 }}>🎖 lider</span>}
          {n.role !== 'member' && <span className="badge active" style={{ fontSize: 9 }}>{n.role.replace('tenant_', '')}</span>}
          {data.rank && <span className="badge payable" style={{ fontSize: 9 }}>🏅 {data.rank}</span>}
          {n.status !== 'active' && <span className="badge inactive" style={{ fontSize: 9 }}>{n.status}</span>}
        </div>
        <span className="row" style={{ gap: 6 }}>
          {data.revenue > 0 && <span className="tnum" style={{ fontSize: 10, color: 'var(--muted)' }} title={`${data.sales} satış (bu ay)`}>◇ {compactMoney(data.revenue)}</span>}
          {Number(n.monthlyCommissionCents ?? 0) > 0
            ? <span className="tnum" style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold-500)' }} title="Bu ay komisyon (kazanç)">◆ {compactMoney(Number(n.monthlyCommissionCents))}</span>
            : (data.revenue === 0 && data.team > 0 && <span style={{ fontSize: 10, color: 'var(--muted)' }}>⬡ {data.team}</span>)}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
const nodeTypes = { member: MemberNode };

export function NetworkExplorer({ nodes, title = 'network', tiers = [], onToggleLeader }: { nodes: ApiNode[]; title?: string; tiers?: RankTierLite[]; onToggleLeader?: (n: ApiNode) => void }) {
  const [view, setView] = useState<'tree' | 'list'>('list');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ApiNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'dark' | 'light'>('dark');
  const [heat, setHeat] = useState<'none' | 'revenue' | 'earnings'>('none');
  const flowRef = useRef<HTMLDivElement>(null);
  const toggleExpand = (id: string) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // bu ay ciro var mi? (tree ucu doldurur; platform ag verisinde olmayabilir)
  const hasRevenue = useMemo(() => nodes.some((n) => Number(n.revenueCents ?? 0) > 0), [nodes]);

  // react-flow viewport'unu PNG indir
  const exportPng = useCallback(async () => {
    const el = flowRef.current?.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!el) return;
    try {
      const dataUrl = await toPng(el, { backgroundColor: mode === 'dark' ? '#0c0e13' : '#ffffff', pixelRatio: 2, cacheBust: true });
      const a = document.createElement('a');
      a.href = dataUrl; a.download = `${title}-network.png`; a.click();
    } catch { /* export basarisiz — sessiz gec */ }
  }, [mode, title]);

  useEffect(() => {
    setMode((document.documentElement.getAttribute('data-theme') as 'dark' | 'light') ?? 'dark');
  }, []);

  // react-flow dugum tiklamasi (resmi API; dugum-ici DOM tiklamalari react-flow tarafindan yutulur)
  const onNodeClick = useCallback((_e: unknown, node: { id: string }) => {
    const n = nodes.find((x) => x.id === node.id);
    if (n) setSelected(n);
  }, [nodes]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const childrenOf = useMemo(() => {
    const m = new Map<string, ApiNode[]>();
    for (const n of nodes) {
      if (n.parentId && byId.has(n.parentId)) {
        (m.get(n.parentId) ?? m.set(n.parentId, []).get(n.parentId)!).push(n);
      }
    }
    return m;
  }, [nodes, byId]);

  const teamOf = useCallback((id: string): number => {
    let count = 0;
    const stack = [...(childrenOf.get(id) ?? [])];
    while (stack.length) { const c = stack.pop()!; count++; stack.push(...(childrenOf.get(c.id) ?? [])); }
    return count;
  }, [childrenOf]);

  // client-side rutbe: tenant tier'lari + (team, yasam-boyu kazanc) ile kosulan en yuksek tier
  const earningsById = useMemo(() => new Map(nodes.map((n) => [n.id, Number(n.earningsCents ?? 0)])), [nodes]);
  // tier'lari ARTAN sirala (esik->yuksek): en yuksek kosulan tier kazanir, API sirasindan bagimsiz
  const sortedTiers = useMemo(
    () => [...tiers].sort((a, b) => (Number(a.minEarningsCents) - Number(b.minEarningsCents)) || (a.minTeam - b.minTeam)),
    [tiers],
  );
  const rankOf = useCallback((id: string): string | null => {
    if (sortedTiers.length === 0) return null;
    const team = teamOf(id);
    const earn = earningsById.get(id) ?? 0;
    let name: string | null = null;
    for (const t of sortedTiers) { if (team >= t.minTeam && earn >= Number(t.minEarningsCents)) name = t.name; }
    return name;
  }, [sortedTiers, teamOf, earningsById]);

  // alt-agac cirosu (bu ay): dugum + tum torunlarinin revenueCents toplami (memoize)
  const subtreeRevById = useMemo(() => {
    const memo = new Map<string, number>();
    const calc = (id: string): number => {
      const cached = memo.get(id);
      if (cached !== undefined) return cached;
      let sum = Number(byId.get(id)?.revenueCents ?? 0);
      for (const c of childrenOf.get(id) ?? []) sum += calc(c.id);
      memo.set(id, sum);
      return sum;
    };
    for (const n of nodes) calc(n.id);
    return memo;
  }, [nodes, byId, childrenOf]);

  // odak alt-agaci: focusId + tum torunlari
  const subtree = useMemo(() => {
    if (!focusId) return nodes;
    const set: ApiNode[] = [];
    const stack = [byId.get(focusId)].filter(Boolean) as ApiNode[];
    while (stack.length) { const c = stack.pop()!; set.push(c); stack.push(...(childrenOf.get(c.id) ?? [])); }
    return set;
  }, [focusId, nodes, byId, childrenOf]);

  const roots = useMemo(() => subtree.filter((n) => !n.parentId || !subtree.some((m) => m.id === n.parentId)), [subtree]);

  // breadcrumb: kokten focusId'ye yol
  const breadcrumb = useMemo(() => {
    if (!focusId) return [];
    const path: ApiNode[] = [];
    let cur: ApiNode | undefined = byId.get(focusId);
    while (cur) { path.unshift(cur); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
    return path;
  }, [focusId, byId]);

  const q = query.trim().toLowerCase();
  const matches = useCallback((n: ApiNode) => q.length > 0 && (n.fullName.toLowerCase().includes(q) || n.referralCode.toLowerCase().includes(q)), [q]);

  // isi haritasi degeri: secilen metrik (none → 0); max ile normalize edilir
  const heatVal = useCallback((n: ApiNode) => heat === 'revenue' ? Number(n.revenueCents ?? 0) : heat === 'earnings' ? Number(n.earningsCents ?? 0) : 0, [heat]);
  const heatMax = useMemo(() => heat === 'none' ? 0 : Math.max(0, ...subtree.map(heatVal)), [heat, subtree, heatVal]);

  // ---- ag analitigi (odaklanilan kapsama gore) ----
  const analytics = useMemo(() => {
    const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
    let active = 0, newThisMonth = 0, revenue = 0, earnings = 0, monthlyComm = 0, maxDepth = 0;
    let top: { name: string; cents: number } | null = null;
    const minDepth = Math.min(...subtree.map((n) => n.depth));
    for (const n of subtree) {
      if (n.status === 'active') active++;
      if (n.joinedAt && new Date(n.joinedAt) >= startOfMonth) newThisMonth++;
      revenue += Number(n.revenueCents ?? 0);
      monthlyComm += Number(n.monthlyCommissionCents ?? 0);
      const e = Number(n.earningsCents ?? 0);
      earnings += e;
      if (!top || e > top.cents) top = { name: n.fullName, cents: e };
      maxDepth = Math.max(maxDepth, n.depth - minDepth);
    }
    return { people: subtree.length, active, newThisMonth, revenue, earnings, monthlyComm, maxDepth, top };
  }, [subtree]);
  const hasEarnings = useMemo(() => subtree.some((n) => Number(n.earningsCents ?? 0) > 0), [subtree]);

  // ag CSV disa aktarim (odaklanilan kapsam + hesaplanan metrikler)
  const exportCsv = useCallback(() => {
    const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const header = ['Name', 'Code', 'Role', 'Status', 'Level', 'Sponsor', 'Direct', 'Team', 'Joined', 'Revenue(mo)', 'Commission(mo)', 'LifetimeEarnings', 'Rank', 'SubtreeRevenue(mo)'];
    const lines = [header.join(',')];
    for (const n of subtree) {
      lines.push([
        esc(n.fullName), esc(n.referralCode), esc(n.role), esc(n.status), n.depth,
        esc(n.parentId ? byId.get(n.parentId)?.fullName ?? '' : ''),
        (childrenOf.get(n.id) ?? []).length, teamOf(n.id),
        esc(n.joinedAt ? new Date(n.joinedAt).toISOString().slice(0, 10) : ''),
        (Number(n.revenueCents ?? 0) / 100).toFixed(2),
        (Number(n.monthlyCommissionCents ?? 0) / 100).toFixed(2),
        (Number(n.earningsCents ?? 0) / 100).toFixed(2),
        esc(rankOf(n.id) ?? ''),
        ((subtreeRevById.get(n.id) ?? 0) / 100).toFixed(2),
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${title}-network.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [subtree, byId, childrenOf, teamOf, rankOf, subtreeRevById, title]);

  /* ---- agac layout ---- */
  const { rfNodes, rfEdges } = useMemo<{ rfNodes: Node<NodeData>[]; rfEdges: Edge[] }>(() => {
    if (subtree.length === 0) return { rfNodes: [], rfEdges: [] };
    const VIRTUAL = '__root__';
    const flat = roots.length === 1
      ? subtree.map((n) => ({ ...n, parentId: n.parentId && subtree.some((m) => m.id === n.parentId) ? n.parentId : null }))
      : [{ id: VIRTUAL, parentId: null, fullName: '', referralCode: '', role: 'member', status: 'active', depth: -1 } as ApiNode,
         ...subtree.map((n) => ({ ...n, parentId: roots.some((r) => r.id === n.id) ? VIRTUAL : n.parentId }))];
    const root = stratify<ApiNode>().id((d) => d.id).parentId((d) => d.parentId)(flat);
    tree<ApiNode>().nodeSize([228, 150])(root as never);
    const ns: Node<NodeData>[] = [];
    const es: Edge[] = [];
    root.each((d) => {
      const id = d.id as string;
      if (id === VIRTUAL) return;
      const n = d.data;
      ns.push({
        id, type: 'member',
        position: { x: (d as unknown as { x: number }).x, y: (d as unknown as { y: number }).y },
        data: {
          node: n, team: teamOf(id), direct: (childrenOf.get(id) ?? []).length, match: matches(n), isFocus: id === focusId,
          rank: rankOf(id), revenue: Number(n.revenueCents ?? 0), sales: n.salesCount ?? 0, heatValue: heatVal(n), heatMax,
        },
      });
      if (d.parent && d.parent.id !== VIRTUAL) {
        es.push({ id: `${d.parent.id}-${id}`, source: d.parent.id as string, target: id, type: 'smoothstep', style: { stroke: 'var(--border-strong)', strokeWidth: 1.5 } });
      }
    });
    return { rfNodes: ns, rfEdges: es };
  }, [subtree, roots, focusId, teamOf, childrenOf, matches, rankOf, heatVal, heatMax]);

  /* ---- liste = koleps-edilebilir klasor agaci. Kapali baslar (yalniz kokler = ilk kisiler).
         Arama: eslesen + atalari acik gosterilir. ---- */
  const sortKids = (n: ApiNode) => (childrenOf.get(n.id) ?? []).slice().sort((a, b) => a.fullName.localeCompare(b.fullName));
  // her satir: lasts[] = kokten kendisine kadar her dugumun "son cocuk mu" bayragi (klavuz cizgileri icin)
  const listRows = useMemo(() => {
    const out: Array<{ n: ApiNode; lasts: boolean[]; hasChildren: boolean }> = [];
    const has = (n: ApiNode) => (childrenOf.get(n.id) ?? []).length > 0;
    if (q) {
      const matchIds = new Set(subtree.filter((n) => n.fullName.toLowerCase().includes(q) || n.referralCode.toLowerCase().includes(q)).map((n) => n.id));
      if (matchIds.size === 0) return out;
      const keep = new Set<string>();
      for (const id of matchIds) {
        let cur: ApiNode | undefined = byId.get(id);
        while (cur) { keep.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
      }
      const walk = (n: ApiNode, lasts: boolean[]) => {
        const kids = sortKids(n).filter((c) => keep.has(c.id));
        out.push({ n, lasts, hasChildren: has(n) });
        kids.forEach((c, idx) => walk(c, [...lasts, idx === kids.length - 1]));
      };
      const vis = roots.filter((r) => keep.has(r.id));
      vis.forEach((r, idx) => walk(r, [idx === vis.length - 1]));
    } else {
      const walk = (n: ApiNode, lasts: boolean[]) => {
        const kids = sortKids(n);
        out.push({ n, lasts, hasChildren: kids.length > 0 });
        if (expanded.has(n.id)) kids.forEach((c, idx) => walk(c, [...lasts, idx === kids.length - 1]));
      };
      roots.forEach((r, idx) => walk(r, [idx === roots.length - 1]));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, childrenOf, expanded, q, subtree, byId]);

  const parentIds = useMemo(() => subtree.filter((n) => (childrenOf.get(n.id) ?? []).length > 0).map((n) => n.id), [subtree, childrenOf]);

  return (
    <div>
      {/* ---- ag analitigi seridi ---- */}
      <div className="net-kpis" style={{ marginBottom: 14 }}>
        <Kpi label={focusId ? 'Bu kolda' : 'Toplam kişi'} value={String(analytics.people)} icon="⬡" />
        <Kpi label="Aktif" value={`${analytics.active}`} sub={analytics.people ? `%${Math.round((analytics.active / analytics.people) * 100)}` : undefined} icon="●" />
        <Kpi label="Derinlik" value={String(analytics.maxDepth)} icon="⤳" />
        <Kpi label="Bu ay katılan" value={String(analytics.newThisMonth)} icon="✦" />
        <Kpi label="Ciro (bu ay)" value={compactMoney(analytics.revenue)} icon="◇" />
        <Kpi label="Komisyon (bu ay)" value={compactMoney(analytics.monthlyComm)} icon="◆" />
        {hasEarnings && <Kpi label="Yaşam-boyu kazanç" value={compactMoney(analytics.earnings)} icon="$" />}
        {analytics.top && analytics.top.cents > 0 && <Kpi label="En çok kazanan" value={analytics.top.name} sub={compactMoney(analytics.top.cents)} icon="★" />}
      </div>

      {/* ---- temiz arac cubugu ---- */}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <div className="seg-tabs" role="tablist" style={{ padding: 4 }}>
          <button className={`seg-tab ${view === 'tree' ? 'on' : ''}`} onClick={() => setView('tree')}>⤳ Tree</button>
          <button className={`seg-tab ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')}>☰ List</button>
        </div>
        <input placeholder="Search name or code…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 240, flex: 1, minWidth: 160 }} />
        {view === 'list' && !query && (
          <>
            <button className="btn ghost sm" onClick={() => setExpanded(new Set(parentIds))}>Expand all</button>
            <button className="btn ghost sm" onClick={() => setExpanded(new Set())}>Collapse all</button>
          </>
        )}
        {(hasRevenue || hasEarnings) && (
          <button
            className={`btn sm ${heat === 'none' ? 'ghost' : ''}`}
            onClick={() => setHeat((h) => h === 'none' ? 'revenue' : h === 'revenue' ? 'earnings' : 'none')}
            title="Düğümleri metriğe göre ısı-haritasıyla tonla"
          >◉ Isı: {heat === 'none' ? 'kapalı' : heat === 'revenue' ? 'ciro' : 'kazanç'}</button>
        )}
        <button className="btn ghost sm" onClick={exportCsv}>⇩ CSV</button>
        {view === 'tree' && <button className="btn ghost sm" onClick={exportPng}>⇩ PNG</button>}
        <span className="faint" style={{ fontSize: 12 }}>{subtree.length} {subtree.length === 1 ? 'person' : 'people'}</span>
      </div>

      {/* ---- breadcrumb (odak) ---- */}
      {breadcrumb.length > 0 && (
        <div className="row" style={{ gap: 6, marginBottom: 10, fontSize: 12, flexWrap: 'wrap' }}>
          <button className="link-crumb" onClick={() => setFocusId(null)} style={crumbStyle(false)}>All</button>
          {breadcrumb.map((b, i) => (
            <span key={b.id} className="row" style={{ gap: 6 }}>
              <span className="faint">/</span>
              <button onClick={() => setFocusId(b.id)} style={crumbStyle(i === breadcrumb.length - 1)}>{b.fullName}</button>
            </span>
          ))}
        </div>
      )}

      {view === 'tree' ? (
        <div ref={flowRef} className="card" style={{ padding: 0, overflow: 'hidden', height: '66vh' }}>
          <ReactFlow
            nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} fitView colorMode={mode}
            onNodeClick={onNodeClick}
            minZoom={0.2} maxZoom={1.8} proOptions={{ hideAttribution: true }}
            nodesDraggable={false} nodesConnectable={false}
          >
            <Background gap={20} size={1} color="var(--border)" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={() => 'var(--gold-600)'} maskColor="rgba(0,0,0,.5)" style={{ background: 'var(--panel-2)' }} />
          </ReactFlow>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead><tr><th>Member</th><th>Role</th><th style={{ textAlign: 'right' }}>Level</th><th style={{ textAlign: 'right' }}>Team</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {listRows.map(({ n, lasts, hasChildren }) => {
                const open = !!q || expanded.has(n.id);
                return (
                  <tr key={n.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(n)}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 40 }}>
                        <GuideCells lasts={lasts} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {hasChildren ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleExpand(n.id); }}
                              aria-label={open ? 'Collapse' : 'Expand'}
                              style={{ width: 20, height: 20, display: 'grid', placeItems: 'center', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 10, flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' }}
                            >▶</button>
                          ) : <span style={{ width: 20, flexShrink: 0 }} />}
                          <span style={{ flexShrink: 0, fontSize: 15 }}>{hasChildren ? '🗂' : '👤'}</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                              {n.fullName}
                              {Number(n.revenueCents ?? 0) > 0 && <span className="tnum" style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold-500)' }} title={`${n.salesCount ?? 0} sales this month`}>◆ {compactMoney(Number(n.revenueCents))}</span>}
                            </div>
                            <div className="faint" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{n.referralCode}</div>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{n.role !== 'member' ? <span className="badge active" style={{ fontSize: 9 }}>{n.role.replace('tenant_', '')}</span> : <span className="faint" style={{ fontSize: 12 }}>member</span>}</td>
                    <td className="tnum" style={{ textAlign: 'right' }}>{n.depth}</td>
                    <td className="tnum" style={{ textAlign: 'right' }}>{hasChildren ? teamOf(n.id) : '—'}</td>
                    <td><span className={`badge ${n.status === 'active' ? 'active' : 'inactive'}`} style={{ fontSize: 9 }}>{n.status}</span></td>
                    <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                      {hasChildren && <button className="btn ghost sm" onClick={() => setFocusId(n.id)}>Focus ⤢</button>}
                    </td>
                  </tr>
                );
              })}
              {listRows.length === 0 && <tr><td colSpan={6} className="muted">No members match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <Drawer title={selected.fullName} subtitle={`${selected.referralCode} · ${title}`} onClose={() => setSelected(null)}
          footer={
            <>
              {onToggleLeader && <button className="btn ghost" onClick={() => { onToggleLeader(selected); setSelected(null); }}>{selected.isTeamLeader ? '🎖 Liderlikten çıkar' : '🎖 Lider yap'}</button>}
              <button className="btn ghost" onClick={() => { setView('tree'); setQuery(selected.referralCode); setSelected(null); }}>Show in tree ⤳</button>
              {teamOf(selected.id) > 0 && <button className="btn" onClick={() => { setFocusId(selected.id); setSelected(null); }}>Focus subtree ⤢</button>}
            </>
          }>
          <div className="grid" style={{ gap: 16 }}>
            <div className="row" style={{ gap: 8 }}>
              {selected.role !== 'member' && <span className="badge active" style={{ fontSize: 10 }}>{selected.role.replace('tenant_', '')}</span>}
              {rankOf(selected.id) && <span className="badge payable" style={{ fontSize: 10 }}>🏅 {rankOf(selected.id)}</span>}
              <span className={`badge ${selected.status === 'active' ? 'active' : 'inactive'}`} style={{ fontSize: 10 }}>{selected.status}</span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Stat label="Level" value={String(selected.depth)} />
              <Stat label="Direct recruits" value={String((childrenOf.get(selected.id) ?? []).length)} />
              <Stat label="Total team" value={String(teamOf(selected.id))} />
              <Stat label="Sponsor" value={selected.parentId ? byId.get(selected.parentId)?.fullName ?? '—' : '— (top)'} />
              {Number(selected.monthlyCommissionCents ?? 0) > 0 && <Stat label="Komisyon (bu ay)" value={compactMoney(Number(selected.monthlyCommissionCents))} />}
              {Number(selected.earningsCents ?? 0) > 0 && <Stat label="Lifetime earnings" value={compactMoney(Number(selected.earningsCents))} />}
              {Number(selected.revenueCents ?? 0) > 0 && <Stat label="Revenue (this mo)" value={compactMoney(Number(selected.revenueCents))} />}
              {(subtreeRevById.get(selected.id) ?? 0) > 0 && <Stat label="Subtree revenue (mo)" value={compactMoney(subtreeRevById.get(selected.id) ?? 0)} />}
              {selected.joinedAt && <Stat label="Joined" value={new Date(selected.joinedAt).toLocaleDateString()} />}
            </div>
            {(childrenOf.get(selected.id) ?? []).length > 0 && (
              <div>
                <strong style={{ fontSize: 13 }}>Direct recruits</strong>
                <div className="grid" style={{ gap: 6, marginTop: 8 }}>
                  {(childrenOf.get(selected.id) ?? []).map((c) => (
                    <button key={c.id} className="row" onClick={() => setSelected(c)}
                      style={{ gap: 8, padding: '7px 10px', borderRadius: 9, background: 'var(--panel-2)', border: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left' }}>
                      <span style={{ fontWeight: 600, fontSize: 12.5 }}>{c.fullName}</span>
                      <span className="faint" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{c.referralCode}</span>
                      <span style={{ flex: 1 }} />
                      <span className="faint" style={{ fontSize: 11 }}>⬡ {teamOf(c.id)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Drawer>
      )}
    </div>
  );
}

/** Dosya-gezgini klavuz cizgileri: her seviye icin dikey cizgi + konnektor (├/└). */
function GuideCells({ lasts }: { lasts: boolean[] }) {
  const depth = lasts.length - 1;
  if (depth <= 0) return <span style={{ width: 6, flexShrink: 0 }} />;
  return (
    <>
      {Array.from({ length: depth }).map((_, j) => {
        const idx = j + 1;
        const isConn = idx === depth;
        const last = lasts[idx];
        const drawV = isConn ? true : !last;
        return (
          <span key={j} aria-hidden style={{ position: 'relative', width: 22, flexShrink: 0, alignSelf: 'stretch' }}>
            {drawV && <i style={{ position: 'absolute', left: '50%', top: 0, bottom: isConn && last ? '50%' : 0, borderLeft: '1.5px solid var(--border-strong)' }} />}
            {isConn && <i style={{ position: 'absolute', left: '50%', right: 2, top: '50%', borderTop: '1.5px solid var(--border-strong)' }} />}
          </span>
        );
      })}
    </>
  );
}

function crumbStyle(active: boolean): React.CSSProperties {
  return { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 500, color: active ? 'var(--gold-500)' : 'var(--muted)' };
}
function Kpi({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: string }) {
  return (
    <div className="net-kpi">
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        {icon && <span className="net-kpi-ic" aria-hidden>{icon}</span>}
        <span className="faint" style={{ fontSize: 11 }}>{label}</span>
      </div>
      <div style={{ fontWeight: 750, fontSize: 17, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div className="faint" style={{ fontSize: 11 }}>{sub}</div>}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 15, marginTop: 2 }}>{value}</div>
    </div>
  );
}
