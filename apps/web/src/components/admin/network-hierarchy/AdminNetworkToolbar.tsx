'use client';

import { BarChart3, GitBranch, List, Network, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  NetworkHierarchyLens,
  NetworkHierarchyScope,
  NetworkHierarchyView,
} from '@/components/network-hierarchy/network-hierarchy.url';
import styles from './admin-network-hierarchy.module.css';

interface Props {
  scope: NetworkHierarchyScope;
  view: NetworkHierarchyView;
  lens: NetworkHierarchyLens;
  canViewFinancials: boolean;
  onWholeNetwork: () => void;
  onViewChange: (view: NetworkHierarchyView) => void;
  onLensChange: (lens: NetworkHierarchyLens) => void;
  onOpenValueFlow?: () => void;
}

function SegmentButton({
  active,
  children,
  label,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.segmentButton}
      data-active={active || undefined}
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Deliberately keeps navigation actions separate from selection. A person is
 * selected in the tree first; only the inspector can promote that person to a
 * focused Tier 1 root.
 */
export function AdminNetworkToolbar({
  scope,
  view,
  lens,
  canViewFinancials,
  onWholeNetwork,
  onViewChange,
  onLensChange,
  onOpenValueFlow,
}: Props) {
  const effectiveLens = canViewFinancials ? lens : 'people';

  return (
    <div className={styles.toolbar}>
      <div className={styles.scopeControl} aria-label="Network scope">
        <span className={styles.scopeLabel}>
          <GitBranch aria-hidden="true" />
          {scope === 'focused' ? 'Focused branch' : 'Full network'}
        </span>
        {scope === 'focused' ? (
          <button type="button" className={styles.quietButton} onClick={onWholeNetwork}>
            Return to full network
          </button>
        ) : (
          <span className={styles.scopeHint}>Select a person to make them local Tier 1.</span>
        )}
      </div>

      <div className={styles.toolbarGroups}>
        <div className={styles.segmentGroup} aria-label="Hierarchy view">
          <SegmentButton active={view === 'tree'} label="Tree view" onClick={() => onViewChange('tree')}>
            <Network aria-hidden="true" />
            Tree
          </SegmentButton>
          <SegmentButton active={view === 'list'} label="List view" onClick={() => onViewChange('list')}>
            <List aria-hidden="true" />
            List
          </SegmentButton>
        </div>

        <div className={styles.segmentGroup} aria-label="Network lens">
          <SegmentButton active={effectiveLens === 'people'} label="People lens" onClick={() => onLensChange('people')}>
            <Users aria-hidden="true" />
            People
          </SegmentButton>
          {canViewFinancials ? (
            <SegmentButton
              active={effectiveLens === 'performance'}
              label="Performance lens"
              onClick={() => onLensChange('performance')}
            >
              <BarChart3 aria-hidden="true" />
              Performance
            </SegmentButton>
          ) : null}
        </div>

        {onOpenValueFlow ? (
          <button type="button" className={styles.valueFlowButton} onClick={onOpenValueFlow}>
            <BarChart3 aria-hidden="true" />
            Value flow
          </button>
        ) : null}
      </div>
    </div>
  );
}
