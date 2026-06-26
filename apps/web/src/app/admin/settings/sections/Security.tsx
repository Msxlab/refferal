'use client';

import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

interface Item { title: string; desc: string; state: 'on' | 'soon' }

const ACCESS: Item[] = [
  { title: 'Argon2id password hashing', desc: 'OWASP-tuned memory/time cost; constant-time verification.', state: 'on' },
  { title: 'Rotating refresh tokens', desc: 'One-time refresh tokens with reuse detection — a replayed token revokes the whole session family.', state: 'on' },
  { title: 'Login throttling', desc: 'Per-IP rate limiting on auth endpoints to slow credential stuffing.', state: 'on' },
  { title: 'Email verification gate', desc: 'New accounts must verify their email before sensitive actions.', state: 'on' },
  { title: 'Two-factor authentication', desc: 'TOTP authenticator app with email OTP fallback and recovery codes.', state: 'soon' },
  { title: 'Active session management', desc: 'Review and revoke individual devices/sessions.', state: 'soon' },
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
      <Alert className="flex flex-wrap items-center gap-4">
        <div style={{ flex: 1, minWidth: 220 }}>
          <AlertTitle style={{ fontFamily: 'var(--font-display)', fontSize: 14 }}>Your account security</AlertTitle>
          <AlertDescription className="faint" style={{ fontSize: 12, marginTop: 4 }}>Two-factor setup and active-session management arrive in the next update.</AlertDescription>
        </div>
        <span className="badge pending" style={{ fontSize: 10 }}>coming soon</span>
      </Alert>
    </div>
  );
}

function Panel({ title, subtitle, items }: { title: string; subtitle: string; items: Item[] }) {
  return (
    <section>
      <div style={{ marginBottom: 12 }}>
        <strong style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>{title}</strong>
        <div className="faint" style={{ fontSize: 12 }}>{subtitle}</div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
        {items.map((it) => (
          <div key={it.title} className="card" style={{ padding: 16 }}>
            <div className="spread">
              <strong style={{ fontSize: 14 }}>{it.title}</strong>
              <span className={`badge ${it.state === 'on' ? 'active' : 'pending'}`} style={{ fontSize: 10 }}>
                {it.state === 'on' ? 'active' : 'coming'}
              </span>
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>{it.desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
