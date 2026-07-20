'use client';

import { useEffect, useMemo } from 'react';
import {
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
} from '@xyflow/react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import type { ValueFlowWorkspace } from './value-flow.types';
import { ValueFlowNode, type ValueFlowReactNode } from './ValueFlowNode';
import styles from './value-flow.module.css';

interface Props {
  workspace: ValueFlowWorkspace;
  selectedId: string;
  search: string;
  onSelect: (id: string) => void;
}

const nodeTypes = { valueFlow: ValueFlowNode };

function FlowControls() {
  const flow = useReactFlow();
  return (
    <div className={styles.flowControls} role="group" aria-label="Network zoom controls">
      <Button type="button" size="icon" variant="outline" onClick={() => flow.zoomIn()} aria-label="Zoom in"><ZoomIn aria-hidden="true" /></Button>
      <Button type="button" size="icon" variant="outline" onClick={() => flow.zoomOut()} aria-label="Zoom out"><ZoomOut aria-hidden="true" /></Button>
      <Button type="button" size="icon" variant="outline" onClick={() => flow.fitView({ padding: 0.12 })} aria-label="Fit network"><Maximize2 aria-hidden="true" /></Button>
    </div>
  );
}

function Canvas({ workspace, selectedId, search, onSelect }: Props) {
  const flow = useReactFlow();
  const term = search.trim().toLocaleLowerCase('en-US');
  const nodes = useMemo<ValueFlowReactNode[]>(() => workspace.flow.nodes.map((item) => {
    const x = item.kind === 'liability' ? 570 : item.kind === 'rule' ? 195 : [16, 195, 390][item.column] ?? 16;
    const y = item.kind === 'liability'
      ? 120 + item.lane * 190
      : item.kind === 'rule'
        ? 420 + (item.lane - 1) * 105
        : item.kind === 'source'
          ? 180 + item.lane * 190
          : 270;
    const searchable = `${item.eyebrow} ${item.title} ${item.detail}`.toLocaleLowerCase('en-US');
    return {
      id: item.id,
      type: 'valueFlow',
      position: { x, y },
      data: {
        item,
        currency: workspace.asOf.currency,
        selected: item.id === selectedId,
        dimmed: Boolean(term && !searchable.includes(term)),
        onSelect,
      },
      draggable: false,
      selectable: false,
    };
  }), [onSelect, search, selectedId, term, workspace]);

  const edges = useMemo<Edge[]>(() => workspace.flow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    markerEnd: edge.kind === 'rule'
      ? undefined
      : { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#0b63f3' },
    className: edge.kind === 'rule' ? styles.ruleEdge : styles.flowEdge,
  })), [workspace.flow.edges]);
  const matchingNodeCount = nodes.filter(({ data }) => !data.dimmed).length;

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = requestAnimationFrame(() => flow.fitView({ padding: 0.12, duration: reduceMotion ? 0 : 220 }));
    return () => cancelAnimationFrame(frame);
  }, [flow, workspace]);

  return (
    <div className={styles.canvasFrame} role="region" aria-label="Referral value-flow network">
      <span className="sr-only" role="status" aria-live="polite">
        {term
          ? `${matchingNodeCount} value-flow node${matchingNodeCount === 1 ? '' : 's'} match the current search.`
          : `${nodes.length} value-flow nodes are available in the network.`}
      </span>
      <ul className="sr-only" aria-label="Value-flow relationships">
        {workspace.flow.edges.map((edge) => {
          const source = workspace.flow.nodes.find(({ id }) => id === edge.source)?.title ?? edge.source;
          const target = workspace.flow.nodes.find(({ id }) => id === edge.target)?.title ?? edge.target;
          return <li key={edge.id}>{edge.kind === 'rule' ? `Configured rule ${source} feeds ${target}.` : `${source} flows into ${target}.`}</li>;
        })}
        <li>Outstanding liability balances are all-time values and are intentionally detached from the current-month flow.</li>
      </ul>
      <div className={styles.canvasLegend}>
        <span><i data-tone="flow" />{workspace.summary.traceReconciled ? 'Reconciled current-month value' : 'Unreconciled network snapshot'}</span>
        <span><i data-tone="liability" />All-time outstanding liabilities</span>
      </div>
      <div className={styles.liabilityLabel}>
        <strong>Outstanding liabilities</strong>
        <span>All time · intentionally detached from the monthly flow</span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.32}
        maxZoom={1.45}
        preventScrolling={false}
        zoomOnScroll={false}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        onNodeClick={(_, node) => onSelect(node.id)}
        proOptions={{ hideAttribution: true }}
        aria-label="Interactive referral value-flow graph"
      >
        <FlowControls />
      </ReactFlow>
    </div>
  );
}

export default function ReferralValueFlowCanvas(props: Props) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
