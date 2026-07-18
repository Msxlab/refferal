'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import { isMfaChallenge, login, loginMfa } from '@/lib/api';
import { landingForSession, setSession } from '@/lib/auth';
import { Brand } from '@/components/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const session = challengeToken ? await loginMfa(challengeToken, mfaCode) : await login(email.trim(), password);
      if (isMfaChallenge(session)) {
        setChallengeToken(session.challengeToken);
        setMfaCode('');
        setBusy(false);
        return;
      }
      if (!session.user.isPlatformAdmin && session.memberships.length === 0) {
        setError('This account has no active membership.');
        setBusy(false);
        return;
      }
      setSession(session);
      router.replace(landingForSession(session));
    } catch {
      setError(t('login.error'));
      setBusy(false);
    }
  }

  return (
    <div className="center px-4">
      <div className="fade-in flex w-full max-w-[392px] flex-col gap-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <Brand size="lg" />
          <div className="text-sm text-muted-foreground">{t('login.tagline')}</div>
        </div>
        <Card>
          <CardHeader>
            <CardDescription>{t('login.title')}</CardDescription>
            <CardTitle className="text-2xl">{t('login.welcome')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-5" onSubmit={onSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">{t('login.email')}</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus={!challengeToken}
                    placeholder="name@company.com"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">{t('login.password')}</FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="********"
                  />
                </Field>
                {challengeToken && (
                  <Field>
                    <FieldLabel htmlFor="mfa-code">Authenticator or recovery code</FieldLabel>
                    <Input
                      id="mfa-code"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      required
                      autoFocus
                      inputMode="numeric"
                      placeholder="123456"
                    />
                  </Field>
                )}
              </FieldGroup>
              {challengeToken && (
                <Alert>
                  <ShieldCheck />
                  <AlertDescription>Enter your second factor to finish signing in.</AlertDescription>
                </Alert>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button className="w-full" disabled={busy}>
                {busy ? t('common.loading') : t('login.submit')}
                {!busy && <ArrowRight data-icon="inline-end" />}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}