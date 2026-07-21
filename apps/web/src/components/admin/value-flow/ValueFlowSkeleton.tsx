import { Skeleton } from '@/components/ui/skeleton';
import styles from './value-flow.module.css';

export function ValueFlowSkeleton() {
  return (
    <div className={styles.page} role="status" aria-live="polite" aria-busy="true" aria-label="Loading referral value flow…">
      <div className={styles.skeletonHeader}>
        <Skeleton className={styles.skeletonTitle} />
        <Skeleton className={styles.skeletonSubtitle} />
      </div>
      <div className={styles.metricGrid}>
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className={styles.skeletonMetric} />)}
      </div>
      <Skeleton className={styles.skeletonToolbar} />
      <div className={styles.workspaceGrid}>
        <Skeleton className={styles.skeletonCanvas} />
        <Skeleton className={styles.skeletonInspector} />
      </div>
    </div>
  );
}

export function ValueFlowCanvasSkeleton() {
  return (
    <div className={styles.canvasLoading} role="status" aria-live="polite" aria-busy="true" aria-label="Loading referral value-flow network…">
      <Skeleton className={styles.canvasOnlySkeleton} />
    </div>
  );
}
