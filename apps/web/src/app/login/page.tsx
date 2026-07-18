'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getTenantBrand, login, loginTwoFactor, requestPasswordReset, switchTenant, type TenantBrand } from '@/lib/api';
import { getSession, landingForSession, replaceSessionIfCurrent, type Session } from '@/lib/auth';
import { currentSlug, isHqHost, ROOT_DOMAIN } from '@/lib/subdomain';
import { Brand } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/lib/i18n';

const RECOVERY_MESSAGE = "If an account exists for this email, we'll send a password reset link.";
const RECOVERY_ERROR = "We couldn't send the request. Check your connection and try again.";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const forgotPasswordRef = useRef<HTMLButtonElement>(null);
  // 2FA 2. adim
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const loginOwner = useRef<{ session: Session | null } | null>(null);

  // Alt-proje B: markali subdomain baglami (ROOT_DOMAIN unset iken hep null/false — no-op)
  const [slug] = useState<string | null>(() => currentSlug());
  const [hq] = useState<boolean>(() => isHqHost());
  const [brand, setBrand] = useState<TenantBrand | null>(null);
  const [brandNotFound, setBrandNotFound] = useState(false);
  const [brandLoading, setBrandLoading] = useState(!!slug);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    getTenantBrand(slug)
      .then((b) => { if (alive) setBrand(b); })
      .catch(() => { if (alive) setBrandNotFound(true); })
      .finally(() => { if (alive) setBrandLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  async function completeLogin(session: Session, expectedSession: Session | null): Promise<boolean> {
    if (hq && !session.user.isPlatformAdmin) {
      setError('This sign-in page is for platform owners.');
      setBusy(false);
      return false;
    }
    if (slug) {
      if (session.user.isPlatformAdmin) {
        setError(`Platform owners sign in at hq.${ROOT_DOMAIN}.`);
        setBusy(false);
        return false;
      }
      // Bos uyelik listesi de dahil: find() zaten [] icin undefined doner, yani bu tek kontrol
      // hem "hic sirketi yok" hem "bu sirkette degil" durumlarini dogru, spesifik mesajla kapsar.
      const target = session.memberships.find((m) => m.tenantSlug === slug);
      if (!target) {
        setError("This account doesn't have access to this company.");
        setBusy(false);
        return false;
      }
      if (target.id !== session.activeMembershipId) {
        const sw = await switchTenant(target.id, session.accessToken);
        session = { ...session, accessToken: sw.accessToken, activeMembershipId: sw.activeMembershipId };
      }
    } else if (!session.user.isPlatformAdmin && session.memberships.length === 0) {
      setError('This account has no active membership.');
      setBusy(false);
      return false;
    }
    await replaceSessionIfCurrent(expectedSession, session);
    router.replace(landingForSession(session));
    return true;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const expectedSession = getSession();
      loginOwner.current = { session: expectedSession };
      const res = await login(email.trim(), password);
      if ('mfaRequired' in res) {
        setChallengeToken(res.challengeToken);
        setBusy(false);
        return;
      }
      await completeLogin(res, expectedSession);
    } catch {
      setError(t('login.error'));
      setBusy(false);
    }
  }

  async function onSubmit2fa(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (!loginOwner.current) throw new Error('login session owner unavailable');
      const session = await loginTwoFactor(challengeToken as string, code.trim());
      await completeLogin(session, loginOwner.current.session);
    } catch {
      setError('Invalid code. Enter a fresh 6-digit code or a recovery code.');
      setBusy(false);
    }
  }

  function openRecovery() {
    setError('');
    setRecoveryError('');
    setRecoverySent(false);
    setRecoveryMode(true);
  }

  function returnToSignIn() {
    setRecoveryMode(false);
    setRecoveryError('');
    setRecoverySent(false);
    requestAnimationFrame(() => forgotPasswordRef.current?.focus());
  }

  async function onSubmitRecovery(e: FormEvent) {
    e.preventDefault();
    setRecoveryError('');
    setRecoveryBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setRecoverySent(true);
    } catch {
      setRecoveryError(RECOVERY_ERROR);
    } finally {
      setRecoveryBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="fade-in" style={{ width: '100%', maxWidth: 392 }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          {slug && brand ? <TenantBrandHeader brand={brand} /> : <Brand size="lg" />}
          <div className="muted" style={{ marginTop: 10 }}>
            {slug && brand ? brand.branding.tagline ?? t('login.tagline') : t('login.tagline')}
          </div>
        </div>

        {slug && brandNotFound ? (
          <div className="card card-glow">
            <div className="eyebrow" style={{ marginBottom: 4 }}>Not found</div>
            <h1 className="h1" style={{ marginBottom: 10 }}>We couldn&apos;t find this company</h1>
            <p className="sub">Double-check the link your company gave you, or contact your administrator.</p>
          </div>
        ) : slug && brandLoading ? (
          <div className="card card-glow muted" style={{ textAlign: 'center', padding: 24 }}>{t('common.loading')}</div>
        ) : recoveryMode ? (
          <div className="card card-glow" aria-busy={recoveryBusy}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Account recovery</div>
            <h1 className="h1" style={{ marginBottom: 8 }}>Reset your password</h1>
            {recoverySent ? (
              <div role="status" className="sub" style={{ marginBottom: 18 }}>
                {RECOVERY_MESSAGE}
              </div>
            ) : (
              <>
                <p className="sub" style={{ marginBottom: 18 }}>{RECOVERY_MESSAGE}</p>
                <form onSubmit={onSubmitRecovery}>
                  <div className="field">
                    <Label htmlFor="recovery-email" className="mb-1.5 block">Email</Label>
                    <Input
                      id="recovery-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      disabled={recoveryBusy}
                      placeholder="name@company.com"
                    />
                  </div>
                  {recoveryError && <div className="error" role="alert">{recoveryError}</div>}
                  <Button type="submit" className="mt-1.5 w-full" disabled={recoveryBusy}>
                    {recoveryBusy ? 'Sending…' : 'Send reset link'}
                  </Button>
                </form>
              </>
            )}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="mt-3 w-full text-xs"
              onClick={returnToSignIn}
              disabled={recoveryBusy}
            >
              ← Back to sign in
            </Button>
          </div>
        ) : !challengeToken ? (
          <form className="card card-glow" onSubmit={onSubmit}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>{t('login.title')}</div>
            <h1 className="h1" style={{ marginBottom: 18 }}>{t('login.welcome')}</h1>
            <div className="field">
              <Label htmlFor="login-email" className="mb-1.5 block">{t('login.email')}</Label>
              <Input id="login-email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="name@company.com" />
            </div>
            <div className="field">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <Label htmlFor="login-password" className="mb-0">{t('login.password')}</Label>
                <Button
                  ref={forgotPasswordRef}
                  type="button"
                  variant="link"
                  size="sm"
                  className="px-2 text-xs"
                  onClick={openRecovery}
                  disabled={busy}
                >
                  Forgot password?
                </Button>
              </div>
              <div style={{ position: 'relative' }}>
                <Input id="login-password" name="password" type={showPw ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" style={{ paddingRight: 64 }} />
                <Button type="button" variant="link" size="sm" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw((v) => !v)} className="absolute right-0 top-0 px-3 text-xs">{showPw ? 'Hide' : 'Show'}</Button>
              </div>
            </div>
            {error && <div className="error">{error}</div>}
            <Button type="submit" className="mt-1.5 w-full" disabled={busy}>
              {busy ? t('common.loading') : t('login.submit')} {!busy && <span>→</span>}
            </Button>
          </form>
        ) : (
          <form className="card card-glow" onSubmit={onSubmit2fa}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Two-factor authentication</div>
            <h1 className="h1" style={{ marginBottom: 6 }}>Enter your code</h1>
            <p className="sub" style={{ marginBottom: 16 }}>Open your authenticator app and enter the 6-digit code, or use a recovery code.</p>
            <div className="field">
              <Label htmlFor="mfa-code" className="mb-1.5 block">Verification code</Label>
              <Input id="mfa-code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus inputMode="numeric" autoComplete="one-time-code"
                placeholder="123456" style={{ letterSpacing: '0.25em', fontFamily: 'ui-monospace, monospace', fontSize: 16 }} />
            </div>
            {error && <div className="error">{error}</div>}
            <Button type="submit" className="mt-1.5 w-full" disabled={busy || code.trim().length < 6}>
              {busy ? t('common.loading') : 'Verify'} {!busy && <span>→</span>}
            </Button>
            <Button type="button" variant="link" size="sm" className="mt-3 w-full text-xs" onClick={() => { setChallengeToken(null); setCode(''); setError(''); }}>← Back to sign in</Button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Markali subdomain girisinde jenerik Brand yerine tenant'in kendi ismi/logosu (Alt-proje B). */
function TenantBrandHeader({ brand }: { brand: TenantBrand }) {
  const color = brand.branding.primaryColor || 'var(--foil)';
  const letters = (brand.branding.logoText || brand.name).slice(0, 2).toUpperCase();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span
        style={{
          width: 34, height: 34, borderRadius: 11, background: color,
          display: 'grid', placeItems: 'center', color: '#1a1404',
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19,
        }}
      >
        {letters}
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, letterSpacing: '-.01em' }}>
        {brand.name}
      </span>
    </span>
  );
}
