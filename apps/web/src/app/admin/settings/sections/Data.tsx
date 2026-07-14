'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Data and backup policy panel for surfacing the active backup and retention posture.
 * Encrypted offsite backups and audit retention cron will be connected in a later task.
 */
interface Item { title: string; desc: string; state: 'on' | 'off' | 'soon' | 'warning' }

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

const RETENTION_ITEMS: Item[] = [
  { title: 'Immutable ledger', desc: 'Commission ledger rows are never deleted; only status transitions are appended.', state: 'on' },
  { title: 'Audit log retention', desc: 'Hot audit log is retained, archived offsite when configured, and prepared for scheduled pruning.', state: 'soon' },
  { title: 'Notification archival', desc: 'Delivered notifications will be compacted on a schedule to keep the outbox lean.', state: 'soon' },
  { title: 'Data export (GDPR/portability)', desc: "Export a tenant or member's data on request.", state: 'soon' },
];

export default function Data() {
  const [status, setStatus] = useState<DataStatus | null>(null);
  const [error, setError] = useState('');
  const backupItems = useMemo(() => backupItemsFor(status), [status]);

  useEffect(() => {
    api.get<DataStatus>('/admin/settings/data-status').then(setStatus).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Stat label="Database" value={status?.database.ok ? 'Connected' : status ? 'Unavailable' : 'Loading'} hint={`${status?.database.activeTenants ?? 0} tenants`} />
        <Stat label="Latest backup" value={status?.backup.latest ? new Date(status.backup.latest.modifiedAt).toLocaleString() : 'Not visible'} hint={status?.backup.readable ? status.backup.directory : 'Backup directory not readable'} />
        <Stat label="Restore drill" value={status?.restoreTest.restoreTestScriptPresent ? 'Script ready' : status ? 'Script missing' : 'Loading'} hint="docker backup restore-test.sh" />
        <Stat label="Offsite" value={status?.config.offsiteConfigured ? 'Configured' : 'Not configured'} hint={status?.config.encryptionConfigured ? 'Encryption on' : 'Encryption not configured'} />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Data status could not be loaded</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {status && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Stat label="Retention" value={`${status.config.retentionDays} days`} hint={`minimum keep ${status.config.minKeep}`} />
          <Stat label="Backup interval" value={`${Math.round(status.config.intervalSeconds / 3600)}h`} hint={status.restoreTest.backupScriptPresent ? 'backup.sh present' : 'backup.sh missing'} />
          <Stat label="Notification queue" value={`${status.notifications.pending} pending`} hint={`${status.notifications.processing} processing, ${status.notifications.failed} failed`} />
          <Stat label="Alert hook" value={status.config.alertConfigured ? 'Configured' : 'Not configured'} hint={`checked ${new Date(status.checkedAt).toLocaleTimeString()}`} />
        </div>
      )}
      <Panel title="Backup & disaster recovery" items={backupItems} />
      <Panel title="Retention & data lifecycle" items={RETENTION_ITEMS} />
    </div>
  );
}

function backupItemsFor(status: DataStatus | null): Item[] {
  const latest = status?.backup.latest;
  const canReadBackups = status?.backup.readable ?? false;
  const encryptionReady = status?.config.encryptionConfigured ?? false;
  const offsiteReady = status?.config.offsiteConfigured ?? false;
  const retentionReady = !!status && status.config.retentionDays > 0 && status.config.minKeep > 0;

  return [
    {
      title: 'Nightly database dumps',
      desc: latest
        ? `Latest visible backup: ${latest.name} (${formatBytes(latest.sizeBytes)}).`
        : canReadBackups
          ? 'The backup directory is readable, but no matching archive is visible.'
          : status
            ? 'The API cannot read the backup directory yet.'
            : 'Checking backup visibility.',
      state: latest ? (latest.encrypted ? 'on' : 'warning') : status ? 'off' : 'soon',
    },
    {
      title: 'Backup encryption',
      desc: encryptionReady
        ? 'age encryption is configured for new backup archives.'
        : 'Set BACKUP_AGE_RECIPIENT before treating backups as production-grade.',
      state: !status ? 'soon' : encryptionReady ? 'on' : 'warning',
    },
    {
      title: 'Offsite copy',
      desc: offsiteReady
        ? 'An offsite backup command is configured for host-loss recovery.'
        : 'No offsite command is configured yet; backups currently depend on the primary host volume.',
      state: !status ? 'soon' : offsiteReady ? 'on' : 'off',
    },
    {
      title: 'Rotation policy',
      desc: status
        ? `${status.config.retentionDays} day retention with a minimum of ${status.config.minKeep} archives kept.`
        : 'Checking retention settings.',
      state: !status ? 'soon' : retentionReady ? 'on' : 'warning',
    },
    {
      title: 'Restore drill',
      desc: status?.restoreTest.restoreTestScriptPresent
        ? 'Restore-test script is present; keep the weekly host timer enabled.'
        : 'Restore-test script is not visible from this deployment.',
      state: !status ? 'soon' : status.restoreTest.restoreTestScriptPresent ? 'on' : 'off',
    },
  ];
}

function Panel({ title, items }: { title: string; items: Item[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-base font-medium">{title}</h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((it) => (
          <Card key={it.title} size="sm">
            <CardHeader>
              <CardTitle>{it.title}</CardTitle>
              <CardDescription>{it.desc}</CardDescription>
              <CardAction>
                <Badge variant={badgeVariant(it.state)}>
                  {badgeLabel(it.state)}
                </Badge>
              </CardAction>
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  );
}

function badgeVariant(state: Item['state']) {
  if (state === 'on') return 'secondary';
  if (state === 'off') return 'destructive';
  return 'outline';
}

function badgeLabel(state: Item['state']): string {
  if (state === 'on') return 'active';
  if (state === 'off') return 'off';
  if (state === 'warning') return 'attention';
  return 'coming';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; value >= 1024 && i < units.length; i++) {
    value /= 1024;
    unit = units[i];
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="truncate text-sm text-muted-foreground" title={hint}>{hint}</p>
      </CardContent>
    </Card>
  );
}
