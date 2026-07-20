'use client';

import { ChevronRight } from 'lucide-react';
import type { CSSProperties, KeyboardEvent } from 'react';
import {
  flattenVisibleHierarchy,
  hierarchyNodePresentation,
  type NetworkHierarchyModel,
} from './network-hierarchy.model';
import type { NetworkHierarchyNode } from './types';
import styles from './network-hierarchy.module.css';

interface Props {
  model: NetworkHierarchyModel;
  expandedKeys: ReadonlySet<string>;
  selectedKey?: string | null;
  viewFinancials?: boolean;
  onSelect: (node: NetworkHierarchyNode, key: string) => void;
  onToggle?: (node: NetworkHierarchyNode, key: string, expanded: boolean) => void;
  ariaLabel?: string;
  emptyLabel?: string;
  idPrefix?: string;
}

type DepthStyle = CSSProperties & { '--hierarchy-indent': string };

export function NetworkHierarchyList({
  model,
  expandedKeys,
  selectedKey = null,
  viewFinancials = false,
  onSelect,
  onToggle,
  ariaLabel = 'Referral network list',
  emptyLabel = 'No members are available in this scope.',
  idPrefix = 'network-list',
}: Props) {
  const rows = flattenVisibleHierarchy(model, expandedKeys);
  const indexByKey = new Map(rows.map((row, index) => [row.key, index]));
  const focusAt = (index: number) => document.getElementById(`${idPrefix}-node-${index}`)?.focus();

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const row = rows[index];
    if (!row) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusAt(index + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusAt(event.key === 'Home' ? 0 : rows.length - 1);
      return;
    }
    if (event.key === 'ArrowRight' && row.expandable) {
      event.preventDefault();
      if (!row.expanded) onToggle?.(row.node, row.key, true);
      else {
        const childKey = model.childrenByParent.get(row.key)?.[0];
        if (childKey) focusAt(indexByKey.get(childKey) ?? index);
      }
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (row.expandable && row.expanded) onToggle?.(row.node, row.key, false);
      else if (row.parentKey) focusAt(indexByKey.get(row.parentKey) ?? index);
    }
    // Enter and Space use the native button click behavior.
  };

  if (rows.length === 0) return <p className={styles.emptyState}>{emptyLabel}</p>;
  return (
    <section className={styles.listFrame} aria-label={ariaLabel}>
      <div className={styles.listHeader} aria-hidden="true">
        <span>Member</span>
        <span>Performance</span>
        <span>Status</span>
      </div>
      <ul className={styles.listRoot} role="list">
        {rows.map((row, index) => {
          const presentation = hierarchyNodePresentation(row.node, { viewFinancials });
          return (
            <li key={row.key} className={styles.listItem}>
              <div
                className={styles.listRow}
                style={{ '--hierarchy-indent': `${Math.min(row.depth, 8) * 18}px` } as DepthStyle}
              >
                {row.expandable ? (
                  <button
                    type="button"
                    className={styles.disclosureButton}
                    aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${presentation.title}`}
                    aria-expanded={row.expanded}
                    onClick={() => onToggle?.(row.node, row.key, !row.expanded)}
                    onKeyDown={(event) => handleKeyDown(event, index)}
                  >
                    <ChevronRight aria-hidden="true" data-expanded={row.expanded || undefined} />
                  </button>
                ) : (
                  <span className={styles.disclosurePlaceholder} aria-hidden="true" />
                )}
                <button
                  id={`${idPrefix}-node-${index}`}
                  type="button"
                  className={styles.listButton}
                  data-selected={selectedKey === row.key || undefined}
                  aria-pressed={selectedKey === row.key}
                  aria-expanded={row.expandable ? row.expanded : undefined}
                  onClick={() => onSelect(row.node, row.key)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                >
                  <span className={styles.listIdentity}>
                    <span className={styles.avatar} aria-hidden="true">
                      {row.node.kind === 'cluster' ? '+' : row.node.initials}
                    </span>
                    <span className={styles.nodeCopy}>
                      <span className={styles.eyebrow}>{presentation.eyebrow}</span>
                      <strong>{presentation.title}</strong>
                      <small>{presentation.detail}</small>
                    </span>
                  </span>
                  <span className={styles.listPerformance}>{presentation.performance ?? 'People lens'}</span>
                  <span className={styles.status} data-status={presentation.status}>
                    {presentation.status === 'cluster' ? 'Group' : presentation.status}
                  </span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
