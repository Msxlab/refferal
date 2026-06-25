'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

/**
 * Veri & yedekleme politikasi paneli — uygulanan yedek/saklama akisini yuzeye cikarir
 * (sifreli Google Drive offsite, audit saklama cron'u task #7 ile baglanacak).
 */
interface Item { title: string; desc: string; state: 'on' | 'soon' }

interface DataStatus {
  checkedAt: string;
  database: { ok: boolean; activeTenants: number };
  notifications: { pending: number; processing: number; failed: number };
  backup: {
    directory: string;
    readable: boolean;
    latest: null | { name: string; modifiedAt: string; sizeBytes: number; encrypted: boolean };
  };
  config: {
    encryptionConfigured: boolean;
    offsiteConfigured: boolean;
    alertConfigured: boolean;
    retentionDays: number;
    minKeep: number;
    intervalSeconds: number;
  };
  restoreTest: { backupScriptPresent: boolean; restoreTestScriptPresent: boolean };
}

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
  const [status, setStatus] = useState<DataStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<DataStatus>('/admin/settings/data-status').then(setStatus).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  return (
    <div className="grid" style={{ gap: 20 }}>
      <div className="card" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Stat label="Database" value={status?.database.ok ? 'Connected' : status ? 'Unavailable' : 'Loading'} hint={`${status?.database.activeTenants ?? 0} tenants`} />
        <Stat label="Latest backup" value={status?.backup.latest ? new Date(status.backup.latest.modifiedAt).toLocaleString() : 'Not visible'} hint={status?.backup.readable ? status.backup.directory : 'Backup dir not readable'} />
        <Stat label="Restore drill" value={status?.restoreTest.restoreTestScriptPresent ? 'Script ready' : status ? 'Script missing' : 'Loading'} hint="docker backup restore-test.sh" />
        <Stat label="Offsite" value={status?.config.offsiteConfigured ? 'Configured' : 'Not configured'} hint={status?.config.encryptionConfigured ? 'Encryption on' : 'Encryption not configured'} />
      </div>
      {error && <div className="error">{error}</div>}
      {status && (
        <div className="card" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Stat label="Retention" value={`${status.config.retentionDays} days`} hint={`minimum keep ${status.config.minKeep}`} />
          <Stat label="Backup interval" value={`${Math.round(status.config.intervalSeconds / 3600)}h`} hint={status.restoreTest.backupScriptPresent ? 'backup.sh present' : 'backup.sh missing'} />
          <Stat label="Notification queue" value={`${status.notifications.pending} pending`} hint={`${status.notifications.processing} processing, ${status.notifications.failed} failed`} />
          <Stat label="Alert hook" value={status.config.alertConfigured ? 'Configured' : 'Not configured'} hint={`checked ${new Date(status.checkedAt).toLocaleTimeString()}`} />
        </div>
      )}
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
          <div key={it.title} className="card" style={{ padding: 15 }}>
            <div className="spread">
              <strong style={{ fontSize: 13.5 }}>{it.title}</strong>
              <span className={`badge ${it.state === 'on' ? 'active' : 'pending'}`} style={{ fontSize: 9 }}>
                {it.state === 'on' ? 'active' : 'coming'}
              </span>
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 7, lineHeight: 1.5 }}>{it.desc}</div>
          </div>
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
