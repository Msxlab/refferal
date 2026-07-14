'use client';

import { type CSSProperties, FormEvent, use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, ShieldCheck, UserPlus } from 'lucide-react';
import { api, ApiError, isMfaChallenge, loginMfa, type MfaChallenge } from '@/lib/api';
import { landingForSession, setSession, type Session } from '@/lib/auth';
import { normalizeRuntimeBrand, type RuntimeBrand } from '@/lib/brand';
import { Brand } from '@/components/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/lib/i18n';

interface InviteResolve {
  code: string;
  valid: boolean;
  tenantName: string;
  inviterName: string;
  emailLocked: boolean;
  brand?: RuntimeBrand;
}

function isExpiredMfaChallenge(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && /2FA session is invalid or expired/i.test(error.message);
}

export default function InviteRegisterPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [invite, setInvite] = useState<InviteResolve | null>(null);
  const [loadError, setLoadError] = useState('');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [challengeExpired, setChallengeExpired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activeBrand = normalizeRuntimeBrand(invite?.brand ?? (invite ? { name: invite.tenantName } : null));
  const brandVars = {
    '--brand-accent': activeBrand.primaryColor,
  } as CSSProperties;

  useEffect(() => {
    api
      .get<InviteResolve>(`/invites/${encodeURIComponent(code)}`)
      .then(setInvite)
      .catch((e) => setLoadError(String((e as ApiError).message)));
  }, [code]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const session = challengeToken
        ? await loginMfa(challengeToken, mfaCode)
        : await api.post<Session | MfaChallenge>('/auth/register-by-invite', {
            inviteCode: code,
            email: email.trim(),
            password,
            fullName: fullName.trim(),
          });
      if (isMfaChallenge(session)) {
        // This stays in component state only; never put an MFA challenge in the URL.
        setChallengeToken(session.challengeToken);
        setMfaCode('');
        setChallengeExpired(false);
        return;
      }
      setSession(session);
      router.replace(landingForSession(session));
    } catch (e) {
      if (challengeToken && isExpiredMfaChallenge(e)) {
        setChallengeExpired(true);
        setMfaCode('');
      }
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  function restartMfaChallenge() {
    setChallengeToken('');
    setMfaCode('');
    setChallengeExpired(false);
    setError('');
  }

  const inviteUnavailable = Boolean(loadError || (invite && !invite.valid));

  return (
    <div className="center px-4" style={brandVars}>
      <div className="fade-in flex w-full max-w-[420px] flex-col gap-5">
        <div className="flex justify-center">
          <Brand size="lg" brand={activeBrand} />
        </div>
        <Card>
          <CardHeader>
            <CardDescription>{t('reg.title')}</CardDescription>
            <CardTitle className="text-2xl">
              {inviteUnavailable
                ? 'Invitation unavailable'
                : invite
                  ? `${invite.inviterName} invited you`
                  : 'Checking invitation'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {inviteUnavailable ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{loadError || t('reg.invalid')}</AlertDescription>
              </Alert>
            ) : !invite ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <form className="flex flex-col gap-5" onSubmit={onSubmit}>
                <Alert>
                  <UserPlus />
                  <AlertTitle>{invite.tenantName}</AlertTitle>
                  <AlertDescription>
                    <div className="flex flex-col gap-2">
                      <span>{activeBrand.tagline}</span>
                      <Badge className="w-fit" variant="secondary">Active invitation</Badge>
                    </div>
                  </AlertDescription>
                </Alert>
                {challengeToken ? (
                  <>
                    <Alert>
                      <ShieldCheck />
                      <AlertTitle>Verify your account</AlertTitle>
                      <AlertDescription>
                        {challengeExpired
                          ? 'This verification session expired. Start over to request a new one.'
                          : 'Enter your authenticator or recovery code to finish joining this business.'}
                      </AlertDescription>
                    </Alert>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="invite-mfa-code">Authenticator or recovery code</FieldLabel>
                        <Input
                          id="invite-mfa-code"
                          value={mfaCode}
                          onChange={(event) => setMfaCode(event.target.value)}
                          autoComplete="one-time-code"
                          autoFocus
                          required
                          placeholder="123456"
                        />
                      </Field>
                    </FieldGroup>
                  </>
                ) : (
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="full-name">{t('reg.fullName')}</FieldLabel>
                      <Input
                        id="full-name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        minLength={2}
                        autoFocus
                        placeholder="Full name"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="invite-email">{t('login.email')}</FieldLabel>
                      <Input
                        id="invite-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        placeholder="name@company.com"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="invite-password">{t('login.password')}</FieldLabel>
                      <Input
                        id="invite-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={10}
                        placeholder="**********"
                      />
                      <FieldDescription>Minimum 10 characters.</FieldDescription>
                    </Field>
                  </FieldGroup>
                )}
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {challengeExpired && (
                  <Button type="button" variant="outline" className="w-full" onClick={restartMfaChallenge}>
                    Start over
                  </Button>
                )}
                <Button className="w-full" disabled={busy || challengeExpired}>
                  {busy ? t('common.loading') : challengeToken ? 'Verify and join' : t('reg.submit')}
                  {!busy && <ArrowRight data-icon="inline-end" />}
                </Button>
              </form>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">{t('me.incomeNote')}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
