import Link from 'next/link';
import { AlertTriangle, ArrowRight, CircleAlert, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ValueFlowAttentionItem } from './value-flow.types';
import styles from './value-flow.module.css';

interface Props {
  items: ValueFlowAttentionItem[];
  sources: { todo: boolean; networkHealth: boolean };
}

export function ValueFlowAttention({ items, sources }: Props) {
  const available = sources.todo || sources.networkHealth;
  const complete = sources.todo && sources.networkHealth;
  const missing = [!sources.todo ? 'task data' : null, !sources.networkHealth ? 'network-health data' : null].filter(Boolean).join(' and ');
  return (
    <section className={styles.attentionSection} aria-labelledby="value-flow-attention-heading">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>Operational follow-through</span>
          <h2 id="value-flow-attention-heading">What needs attention</h2>
        </div>
        <span className={styles.sectionCount}>{complete ? `${items.length} open signal${items.length === 1 ? '' : 's'}` : available ? `${items.length}+ known signals` : 'Unavailable'}</span>
      </div>

      {available && !complete && (
        <p className={styles.coverageNote} role="status">Partial coverage: {missing} is unavailable.</p>
      )}

      {!available ? (
        <div className={styles.inlineEmpty}><CircleAlert aria-hidden="true" /><span>Attention signals are temporarily unavailable.</span></div>
      ) : items.length === 0 ? (
        <div className={styles.inlineEmpty}><ClipboardCheck aria-hidden="true" /><span>{complete ? 'No open tasks or network-health signals.' : 'No signals were found in the available source.'}</span></div>
      ) : (
        <div className={styles.attentionList} role="list">
          {items.map((item) => (
            <article key={item.id} className={styles.attentionRow} data-tone={item.tone} role="listitem">
              <span className={styles.attentionIcon} aria-hidden="true">
                {item.tone === 'critical' || item.tone === 'warning' ? <AlertTriangle /> : <CircleAlert />}
              </span>
              <div className={styles.attentionCopy}>
                <div><span>{item.kind === 'task' ? 'Task' : 'Network signal'} · {item.tone === 'critical' ? 'High priority' : item.tone === 'warning' ? 'Needs review' : 'Monitor'}</span><strong>{item.title}</strong></div>
                <p>{item.detail}</p>
              </div>
              <span className={styles.attentionCount}>{item.count}</span>
              <Button asChild variant="ghost" size="icon" className={styles.attentionAction}>
                <Link href={item.href} aria-label={`Open ${item.title}`}><ArrowRight /></Link>
              </Button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
