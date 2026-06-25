'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

interface Item { title: string; desc: string; state: 'on' | 'soon' }

const ACCESS: Item[] = [
  { title: 'Argon2id password hashing', desc: 'OWASP-tuned memory/time cost; constant-time verification.', state: 'on' },
  { title: 'Rotating refresh tokens', desc: 'One-time refresh tokens with reuse detection — a replayed token revokes the whole session family.', state: 'on' },
  { title: 'Login throttling', desc: 'Per-IP rate limiting on auth endpoints to slow credential stuffing.', state: 'on' },
  { title: 'Email verification gate', desc: 'New accounts must verify their email before sensitive actions.', state: 'on' },
  { title: 'Two-factor authentication', desc: 'TOTP authenticator app with single-use recovery codes.', state: 'on' },
  { title: 'Active session management', desc: 'Review and revoke individual devices/sessions.', state: 'on' },
];

const GOVERNANCE: Item[] = [
  { title: 'Separation of duties', desc: 'Maker-checker on sale approval (configurable in General).', state: 'on' },
  { title: 'Granular role permissions', desc: 'Per-resource permission matrix — see People & Roles.', state: 'on' },
  { title: 'Tamper-evident audit log', desc: 'Every privileged action recorded with before/after — see Audit.', state: 'on' },
  { title: 'Security event logging', desc: 'Failed logins, token reuse and authz denials are flagged for forensics.', state: 'on' },
];

export default function Security() {
  return (
    <div className="grid" style={{ gap: 20 }}>
      <Panel title="Account access" subtitle="How identities are protected." items={ACCESS} />
      <Panel title="Governance & detection" subtitle="Controls that keep the workspace honest." items={GOVERNANCE} />
      <MfaCard />
      <SessionsCard />
    </div>
  );
}

interface MfaStatus { enabled: boolean; recoveryCodeCount: number }
interface MfaSetup { secret: string; otpauthUrl: string }
interface MfaEnable { enabled: true; recoveryCodes: string[] }

function MfaCard() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      setStatus(await api.get<MfaStatus>('/auth/2fa/status'));
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }

  useEffect(() => { void load(); }, []);

  async function startSetup() {
    setBusy(true); setError('');
    try {
      setSetup(await api.post<MfaSetup>('/auth/2fa/setup'));
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function enable() {
    setBusy(true); setError('');
    try {
      const res = await api.post<MfaEnable>('/auth/2fa/enable', { code });
      setRecoveryCodes(res.recoveryCodes);
      setSetup(null);
      setCode('');
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setError('');
    try {
      await api.post<{ enabled: false }>('/auth/2fa/disable', { code });
      setCode('');
      setRecoveryCodes([]);
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="spread">
        <div>
          <strong style={{ fontSize: 14 }}>Your account security</strong>
          <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
            Recovery codes remaining: {status?.recoveryCodeCount ?? 0}
          </div>
        </div>
        <span className={`badge ${status?.enabled ? 'active' : 'pending'}`} style={{ fontSize: 10 }}>
          {status?.enabled ? '2FA active' : '2FA off'}
        </span>
      </div>

      {setup && (
        <div className="grid" style={{ gap: 10, marginTop: 14 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Secret</label>
            <input value={setup.secret} readOnly />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Authenticator URL</label>
            <input value={setup.otpauthUrl} readOnly />
          </div>
        </div>
      )}

      <div className="field" style={{ marginTop: 14 }}>
        <label>Authenticator or recovery code</label>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
      </div>
      {error && <div className="error">{error}</div>}
      {recoveryCodes.length > 0 && (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
          <strong style={{ fontSize: 13 }}>Recovery codes</strong>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 6, marginTop: 8 }}>
            {recoveryCodes.map((c) => <code key={c}>{c}</code>)}
          </div>
        </div>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        {!status?.enabled && !setup && <button className="btn" type="button" disabled={busy} onClick={startSetup}>Set up 2FA</button>}
        {!status?.enabled && setup && <button className="btn" type="button" disabled={busy || !code} onClick={enable}>Enable 2FA</button>}
        {status?.enabled && <button className="btn ghost" type="button" disabled={busy || !code} onClick={disable}>Disable 2FA</button>}
      </div>
    </div>
  );
}

interface SessionRow { id: string; createdAt: string; expiresAt: string; ip: string | null; userAgent: string | null }

function SessionsCard() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      setSessions(await api.get<SessionRow[]>('/auth/sessions'));
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }

  useEffect(() => { void load(); }, []);

  async function revoke(id: string) {
    setBusy(id); setError('');
    try {
      await api.del<{ ok: true }>(`/auth/sessions/${id}`);
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(''); }
  }

  async function revokeAll() {
    setBusy('all'); setError('');
    try {
      await api.post<{ revoked: number }>('/auth/sessions/revoke-all');
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(''); }
  }

  return (
    <div className="card">
      <div className="spread">
        <div>
          <strong style={{ fontSize: 14 }}>Active sessions</strong>
          <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{sessions.length} refresh sessions</div>
        </div>
        <button className="btn ghost sm" type="button" disabled={busy === 'all' || sessions.length === 0} onClick={revokeAll}>Revoke all</button>
      </div>
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      <table style={{ marginTop: 12 }}>
        <thead><tr><th>Created</th><th>IP</th><th>Device</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td>{new Date(s.createdAt).toLocaleString()}</td>
              <td>{s.ip ?? '-'}</td>
              <td className="muted" style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.userAgent ?? '-'}</td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn ghost sm" type="button" disabled={busy === s.id} onClick={() => revoke(s.id)}>Revoke</button>
              </td>
            </tr>
          ))}
          {sessions.length === 0 && <tr><td colSpan={4} className="muted">No active refresh sessions.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Panel({ title, subtitle, items }: { title: string; subtitle: string; items: Item[] }) {
  return (
    <section>
      <div style={{ marginBottom: 12 }}>
        <strong style={{ fontSize: 15 }}>{title}</strong>
        <div className="faint" style={{ fontSize: 12 }}>{subtitle}</div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
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
