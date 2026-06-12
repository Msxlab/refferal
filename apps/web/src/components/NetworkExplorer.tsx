'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { hierarchy, stratify, tree } from 'd3-hierarchy';
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
}

type NodeData = { node: ApiNode; team: number; direct: number; match: boolean; isFocus: boolean };

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
  return (
    <div
      style={{
        width: 196, background: 'var(--panel)', cursor: 'pointer',
        border: `1px solid ${data.isFocus ? 'var(--gold-500)' : data.match ? 'var(--gold-500)' : 'var(--border)'}`,
        borderRadius: 14, padding: '10px 12px',
        boxShadow: data.match || data.isFocus ? 'var(--shadow-glow)' : 'var(--shadow-lg)',
        color: 'var(--text)', transition: 'border-color .2s, box-shadow .2s',
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
          {n.role !== 'member' && <span className="badge active" style={{ fontSize: 9 }}>{n.role.replace('tenant_', '')}</span>}
          {n.status !== 'active' && <span className="badge inactive" style={{ fontSize: 9 }}>{n.status}</span>}
        </div>
        {data.team > 0 && <span style={{ fontSize: 10, color: 'var(--muted)' }}>⬡ {data.team}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
const nodeTypes = { member: MemberNode };

export function NetworkExplorer({ nodes, title = 'network' }: { nodes: ApiNode[]; title?: string }) {
  const [view, setView] = useState<'tree' | 'list'>('tree');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ApiNode | null>(null);
  const [mode, setMode] = useState<'dark' | 'light'>('dark');

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
        data: { node: n, team: teamOf(id), direct: (childrenOf.get(id) ?? []).length, match: matches(n), isFocus: id === focusId },
      });
      if (d.parent && d.parent.id !== VIRTUAL) {
        es.push({ id: `${d.parent.id}-${id}`, source: d.parent.id as string, target: id, type: 'smoothstep', style: { stroke: 'var(--border-strong)', strokeWidth: 1.5 } });
      }
    });
    return { rfNodes: ns, rfEdges: es };
  }, [subtree, roots, focusId, teamOf, childrenOf, matches]);

  /* ---- liste (girintili DFS) ---- */
  const listRows = useMemo(() => {
    const out: Array<{ n: ApiNode; rel: number }> = [];
    const walk = (n: ApiNode, rel: number) => {
      out.push({ n, rel });
      for (const c of (childrenOf.get(n.id) ?? []).sort((a, b) => a.fullName.localeCompare(b.fullName))) walk(c, rel + 1);
    };
    roots.forEach((r) => walk(r, 0));
    return q ? out.filter(({ n }) => n.fullName.toLowerCase().includes(q) || n.referralCode.toLowerCase().includes(q)) : out;
  }, [roots, childrenOf, q]);

  return (
    <div>
      {/* ---- temiz arac cubugu ---- */}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <div className="seg-tabs" role="tablist" style={{ padding: 4 }}>
          <button className={`seg-tab ${view === 'tree' ? 'on' : ''}`} onClick={() => setView('tree')}>⤳ Tree</button>
          <button className={`seg-tab ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')}>☰ List</button>
        </div>
        <input placeholder="Search name or code…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 240, flex: 1, minWidth: 160 }} />
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
        <div className="card" style={{ padding: 0, overflow: 'hidden', height: '66vh' }}>
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
              {listRows.map(({ n, rel }) => (
                <tr key={n.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(n)}>
                  <td>
                    <div className="row" style={{ gap: 8, paddingLeft: q ? 0 : rel * 20 }}>
                      {!q && rel > 0 && <span className="faint" style={{ fontSize: 11 }}>↳</span>}
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{n.fullName}</div>
                        <div className="faint" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{n.referralCode}</div>
                      </div>
                    </div>
                  </td>
                  <td>{n.role !== 'member' ? <span className="badge active" style={{ fontSize: 9 }}>{n.role.replace('tenant_', '')}</span> : <span className="faint" style={{ fontSize: 12 }}>member</span>}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{n.depth}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{teamOf(n.id)}</td>
                  <td><span className={`badge ${n.status === 'active' ? 'active' : 'inactive'}`} style={{ fontSize: 9 }}>{n.status}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {teamOf(n.id) > 0 && <button className="btn ghost sm" onClick={() => setFocusId(n.id)}>Focus ⤢</button>}
                  </td>
                </tr>
              ))}
              {listRows.length === 0 && <tr><td colSpan={6} className="muted">No members match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <Drawer title={selected.fullName} subtitle={`${selected.referralCode} · ${title}`} onClose={() => setSelected(null)}
          footer={teamOf(selected.id) > 0 && <button className="btn" onClick={() => { setFocusId(selected.id); setSelected(null); }}>Focus subtree ⤢</button>}>
          <div className="grid" style={{ gap: 16 }}>
            <div className="row" style={{ gap: 8 }}>
              {selected.role !== 'member' && <span className="badge active" style={{ fontSize: 10 }}>{selected.role.replace('tenant_', '')}</span>}
              <span className={`badge ${selected.status === 'active' ? 'active' : 'inactive'}`} style={{ fontSize: 10 }}>{selected.status}</span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Stat label="Level" value={String(selected.depth)} />
              <Stat label="Direct recruits" value={String((childrenOf.get(selected.id) ?? []).length)} />
              <Stat label="Total team" value={String(teamOf(selected.id))} />
              <Stat label="Sponsor" value={selected.parentId ? byId.get(selected.parentId)?.fullName ?? '—' : '— (top)'} />
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

function crumbStyle(active: boolean): React.CSSProperties {
  return { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 500, color: active ? 'var(--gold-500)' : 'var(--muted)' };
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 15, marginTop: 2 }}>{value}</div>
    </div>
  );
}
