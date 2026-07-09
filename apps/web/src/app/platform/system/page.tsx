'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading } from '@/components/ui';
import { dateShort } from '@/lib/format';

interface Health {
  db: boolean;
  jobs: Array<{ name: string; at: string; ok: boolean; stale: boolean }>;
  backups: { lastBackupAt: string | null };
}

const POLL_MS = 30_000;

/** Item 7: sistem sagligi paneli — DB + is (job) sagligi + backup tazeligi, 30sn'de bir yenilenir. */
export default function SystemPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    function load() {
      api.get<Health>('/platform/health').then(setHealth).catch((e) => setError(String((e as ApiError).message)));
    }
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  if (error && !health) return <div className="error">{error}</div>;

  return (
    <div>
      <div className="eyebrow fade-in">Platform</div>
      <h1 className="h1 fade-in">System</h1>
      <p className="sub fade-in" style={{ marginBottom: 16 }}>Database, background jobs, and backup freshness. Refreshes automatically every 30 seconds.</p>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      {!health ? (
        <Loading rows={4} />
      ) : (
        <div className="grid fade-in delay-1" style={{ gap: 16 }}>
          <div className="card">
            <div className="spread" style={{ alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: 15 }}>Database</strong>
                <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>Connectivity check (SELECT 1)</div>
              </div>
              <span className={`badge ${health.db ? 'active' : 'failed'}`}>{health.db ? 'Connected' : 'Unreachable'}</span>
            </div>
          </div>

          <div className="card">
            <div className="spread" style={{ marginBottom: 14 }}>
              <strong style={{ fontSize: 15 }}>Background jobs</strong>
              <span className="faint" style={{ fontSize: 12 }}>Process-local — resets on restart</span>
            </div>
            <div className="card" style={{ background: 'var(--panel-2)', padding: 0, overflowX: 'auto' }}>
              <table aria-label="Background jobs">
                <thead><tr><th>Job</th><th>Last run</th><th>Status</th></tr></thead>
                <tbody>
                  {health.jobs.map((j) => (
                    <tr key={j.name} style={j.stale ? { background: 'color-mix(in srgb, var(--rose) 10%, transparent)' } : undefined}>
                      <td>{j.name}</td>
                      <td className="muted">{dateShort(j.at)}</td>
                      <td>
                        {j.stale ? (
                          <span className="badge failed">Stale</span>
                        ) : (
                          <span className={`badge ${j.ok ? 'active' : 'failed'}`}>{j.ok ? 'OK' : 'Failed'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {health.jobs.length === 0 && <tr><td colSpan={3} className="muted">No runs since restart.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="spread" style={{ alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: 15 }}>Backups</strong>
                <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>Freshness of the last recorded backup</div>
              </div>
              <span className="faint" style={{ fontSize: 13 }}>
                {health.backups.lastBackupAt ? dateShort(health.backups.lastBackupAt) : 'No backup recorded'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
