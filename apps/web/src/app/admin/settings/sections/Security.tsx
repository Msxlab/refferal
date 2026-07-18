'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, KeyRound, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Item { title: string; desc: string; state: 'on' | 'soon' }

const ACCESS: Item[] = [
  { title: 'Argon2id password hashing', desc: 'OWASP-tuned memory/time cost; constant-time verification.', state: 'on' },
  { title: 'Rotating refresh tokens', desc: 'One-time refresh tokens with reuse detection - a replayed token revokes the whole session family.', state: 'on' },
  { title: 'Login throttling', desc: 'Per-IP rate limiting on auth endpoints to slow credential stuffing.', state: 'on' },
  { title: 'Email verification gate', desc: 'New accounts must verify their email before sensitive actions.', state: 'on' },
  { title: 'Two-factor authentication', desc: 'TOTP authenticator app with single-use recovery codes.', state: 'on' },
  { title: 'Active session management', desc: 'Review and revoke individual devices/sessions.', state: 'on' },
];

const GOVERNANCE: Item[] = [
  { title: 'Separation of duties', desc: 'Maker-checker on sale approval (configurable in General).', state: 'on' },
  { title: 'Granular role permissions', desc: 'Per-resource permission matrix - see People & Roles.', state: 'on' },
  { title: 'Tamper-evident audit log', desc: 'Every privileged action recorded with before/after - see Audit.', state: 'on' },
  { title: 'Security event logging', desc: 'Failed logins, token reuse and authz denials are flagged for forensics.', state: 'on' },
];

export default function Security() {
  return (
    <div className="flex flex-col gap-5">
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

  const isEnabled = status?.enabled === true;
  const statusLabel = status === null ? 'Checking' : isEnabled ? '2FA active' : '2FA off';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your account security</CardTitle>
        <CardDescription>
          Recovery codes remaining: {status?.recoveryCodeCount ?? 0}
        </CardDescription>
        <CardAction>
          <Badge variant={isEnabled ? 'secondary' : 'outline'}>{statusLabel}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {setup && (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="mfa-secret">Secret</FieldLabel>
              <Input id="mfa-secret" value={setup.secret} readOnly />
            </Field>
            <Field>
              <FieldLabel htmlFor="mfa-otpauth-url">Authenticator URL</FieldLabel>
              <Input id="mfa-otpauth-url" value={setup.otpauthUrl} readOnly />
            </Field>
          </FieldGroup>
        )}

        <FieldGroup>
          <Field data-invalid={Boolean(error) || undefined}>
            <FieldLabel htmlFor="mfa-code">Authenticator or recovery code</FieldLabel>
            <Input
              id="mfa-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              autoComplete="one-time-code"
              aria-invalid={Boolean(error) || undefined}
            />
            <FieldDescription>
              Use a code from your authenticator app, or a single recovery code.
            </FieldDescription>
          </Field>
        </FieldGroup>

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Security action failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {recoveryCodes.length > 0 && (
          <Alert>
            <KeyRound />
            <AlertTitle>Recovery codes</AlertTitle>
            <AlertDescription>
              Store these now. They are shown once after enabling 2FA.
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {recoveryCodes.map((c) => (
                  <code key={c} className="rounded-md bg-muted px-2 py-1 font-mono text-sm">
                    {c}
                  </code>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        {!isEnabled && !setup && (
          <Button type="button" disabled={busy} onClick={startSetup}>
            <ShieldCheck data-icon="inline-start" />
            Set up 2FA
          </Button>
        )}
        {!isEnabled && setup && (
          <Button type="button" disabled={busy || !code} onClick={enable}>
            <ShieldCheck data-icon="inline-start" />
            Enable 2FA
          </Button>
        )}
        {isEnabled && (
          <Button variant="destructive" type="button" disabled={busy || !code} onClick={disable}>
            <ShieldOff data-icon="inline-start" />
            Disable 2FA
          </Button>
        )}
      </CardFooter>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>{sessions.length} refresh sessions</CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={busy === 'all' || sessions.length === 0}
            onClick={revokeAll}
          >
            <Trash2 data-icon="inline-start" />
            Revoke all
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Session action failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Device</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{new Date(s.createdAt).toLocaleString()}</TableCell>
                <TableCell>{s.ip ?? '-'}</TableCell>
                <TableCell className="max-w-[340px] truncate text-muted-foreground">
                  {s.userAgent ?? '-'}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={busy === s.id}
                    onClick={() => revoke(s.id)}
                  >
                    <Trash2 data-icon="inline-start" />
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {sessions.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No active refresh sessions.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Panel({ title, subtitle, items }: { title: string; subtitle: string; items: Item[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((it) => (
          <Card key={it.title} size="sm">
            <CardHeader>
              <CardTitle>{it.title}</CardTitle>
              <CardDescription>{it.desc}</CardDescription>
              <CardAction>
                <Badge variant={it.state === 'on' ? 'secondary' : 'outline'}>
                  {it.state === 'on' ? 'active' : 'coming'}
                </Badge>
              </CardAction>
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  );
}
