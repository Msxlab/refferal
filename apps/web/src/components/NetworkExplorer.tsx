'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { stratify, tree } from 'd3-hierarchy';
import { ChevronRight, Focus, Folder, ListTree, Network, Search, TreePine, User } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { Drawer } from '@/components/Drawer';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
  tenant_owner: 'var(--primary)',
  tenant_admin: 'var(--primary)',
  tenant_staff: 'var(--panel-3)',
  member: 'var(--panel-2)',
};

function roleLabel(role: string) {
  return role.replace('tenant_', '');
}

function RoleBadge({ role }: { role: string }) {
  if (role === 'member') return <span className="text-xs text-muted-foreground">member</span>;
  return <Badge variant="secondary">{roleLabel(role)}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'active' ? 'default' : 'outline'}>{status}</Badge>;
}

function MemberNode({ data }: NodeProps<Node<NodeData>>) {
  const n = data.node;
  const owner = n.role === 'tenant_owner';
  const leadership = owner || n.role === 'tenant_admin';
  return (
    <div
      style={{
        width: 196, background: 'var(--panel)', cursor: 'pointer',
        border: `1px solid ${data.isFocus || data.match ? 'var(--primary)' : 'var(--border)'}`,
        borderRadius: 14, padding: '10px 12px',
        boxShadow: data.match || data.isFocus ? 'var(--shadow-lg)' : 'var(--shadow-card)',
        color: 'var(--text)', transition: 'border-color .2s, box-shadow .2s',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="flex items-center gap-2.5">
        <span style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13,
          color: leadership ? 'var(--on-primary)' : 'var(--text)', background: ROLE_BG[n.role] ?? 'var(--panel-2)', flexShrink: 0, fontFamily: 'var(--font-display)' }}>
          {n.fullName.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{n.fullName}</div>
          <div className="font-mono text-[11px] text-muted-foreground">{n.referralCode}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {n.role !== 'member' && <RoleBadge role={n.role} />}
          {n.status !== 'active' && <StatusBadge status={n.status} />}
        </div>
        {data.team > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Network className="size-3" aria-hidden="true" /> {data.team}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
const nodeTypes = { member: MemberNode };

export function NetworkExplorer({ nodes, title = 'network' }: { nodes: ApiNode[]; title?: string }) {
  const [view, setView] = useState<'tree' | 'list'>('list');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ApiNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'dark' | 'light'>('dark');
  const toggleExpand = (id: string) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  useEffect(() => {
    setMode((document.documentElement.getAttribute('data-theme') as 'dark' | 'light') ?? 'dark');
  }, []);

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

  const subtree = useMemo(() => {
    if (!focusId) return nodes;
    const set: ApiNode[] = [];
    const stack = [byId.get(focusId)].filter(Boolean) as ApiNode[];
    while (stack.length) { const c = stack.pop()!; set.push(c); stack.push(...(childrenOf.get(c.id) ?? [])); }
    return set;
  }, [focusId, nodes, byId, childrenOf]);

  const roots = useMemo(() => subtree.filter((n) => !n.parentId || !subtree.some((m) => m.id === n.parentId)), [subtree]);

  const breadcrumb = useMemo(() => {
    if (!focusId) return [];
    const path: ApiNode[] = [];
    let cur: ApiNode | undefined = byId.get(focusId);
    while (cur) { path.unshift(cur); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
    return path;
  }, [focusId, byId]);

  const q = query.trim().toLowerCase();
  const matches = useCallback((n: ApiNode) => q.length > 0 && (n.fullName.toLowerCase().includes(q) || n.referralCode.toLowerCase().includes(q)), [q]);

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

  const sortKids = (n: ApiNode) => (childrenOf.get(n.id) ?? []).slice().sort((a, b) => a.fullName.localeCompare(b.fullName));
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
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={(next: string) => setView(next as 'tree' | 'list')}>
          <TabsList>
            <TabsTrigger value="tree"><TreePine />Tree</TabsTrigger>
            <TabsTrigger value="list"><ListTree />List</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative min-w-40 flex-1 max-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-8" placeholder="Search name or code" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {view === 'list' && !query && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set(parentIds))}>Expand all</Button>
            <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set())}>Collapse all</Button>
          </>
        )}
        <Badge variant="outline">{subtree.length} {subtree.length === 1 ? 'person' : 'people'}</Badge>
      </div>

      {breadcrumb.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1 text-sm">
          <Button variant="ghost" size="sm" onClick={() => setFocusId(null)}>All</Button>
          {breadcrumb.map((b, i) => (
            <span key={b.id} className="inline-flex items-center gap-1">
              <span className="text-muted-foreground">/</span>
              <Button variant={i === breadcrumb.length - 1 ? 'secondary' : 'ghost'} size="sm" onClick={() => setFocusId(b.id)}>{b.fullName}</Button>
            </span>
          ))}
        </div>
      )}

      {view === 'tree' ? (
        <Card className="h-[66vh] py-0">
          <CardContent className="h-full p-0">
            <ReactFlow
              nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} fitView colorMode={mode}
              onNodeClick={onNodeClick}
              minZoom={0.2} maxZoom={1.8} proOptions={{ hideAttribution: true }}
              nodesDraggable={false} nodesConnectable={false}
            >
              <Background gap={20} size={1} color="var(--border)" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor={() => 'var(--primary)'} maskColor="rgba(15, 28, 51, .45)" style={{ background: 'var(--panel-2)' }} />
            </ReactFlow>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Level</TableHead>
                  <TableHead className="text-right">Team</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {listRows.map(({ n, lasts, hasChildren }) => {
                  const open = !!q || expanded.has(n.id);
                  return (
                    <TableRow key={n.id} className="cursor-pointer" onClick={() => setSelected(n)}>
                      <TableCell>
                        <div className="flex min-h-10 items-stretch">
                          <GuideCells lasts={lasts} />
                          <div className="flex items-center gap-2">
                            {hasChildren ? (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={(e) => { e.stopPropagation(); toggleExpand(n.id); }}
                                aria-label={open ? 'Collapse' : 'Expand'}
                                className={cn('transition-transform', open && 'rotate-90')}
                              >
                                <ChevronRight />
                              </Button>
                            ) : <span className="w-6 shrink-0" />}
                            {hasChildren ? <Folder className="size-4 text-muted-foreground" /> : <User className="size-4 text-muted-foreground" />}
                            <div className="min-w-0">
                              <div className="text-sm font-semibold">{n.fullName}</div>
                              <div className="font-mono text-[11px] text-muted-foreground">{n.referralCode}</div>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><RoleBadge role={n.role} /></TableCell>
                      <TableCell className="text-right tabular-nums">{n.depth}</TableCell>
                      <TableCell className="text-right tabular-nums">{hasChildren ? teamOf(n.id) : '-'}</TableCell>
                      <TableCell><StatusBadge status={n.status} /></TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()} className="text-right">
                        {hasChildren && <Button variant="ghost" size="sm" onClick={() => setFocusId(n.id)}><Focus />Focus</Button>}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {listRows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No members match.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {selected && (
        <Drawer title={selected.fullName} subtitle={`${selected.referralCode} - ${title}`} onClose={() => setSelected(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => { setView('tree'); setQuery(selected.referralCode); setSelected(null); }}><TreePine />Show in tree</Button>
              {teamOf(selected.id) > 0 && <Button onClick={() => { setFocusId(selected.id); setSelected(null); }}><Focus />Focus subtree</Button>}
            </>
          }>
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              {selected.role !== 'member' && <RoleBadge role={selected.role} />}
              <StatusBadge status={selected.status} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Stat label="Level" value={String(selected.depth)} />
              <Stat label="Direct recruits" value={String((childrenOf.get(selected.id) ?? []).length)} />
              <Stat label="Total team" value={String(teamOf(selected.id))} />
              <Stat label="Sponsor" value={selected.parentId ? byId.get(selected.parentId)?.fullName ?? '-' : '- (top)'} />
            </div>
            {(childrenOf.get(selected.id) ?? []).length > 0 && (
              <div>
                <strong className="text-sm">Direct recruits</strong>
                <div className="mt-2 grid gap-2">
                  {(childrenOf.get(selected.id) ?? []).map((c) => (
                    <Button key={c.id} variant="outline" className="h-auto justify-start px-3 py-2 text-left" onClick={() => setSelected(c)}>
                      <span className="text-sm font-semibold">{c.fullName}</span>
                      <span className="font-mono text-xs text-muted-foreground">{c.referralCode}</span>
                      <span className="min-w-2 flex-1" />
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Network className="size-3" />{teamOf(c.id)}</span>
                    </Button>
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

function GuideCells({ lasts }: { lasts: boolean[] }) {
  const depth = lasts.length - 1;
  if (depth <= 0) return <span className="w-1.5 shrink-0" />;
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}
