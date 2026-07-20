'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { CircleDollarSign, GitBranch, Landmark, ReceiptText, Scale } from 'lucide-react';
import { money } from '@/lib/format';
import type { ValueFlowNode as ValueFlowNodeModel } from './value-flow.types';
import styles from './value-flow.module.css';

export interface ValueFlowNodeData extends Record<string, unknown> {
  item: ValueFlowNodeModel;
  currency: string;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
}

export type ValueFlowReactNode = Node<ValueFlowNodeData, 'valueFlow'>;

const icons = {
  source: GitBranch,
  stage: ReceiptText,
  rule: Scale,
  liability: Landmark,
} as const;

export function ValueFlowNode({ data }: NodeProps<ValueFlowReactNode>) {
  const { item, currency, selected, dimmed, onSelect } = data;
  const Icon = icons[item.kind] ?? CircleDollarSign;
  const accessibleValue = item.valueCents === undefined ? '' : `, ${money(item.valueCents, currency)}`;
  const accessibleCount = item.count === undefined ? '' : `, ${item.count} approved sale${item.count === 1 ? '' : 's'}`;
  return (
    <>
      {item.kind === 'stage' && <Handle type="target" position={Position.Left} />}
      <button
        type="button"
        className={`${styles.flowNode} nodrag nopan`}
        data-tone={item.tone}
        data-selected={selected || undefined}
        data-dimmed={dimmed || undefined}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(item.id);
        }}
        aria-label={`Inspect ${item.title}${accessibleValue}${accessibleCount}. ${item.detail}`}
        aria-pressed={selected}
      >
        <span className={styles.nodeIcon} aria-hidden="true"><Icon /></span>
        <span className={styles.nodeCopy}>
          <span className={styles.nodeEyebrow}>{item.eyebrow}</span>
          <strong>{item.title}</strong>
          {item.valueCents !== undefined && <span className={styles.nodeValue}>{money(item.valueCents, currency)}</span>}
          {item.count !== undefined && <span className={styles.nodeMeta}>{item.count} approved sale{item.count === 1 ? '' : 's'}</span>}
          {item.kind === 'rule' && <span className={styles.nodeMeta}>Configuration only</span>}
        </span>
      </button>
      {(item.kind === 'source' || item.kind === 'rule' || item.id === 'stage:qualified-sales') && (
        <Handle type="source" position={Position.Right} />
      )}
    </>
  );
}
