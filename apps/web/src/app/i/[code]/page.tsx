'use client';

import { FormEvent, use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, isMfaChallenge, loginMfa, type MfaChallenge } from '@/lib/api';
import { getSession, landingForSession, replaceSessionIfCurrent, type Session } from '@/lib/auth';
import { Brand, Loading } from '@/components/ui';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { t } from '@/lib/i18n';

interface InviteResolve {
  state: 'invalid' | 'valid' | 'expired' | 'revoked' | 'used' | 'tenant-suspended';
  tenant?: { displayName: string; logoUrl?: string };
  programSummary?: string;
  disclaimer?: { version: string; locale: 'en' | 'tr'; body: string };
  expiresAt?: string;
}

function hasInviteRegistrationContext(
  invite: InviteResolve | null,
): invite is InviteResolve & {
  state: 'valid';
  tenant: NonNullable<InviteResolve['tenant']>;
  disclaimer: NonNullable<InviteResolve['disclaimer']>;
} {
  return invite?.state === 'valid' && Boolean(invite.tenant && invite.disclaimer);
}

export default function InviteRegisterPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [invite, setInvite] = useState<InviteResolve | null>(null);
  const [loadError, setLoadError] = useState('');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accept, setAccept] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inviteOwner = useRef<{ session: Session | null } | null>(null);
  const registrationInvite = hasInviteRegistrationContext(invite) ? invite : null;

  useEffect(() => {
    api
      .get<InviteResolve>(`/invites/${encodeURIComponent(code)}`)
      .then(setInvite)
      .catch((e) => setLoadError(String((e as ApiError).message)));
    // funnel tracking (#14): goruntuleme + UTM kaynak
    const utm = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('utm_source') ?? undefined : undefined;
    api.post(`/invites/${encodeURIComponent(code)}/event`, { event: 'view', ...(utm ? { utmSource: utm } : {}) }).catch(() => { /* sessiz */ });
  }, [code]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mfaChallenge) {
        if (!inviteOwner.current) throw new Error('invite session owner unavailable');
        const session = await loginMfa(mfaChallenge.challengeToken, mfaCode.trim());
        await replaceSessionIfCurrent(inviteOwner.current.session, session);
        router.replace(landingForSession(session));
        return;
      }
      if (!registrationInvite) throw new Error('invitation is unavailable');

      const expectedSession = getSession();
      inviteOwner.current = { session: expectedSession };
      const result = await api.post<Session | MfaChallenge>('/auth/register-by-invite', {
        inviteCode: code,
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        acceptDisclaimer: true,
        disclaimerVersion: registrationInvite.disclaimer.version,
        disclaimerLocale: registrationInvite.disclaimer.locale,
      });
      if (isMfaChallenge(result)) {
        setMfaChallenge(result);
        setMfaCode('');
        return;
      }
      await replaceSessionIfCurrent(expectedSession, result);
      router.replace(landingForSession(result));
    } catch (e) {
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="fade-in" style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}><Brand size="lg" /></div>
        <div className="card card-glow">
          <div className="eyebrow" style={{ marginBottom: 4 }}>{t('reg.title')}</div>

          {loadError || (invite && !registrationInvite) ? (
            <>
              <h1 className="h1">Invitation Unavailable</h1>
              <div className="error">{t('reg.invalid')}</div>
            </>
          ) : !registrationInvite ? (
            <Loading rows={2} />
          ) : (
            <>
              <h1 className="h1" style={{ marginBottom: 14 }}>
                Join the <span className="gradient-text">{registrationInvite.tenant.displayName}</span> referral program
              </h1>
              <Card style={{ background: 'rgba(124,139,255,.08)', padding: 14, marginBottom: 14 }}>
                <div className="spread">
                  <div>
                    <div className="faint" style={{ fontSize: 11 }}>{t('reg.tenant')}</div>
                    <div style={{ fontWeight: 700 }}>{registrationInvite.tenant.displayName}</div>
                  </div>
                  <Badge variant="success">Active invitation</Badge>
                </div>
              </Card>

              {/* Explain eligibility and payout steps before registration. */}
              <Card style={{ background: 'color-mix(in srgb, var(--gold-500) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--gold-500) 28%, transparent)', padding: 14, marginBottom: 18 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>How commissions work</div>
                <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                  {registrationInvite.programSummary ?? 'Commissions may be earned on eligible product sales after company approval. Any commission due under the company plan appears in your wallet.'}
                </div>
              </Card>

              <form onSubmit={onSubmit}>
                {mfaChallenge ? (
                  <>
                    <Card style={{ background: 'rgba(124,139,255,.08)', padding: 14, marginBottom: 14 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>Verify your account</div>
                      <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                        Enter an authenticator or recovery code to finish joining this business.
                      </div>
                    </Card>
                    <div className="field">
                      <Label htmlFor="invite-mfa-code" className="mb-1.5 block">Verification code</Label>
                      <Input
                        id="invite-mfa-code"
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value)}
                        required
                        autoFocus
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        placeholder="123456"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setMfaChallenge(null);
                        setMfaCode('');
                        inviteOwner.current = null;
                        setError('');
                      }}
                    >
                      Start registration again
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="field">
                      <Label htmlFor="reg-name" className="mb-1.5 block">{t('reg.fullName')}</Label>
                      <Input id="reg-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} autoFocus placeholder="Full name" />
                    </div>
                    <div className="field">
                      <Label htmlFor="reg-email" className="mb-1.5 block">{t('login.email')}</Label>
                      <Input id="reg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@company.com" />
                    </div>
                    <div className="field">
                      <Label htmlFor="reg-pw" className="mb-1.5 block">{t('login.password')} <span className="faint">(min 10)</span></Label>
                      <Input id="reg-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} placeholder="••••••••••" />
                    </div>
                    <label
                      className="card"
                      style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'var(--panel-2)', padding: 12, marginTop: 4, marginBottom: 12, cursor: 'pointer', fontWeight: 400 }}
                    >
                      <input
                        type="checkbox"
                        checked={accept}
                        onChange={(e) => setAccept(e.target.checked)}
                        required
                        style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }}
                      />
                      <span className="faint" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
                        I have read and agree to this invitation disclosure: {registrationInvite.disclaimer.body}
                      </span>
                    </label>
                  </>
                )}
                {error && <div className="error">{error}</div>}
                <Button type="submit" className="mt-1.5 w-full" disabled={busy || (!mfaChallenge && !accept)}>
                  {busy ? t('common.loading') : mfaChallenge ? 'Verify and join' : `Join ${registrationInvite.tenant.displayName}`} {!busy && <span>→</span>}
                </Button>
              </form>
            </>
          )}
          <div className="faint" style={{ fontSize: 11, marginTop: 16, lineHeight: 1.5 }}>{t('me.incomeNote')}</div>
        </div>
      </div>
    </div>
  );
}
