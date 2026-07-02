'use client';

/**
 * Veri & yedekleme politikasi paneli — uygulanan yedek/saklama akisini yuzeye cikarir
 * (sifreli Google Drive offsite, audit saklama cron'u task #7 ile baglanacak).
 */
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Item { title: string; desc: string; state: 'on' | 'soon' }

const BACKUP: Item[] = [
  { title: 'Nightly encrypted dumps', desc: 'pg_dump captured every night, encrypted at rest with age before it ever leaves the host.', state: 'on' },
  { title: 'Offsite to Google Drive', desc: 'Encrypted archives pushed to Google Drive via rclone; primary host loss is recoverable.', state: 'on' },
  { title: 'Atomic, fail-safe rotation', desc: 'Retention only prunes after a verified successful dump, with a minimum-keep floor.', state: 'on' },
  { title: 'One-click restore drill', desc: 'Guided restore-into-staging to rehearse recovery and verify backup integrity.', state: 'soon' },
];

const RETENTION: Item[] = [
  { title: 'Immutable ledger', desc: 'Commission ledger rows are never deleted — only status transitions are appended.', state: 'on' },
  { title: 'Audit log retention', desc: 'Hot audit log kept ~1 year, then archived offsite (encrypted) and pruned by a scheduled job.', state: 'soon' },
  { title: 'Notification archival', desc: 'Delivered notifications compacted on a schedule to keep the outbox lean.', state: 'soon' },
  { title: 'Data export (GDPR/portability)', desc: 'Export a tenant or member’s data on request.', state: 'soon' },
];

export default function Data() {
  return (
    <div className="grid" style={{ gap: 20 }}>
      <Card style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Stat label="Backup cadence" value="Nightly" hint="pg_dump + age encryption" />
        <Stat label="Offsite target" value="Google Drive" hint="rclone, encrypted" />
        <Stat label="Money integrity" value="Integer cents" hint="No floats, ever" />
      </Card>
      <Panel title="Backup & disaster recovery" items={BACKUP} />
      <Panel title="Retention & data lifecycle" items={RETENTION} />
    </div>
  );
}

function Panel({ title, items }: { title: string; items: Item[] }) {
  return (
    <section>
      <strong style={{ fontSize: 15 }}>{title}</strong>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12, marginTop: 12 }}>
        {items.map((it) => (
          <Card key={it.title} style={{ padding: 15 }}>
            <div className="spread">
              <strong style={{ fontSize: 13.5 }}>{it.title}</strong>
              <Badge variant={it.state === 'on' ? 'success' : 'pending'} className="text-[9px]">
                {it.state === 'on' ? 'active' : 'coming'}
              </Badge>
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 7, lineHeight: 1.5 }}>{it.desc}</div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div style={{ flex: 1, minWidth: 160 }}>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 15, marginTop: 3 }}>{value}</div>
      <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>{hint}</div>
    </div>
  );
}
