'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getTenantBrand, login, loginTwoFactor, switchTenant, type TenantBrand } from '@/lib/api';
import { applyTenantSwitch, landingForSession, setSession, type Session } from '@/lib/auth';
import { currentSlug, isHqHost, ROOT_DOMAIN } from '@/lib/subdomain';
import { Brand } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 2FA 2. adim
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

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

  async function completeLogin(session: Session): Promise<boolean> {
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
        const sw = await switchTenant(target.id);
        applyTenantSwitch(sw.accessToken, sw.activeMembershipId);
        session = { ...session, accessToken: sw.accessToken, activeMembershipId: sw.activeMembershipId };
      }
    } else if (!session.user.isPlatformAdmin && session.memberships.length === 0) {
      setError('This account has no active membership.');
      setBusy(false);
      return false;
    }
    setSession(session);
    router.replace(landingForSession(session));
    return true;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await login(email.trim(), password);
      if ('mfaRequired' in res) {
        setMfaToken(res.mfaToken);
        setBusy(false);
        return;
      }
      await completeLogin(res);
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
      const session = await loginTwoFactor(mfaToken as string, code.trim());
      await completeLogin(session);
    } catch {
      setError('Invalid code. Enter a fresh 6-digit code or a recovery code.');
      setBusy(false);
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
        ) : !mfaToken ? (
          <form className="card card-glow" onSubmit={onSubmit}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>{t('login.title')}</div>
            <h1 className="h1" style={{ marginBottom: 18 }}>{t('login.welcome')}</h1>
            <div className="field">
              <Label htmlFor="login-email" className="mb-1.5 block">{t('login.email')}</Label>
              <Input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="name@company.com" />
            </div>
            <div className="field">
              <Label htmlFor="login-password" className="mb-1.5 block">{t('login.password')}</Label>
              <div style={{ position: 'relative' }}>
                <Input id="login-password" type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" style={{ paddingRight: 64 }} />
                <button type="button" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw((v) => !v)} className="faint" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>{showPw ? 'Hide' : 'Show'}</button>
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
            <button type="button" className="faint" onClick={() => { setMfaToken(null); setCode(''); setError(''); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, marginTop: 12, width: '100%' }}>← Back to sign in</button>
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
