'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading } from '@/components/ui';
import { t } from '@/lib/i18n';

interface Node {
  id: string;
  parentId: string | null;
  fullName: string;
  referralCode: string;
  role: string;
  status: string;
  depth: number;
}
interface TreeNode extends Node { children: TreeNode[] }

function build(nodes: Node[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  nodes.forEach((n) => map.set(n.id, { ...n, children: [] }));
  const roots: TreeNode[] = [];
  map.forEach((n) => {
    if (n.parentId && map.has(n.parentId)) map.get(n.parentId)!.children.push(n);
    else roots.push(n);
  });
  return roots;
}

const ROLE_COLOR: Record<string, string> = {
  tenant_owner: 'var(--grad-amber)',
  tenant_admin: 'var(--grad-primary)',
  tenant_staff: 'var(--grad-sky)',
  member: 'rgba(255,255,255,.12)',
};

function Row({ node }: { node: TreeNode }) {
  const [open, setOpen] = useState(node.depth < 2);
  const hasKids = node.children.length > 0;
  return (
    <div>
      <div
        className="row"
        style={{ padding: '8px 10px', borderRadius: 10, marginBottom: 4, marginLeft: node.depth * 22, background: 'rgba(255,255,255,.025)', border: '1px solid var(--border)', cursor: hasKids ? 'pointer' : 'default' }}
        onClick={() => hasKids && setOpen((o) => !o)}
      >
        <span className="faint" style={{ width: 14, fontSize: 11 }}>{hasKids ? (open ? '▾' : '▸') : '·'}</span>
        <span style={{ width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', background: ROLE_COLOR[node.role] ?? 'rgba(255,255,255,.1)', fontWeight: 700, fontSize: 12 }}>
          {node.fullName.charAt(0).toUpperCase()}
        </span>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 600 }}>{node.fullName}</span>
          <span className="faint" style={{ fontSize: 12, marginLeft: 8, fontFamily: 'ui-monospace, monospace' }}>{node.referralCode}</span>
        </div>
        {node.role !== 'member' && <span className="badge active" style={{ fontSize: 10 }}>{node.role}</span>}
        {node.status !== 'active' && <span className="badge inactive" style={{ fontSize: 10 }}>{node.status}</span>}
        {hasKids && <span className="faint" style={{ fontSize: 11 }}>{node.children.length} alt</span>}
      </div>
      {open && node.children.map((ch) => <Row key={ch.id} node={ch} />)}
    </div>
  );
}

export default function TreePage() {
  const [nodes, setNodes] = useState<Node[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Node[]>('/admin/members/tree').then(setNodes).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  const roots = useMemo(() => (nodes ? build(nodes) : []), [nodes]);

  if (error) return <div className="error">{error}</div>;

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.tree')}</div>
      <h1 className="h1 fade-in">Referans agaci</h1>
      <p className="sub fade-in">{nodes?.length ?? 0} uye · seviyeleri gormek icin dugumlere tiklayin.</p>
      <div className="card fade-in delay-1">
        {!nodes ? <Loading rows={5} /> : roots.map((r) => <Row key={r.id} node={r} />)}
      </div>
    </div>
  );
}
