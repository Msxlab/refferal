'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Copy, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { clearSession, getSession, landingForSession, requiresMfaSetup } from '@/lib/auth';
import { Brand } from '@/components/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

interface MfaStatus {
  enabled: boolean;
  recoveryCodeCount: number;
}

interface MfaSetup {
  secret: string;
  otpauthUrl: string;
}

interface MfaEnable {
  enabled: true;
  recoveryCodes: string[];
}

export default function MfaSetupPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const current = getSession();
    if (!current) {
      router.replace('/login');
      return;
    }
    if (!requiresMfaSetup(current)) {
      router.replace(landingForSession(current));
      return;
    }
      api.get<MfaStatus>('/auth/2fa/status')
      .then((status) => {
        if (status.enabled) {
          // MFA enrollment revokes the old refresh token by design. Do not try to
          // refresh a stale session; start a new, MFA-verified login instead.
          clearSession();
          router.replace('/login');
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load 2FA status.'));
  }, [router]);

  async function startSetup() {
    setBusy('setup');
    setError('');
    try {
      setSetup(await api.post<MfaSetup>('/auth/2fa/setup'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start 2FA setup.');
    } finally {
      setBusy('');
    }
  }

  async function enable(e: FormEvent) {
    e.preventDefault();
    setBusy('enable');
    setError('');
    try {
      const res = await api.post<MfaEnable>('/auth/2fa/enable', { code });
      setRecoveryCodes(res.recoveryCodes);
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enable 2FA.');
    } finally {
      setBusy('');
    }
  }

  function continueToApp() {
    // A fresh login is required to bind MFA proof to the new refresh session.
    clearSession();
    router.replace('/login');
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard permissions vary by browser; manual copy remains available.
    }
  }

  return (
    <div className="center px-4">
      <div className="fade-in flex w-full max-w-[520px] flex-col gap-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <Brand size="lg" />
          <div className="text-sm text-muted-foreground">Secure your administrator access.</div>
        </div>

        <Card>
          <CardHeader>
            <CardDescription>Required security step</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <ShieldCheck className="size-5 text-primary" />
              Enable two-factor authentication
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <p className="text-sm text-muted-foreground">
              Your role requires 2FA before admin or platform tools can be used. Add this account to your authenticator app,
              then enter the current code.
            </p>

            {error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {!setup && recoveryCodes.length === 0 && (
              <Button onClick={startSetup} disabled={busy === 'setup'}>
                {busy === 'setup' ? 'Preparing...' : 'Start setup'}
                {busy !== 'setup' && <ArrowRight data-icon="inline-end" />}
              </Button>
            )}

            {setup && recoveryCodes.length === 0 && (
              <form onSubmit={enable} className="grid gap-5">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="mfa-secret">Secret</FieldLabel>
                    <div className="flex gap-2">
                      <Input id="mfa-secret" value={setup.secret} readOnly />
                      <Button type="button" variant="outline" size="icon" onClick={() => copy(setup.secret)} aria-label="Copy secret">
                        <Copy />
                      </Button>
                    </div>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="mfa-url">Authenticator URL</FieldLabel>
                    <Input id="mfa-url" value={setup.otpauthUrl} readOnly />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="mfa-code">Authenticator code</FieldLabel>
                    <Input
                      id="mfa-code"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      inputMode="numeric"
                      autoFocus
                      required
                      placeholder="123456"
                    />
                  </Field>
                </FieldGroup>
                <Button disabled={busy === 'enable'}>{busy === 'enable' ? 'Enabling...' : 'Enable 2FA'}</Button>
              </form>
            )}

            {recoveryCodes.length > 0 && (
              <div className="grid gap-4">
                <Alert>
                  <ShieldCheck />
                  <AlertTitle>2FA is enabled</AlertTitle>
                  <AlertDescription>
                    Store these recovery codes somewhere safe. They are shown only once. Sign in again to start your verified session.
                  </AlertDescription>
                </Alert>
                <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 font-mono text-sm">
                  {recoveryCodes.map((recoveryCode) => (
                    <div key={recoveryCode}>{recoveryCode}</div>
                  ))}
                </div>
                <Button onClick={continueToApp}>
                  Sign in again
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
