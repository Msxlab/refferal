'use client';

import { LocateFixed, UserRoundSearch, X } from 'lucide-react';
import { formatHierarchyMoney, performanceBandLabel } from './network-hierarchy.model';
import type { NetworkHierarchyNode } from './types';
import styles from './network-hierarchy.module.css';

interface Props {
  selected: NetworkHierarchyNode | null;
  showPerformance?: boolean;
  viewFinancials?: boolean;
  onClose?: () => void;
  onFocus?: (membershipId: string) => void;
  onOpenMember?: (membershipId: string) => void;
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.fact}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function NetworkHierarchyInspector({
  selected,
  showPerformance = true,
  viewFinancials = false,
  onClose,
  onFocus,
  onOpenMember,
}: Props) {
  if (!selected) {
    return (
      <aside className={styles.inspector} aria-label="Network member details">
        <div className={styles.inspectorEmpty}>
          <UserRoundSearch aria-hidden="true" />
          <h2>Select a member</h2>
          <p>Choose a node to review the details allowed for this network view.</p>
        </div>
      </aside>
    );
  }

  const title =
    selected.kind === 'cluster'
      ? `Tier ${selected.localTier} member group`
      : selected.kind === 'anonymous'
        ? `${selected.initials} · ${selected.label}`
        : selected.displayName;

  return (
    <aside className={styles.inspector} aria-label="Network member details" aria-live="polite">
      <header className={styles.inspectorHeader}>
        <div>
          <span className={styles.eyebrow}>Selected network node</span>
          <h2>{title}</h2>
        </div>
        {onClose ? (
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close member details">
            <X aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <div className={styles.inspectorBody}>
        {selected.kind === 'member' ? (
          <>
            <div className={styles.factGrid}>
              <Fact label="Referral code" value={selected.referralCode} />
              <Fact label="Status" value={selected.status} />
              <Fact label="Local tier" value={selected.localTier} />
              <Fact label="Global tier" value={selected.globalTier} />
              <Fact label="Direct members" value={selected.directCount} />
              <Fact label="Subtree members" value={selected.subtreeCount} />
              {selected.rank ? <Fact label="Rank" value={selected.rank} /> : null}
            </div>
            {showPerformance && viewFinancials && selected.performance ? (
              <section className={styles.performancePanel} aria-label="Allowed performance details">
                <span>{selected.performance.period}</span>
                <Fact label="Approved sales" value={selected.performance.approvedSales} />
                <Fact
                  label="Team volume"
                  value={formatHierarchyMoney(selected.performance.teamVolumeCents, selected.performance.currency)}
                />
                {selected.performance.commissionCents != null ? (
                  <Fact
                    label="Commission"
                    value={formatHierarchyMoney(selected.performance.commissionCents, selected.performance.currency)}
                  />
                ) : null}
              </section>
            ) : showPerformance ? (
              <p className={styles.mutedCopy}>Financial performance is not available for this role.</p>
            ) : null}
            {onFocus || onOpenMember ? (
              <div className={styles.inspectorActions}>
                {onFocus ? (
                  <button type="button" className={styles.primaryAction} onClick={() => onFocus(selected.membershipId)}>
                    <LocateFixed aria-hidden="true" />
                    Focus this branch
                  </button>
                ) : null}
                {onOpenMember ? (
                  <button
                    type="button"
                    className={styles.secondaryAction}
                    onClick={() => onOpenMember(selected.membershipId)}
                  >
                    <UserRoundSearch aria-hidden="true" />
                    Open member
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {selected.kind === 'cluster' ? (
          <>
            <div className={styles.factGrid}>
              <Fact label="Exact tier" value={`Tier ${selected.localTier}`} />
              <Fact label="Represented members" value={selected.representedNodes} />
            </div>
            <p className={styles.mutedCopy}>
              Open the group in the hierarchy to load its members. A cluster is a branch budget marker, not a person.
            </p>
          </>
        ) : null}

        {selected.kind === 'self' ? (
          <>
            <div className={styles.factGrid}>
              <Fact label="Referral code" value={selected.referralCode} />
              <Fact label="Status" value={selected.status} />
              <Fact label="Direct members" value={selected.directCount} />
              <Fact label="Visible downline" value={selected.visibleDownlineCount} />
              {showPerformance && selected.performance ? (
                <>
                  <Fact label="Approved sales" value={selected.performance.visibleApprovedSales} />
                  <Fact
                    label="Visible team volume"
                    value={formatHierarchyMoney(
                      selected.performance.visibleTeamVolumeCents,
                      selected.performance.currency,
                    )}
                  />
                </>
              ) : null}
            </div>
          </>
        ) : null}

        {selected.kind === 'direct' ? (
          <>
            <div className={styles.factGrid}>
              <Fact label="Referral code" value={selected.referralCode} />
              <Fact label="Status" value={selected.status} />
              <Fact label="Visible direct members" value={selected.visibleDirectCount} />
              <Fact label="Visible branch members" value={selected.visibleBranchCount} />
              {showPerformance && selected.performance ? (
                <>
                  <Fact label="Approved sales" value={selected.performance.approvedSales} />
                  <Fact
                    label="Visible branch volume"
                    value={formatHierarchyMoney(
                      selected.performance.visibleBranchVolumeCents,
                      selected.performance.currency,
                    )}
                  />
                </>
              ) : null}
            </div>
          </>
        ) : null}

        {selected.kind === 'anonymous' ? (
          <>
            <div className={styles.factGrid}>
              <Fact label="Identity" value={selected.initials} />
              <Fact label="Visibility" value={selected.label} />
              <Fact label="Status" value={selected.status} />
              {selected.localTier === 2 && selected.visibleChildCount !== undefined ? (
                <Fact label="Visible children" value={selected.visibleChildCount} />
              ) : null}
              {showPerformance ? <Fact label="Performance" value={performanceBandLabel(selected.performanceBand)} /> : null}
            </div>
            {selected.localTier === 3 ? (
              <p className={styles.terminalNote}>
                Tier 3 is the final visible level. No deeper branch details are exposed.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </aside>
  );
}
