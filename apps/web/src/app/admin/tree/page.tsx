'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { hierarchy, stratify, tree } from 'd3-hierarchy';
import '@xyflow/react/dist/style.css';
import { api, ApiError } from '@/lib/api';
import { Loading } from '@/components/ui';
import { t } from '@/lib/i18n';

interface ApiNode {
  id: string;
  parentId: string | null;
  fullName: string;
  referralCode: string;
  role: string;
  status: string;
  depth: number;
}

type MemberData = {
  name: string;
  code: string;
  role: string;
  status: string;
  depth: number;
  team: number;
  match: boolean;
};

const ROLE_GRAD: Record<string, string> = {
  tenant_owner: 'var(--foil)',
  tenant_admin: 'var(--foil)',
  tenant_staff: 'rgba(91,124,250,.9)',
  member: 'rgba(255,255,255,.12)',
};

/* ---- ozel dugum karti ---- */
function MemberNode({ data }: NodeProps<Node<MemberData>>) {
  const owner = data.role === 'tenant_owner';
  return (
    <div
      style={{
        width: 188,
        background: 'var(--panel)',
        border: `1px solid ${data.match ? 'var(--gold-500)' : 'var(--border)'}`,
        borderRadius: 14,
        padding: '10px 12px',
        boxShadow: data.match ? 'var(--shadow-glow)' : 'var(--shadow-lg)',
        color: 'var(--text)',
        transition: 'border-color .2s, box-shadow .2s',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center',
            fontWeight: 800, fontSize: 13, color: owner ? 'var(--on-gold)' : 'var(--text)',
            background: ROLE_GRAD[data.role] ?? 'rgba(255,255,255,.1)', flexShrink: 0,
            fontFamily: 'var(--font-display)',
          }}
        >
          {data.name.charAt(0).toUpperCase()}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {data.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'ui-monospace, monospace' }}>{data.code}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {data.role !== 'member' && <span className="badge active" style={{ fontSize: 9 }}>{data.role.replace('tenant_', '')}</span>}
          {data.status !== 'active' && <span className="badge inactive" style={{ fontSize: 9 }}>{data.status}</span>}
        </div>
        {data.team > 0 && <span style={{ fontSize: 10, color: 'var(--muted)' }}>⬡ {data.team}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />
    </div>
  );
}

const nodeTypes = { member: MemberNode };

export default function NetworkPage() {
  const [raw, setRaw] = useState<ApiNode[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    setMode((document.documentElement.getAttribute('data-theme') as 'dark' | 'light') ?? 'dark');
    api.get<ApiNode[]>('/admin/members/tree').then(setRaw).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  const { nodes, edges } = useMemo<{ nodes: Node<MemberData>[]; edges: Edge[] }>(() => {
    if (!raw || raw.length === 0) return { nodes: [], edges: [] };
    // coklu kok ihtimaline karsi sanal kok
    const roots = raw.filter((n) => !n.parentId || !raw.some((m) => m.id === n.parentId));
    const VIRTUAL = '__root__';
    const flat =
      roots.length === 1
        ? raw.map((n) => ({ ...n, parentId: n.parentId && raw.some((m) => m.id === n.parentId) ? n.parentId : null }))
        : [
            { id: VIRTUAL, parentId: null, fullName: '', referralCode: '', role: 'member', status: 'active', depth: -1 },
            ...raw.map((n) => ({ ...n, parentId: roots.some((r) => r.id === n.id) ? VIRTUAL : n.parentId })),
          ];

    const root = stratify<(typeof flat)[number]>().id((d) => d.id).parentId((d) => d.parentId)(flat);
    tree<(typeof flat)[number]>().nodeSize([220, 150])(root as never);
    const q = query.trim().toLowerCase();

    const teamOf = new Map<string, number>();
    root.each((d) => teamOf.set(d.id ?? '', (hierarchy(d).descendants().length - 1)));

    const ns: Node<MemberData>[] = [];
    const es: Edge[] = [];
    root.each((d) => {
      const id = d.id as string;
      if (id === VIRTUAL) return;
      const n = d.data;
      const px = (d as unknown as { x: number }).x;
      const py = (d as unknown as { y: number }).y;
      ns.push({
        id,
        type: 'member',
        position: { x: px, y: py },
        data: {
          name: n.fullName, code: n.referralCode, role: n.role, status: n.status, depth: n.depth,
          team: teamOf.get(id) ?? 0,
          match: q.length > 0 && (n.fullName.toLowerCase().includes(q) || n.referralCode.toLowerCase().includes(q)),
        },
      });
      const parent = d.parent;
      if (parent && parent.id !== VIRTUAL) {
        es.push({ id: `${parent.id}-${id}`, source: parent.id as string, target: id, type: 'smoothstep', style: { stroke: 'var(--border-strong)', strokeWidth: 1.5 } });
      }
    });
    return { nodes: ns, edges: es };
  }, [raw, query]);

  const onInit = useCallback(() => {}, []);

  if (error) return <div className="error">{error}</div>;

  return (
    <div>
      <div className="spread">
        <div>
          <div className="eyebrow fade-in">{t('nav.tree')}</div>
          <h1 className="h1 fade-in">Referral network</h1>
          <p className="sub fade-in" style={{ marginBottom: 14 }}>{raw?.length ?? 0} members · drag to pan, scroll to zoom, search to highlight.</p>
        </div>
        <input
          placeholder="Search name or code…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 240 }}
        />
      </div>

      <div className="card fade-in delay-1" style={{ padding: 0, overflow: 'hidden', height: '72vh' }}>
        {!raw ? (
          <div style={{ padding: 20 }}><Loading rows={5} /></div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={onInit}
            fitView
            colorMode={mode}
            minZoom={0.2}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
          >
            <Background gap={20} size={1} color="var(--border)" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={() => 'var(--gold-600)'} maskColor="rgba(0,0,0,.5)" style={{ background: 'var(--panel-2)' }} />
          </ReactFlow>
        )}
      </div>

      <div className="row fade-in" style={{ gap: 16, marginTop: 12, fontSize: 12 }}>
        <span className="muted">Legend:</span>
        <span className="row" style={{ gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 4, background: 'var(--foil)' }} /> Owner / Admin</span>
        <span className="row" style={{ gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 4, background: 'rgba(91,124,250,.9)' }} /> Staff</span>
        <span className="row" style={{ gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 4, background: 'rgba(255,255,255,.18)' }} /> Member</span>
        <span className="faint">⬡ = team size</span>
      </div>
    </div>
  );
}
