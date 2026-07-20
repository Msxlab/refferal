'use client';

import { ChevronRight } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import {
  flattenVisibleHierarchy,
  hierarchyNodePresentation,
  isHierarchyNodeExpandable,
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

export function NetworkHierarchyTree({
  model,
  expandedKeys,
  selectedKey = null,
  viewFinancials = false,
  onSelect,
  onToggle,
  ariaLabel = 'Referral network hierarchy',
  emptyLabel = 'No members are available in this scope.',
  idPrefix = 'network-tree',
}: Props) {
  const visibleRows = flattenVisibleHierarchy(model, expandedKeys);
  const visibleIndex = new Map(visibleRows.map((row, index) => [row.key, index]));
  const nodeIndex = new Map([...model.nodesByKey.keys()].map((key, index) => [key, index]));

  const focusKey = (key: string | undefined) => {
    const index = key === undefined ? undefined : nodeIndex.get(key);
    if (index !== undefined) document.getElementById(`${idPrefix}-node-${index}`)?.focus();
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    node: NetworkHierarchyNode,
    key: string,
    expandable: boolean,
    expanded: boolean,
  ) => {
    const index = visibleIndex.get(key) ?? -1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      focusKey(visibleRows[index + offset]?.key);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusKey(event.key === 'Home' ? visibleRows[0]?.key : visibleRows.at(-1)?.key);
      return;
    }
    if (event.key === 'ArrowRight' && expandable) {
      event.preventDefault();
      if (!expanded) onToggle?.(node, key, true);
      else focusKey(model.childrenByParent.get(key)?.[0]);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (expandable && expanded) onToggle?.(node, key, false);
      else focusKey(model.parentByKey.get(key) ?? undefined);
    }
    // Enter and Space keep the native button activation path and select the node.
  };

  const renderItems = (keys: readonly string[], depth: number) =>
    keys.map((key) => {
      const node = model.nodesByKey.get(key);
      if (!node) return null;
      const children = model.childrenByParent.get(key) ?? [];
      const expandable = isHierarchyNodeExpandable(node, children.length > 0);
      const expanded = expandable && expandedKeys.has(key);
      const presentation = hierarchyNodePresentation(node, { viewFinancials });
      const index = nodeIndex.get(key) ?? 0;
      const groupId = `${idPrefix}-group-${index}`;
      return (
        <li key={key} className={styles.treeItem} role="treeitem" aria-level={depth + 1}>
          <div className={styles.nodeRow}>
            {expandable ? (
              <button
                type="button"
                className={styles.disclosureButton}
                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${presentation.title}`}
                aria-expanded={expanded}
                aria-controls={groupId}
                onClick={() => onToggle?.(node, key, !expanded)}
                onKeyDown={(event) => handleKeyDown(event, node, key, expandable, expanded)}
              >
                <ChevronRight aria-hidden="true" data-expanded={expanded || undefined} />
              </button>
            ) : (
              <span className={styles.disclosurePlaceholder} aria-hidden="true" />
            )}
            <button
              id={`${idPrefix}-node-${index}`}
              type="button"
              className={styles.nodeButton}
              data-selected={selectedKey === key || undefined}
              data-status={presentation.status}
              aria-pressed={selectedKey === key}
              aria-expanded={expandable ? expanded : undefined}
              aria-controls={expandable ? groupId : undefined}
              onClick={() => onSelect(node, key)}
              onKeyDown={(event) => handleKeyDown(event, node, key, expandable, expanded)}
            >
              <span className={styles.avatar} aria-hidden="true">
                {node.kind === 'cluster' ? '+' : node.initials}
              </span>
              <span className={styles.nodeCopy}>
                <span className={styles.eyebrow}>{presentation.eyebrow}</span>
                <strong>{presentation.title}</strong>
                <small>{presentation.detail}</small>
              </span>
              {presentation.performance ? <span className={styles.performance}>{presentation.performance}</span> : null}
              <span className={styles.status} data-status={presentation.status}>
                {presentation.status === 'cluster' ? 'Group' : presentation.status}
              </span>
            </button>
          </div>
          {expandable ? (
            <ul id={groupId} className={styles.treeGroup} role="group" hidden={!expanded}>
              {expanded ? renderItems(children, depth + 1) : null}
            </ul>
          ) : null}
        </li>
      );
    });

  if (visibleRows.length === 0) return <p className={styles.emptyState}>{emptyLabel}</p>;
  return (
    <nav className={styles.treeFrame} aria-label={ariaLabel}>
      <ul className={styles.treeRoot} role="tree">
        {renderItems(model.rootKeys, 0)}
      </ul>
    </nav>
  );
}
