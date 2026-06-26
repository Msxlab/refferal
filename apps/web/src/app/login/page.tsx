'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Eye, EyeOff, ShieldCheck, Coins, Banknote } from 'lucide-react';
import { login, loginTwoFactor } from '@/lib/api';
import { landingForSession, setSession, type Session } from '@/lib/auth';
import { Brand } from '@/components/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { APP_NAME, APP_MONOGRAM } from '@/lib/brand';
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

  function completeLogin(session: Session): boolean {
    if (!session.user.isPlatformAdmin && session.memberships.length === 0) {
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
      completeLogin(res);
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
      completeLogin(session);
    } catch {
      setError('Invalid code. Enter a fresh 6-digit code or a recovery code.');
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <style>{`
        .login-aside {
          display: none;
          position: relative;
          overflow: hidden;
          border-left: 1px solid hsl(var(--border));
          background:
            radial-gradient(120% 90% at 12% 8%, hsl(var(--primary) / .22), transparent 55%),
            radial-gradient(95% 80% at 92% 18%, hsl(var(--primary) / .14), transparent 50%),
            radial-gradient(120% 110% at 80% 100%, hsl(var(--primary) / .12), transparent 55%),
            var(--panel-2);
        }
        @media (min-width: 1024px) {
          .login-aside { display: block; }
        }
      `}</style>

      {/* SOL — giris formu (mobilde tek kolon, ortalanmis) */}
      <div className="center">
        <div className="fade-in" style={{ width: '100%', maxWidth: 420 }}>
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <Brand size="lg" />
            <div className="muted" style={{ marginTop: 10 }}>{t('login.tagline')}</div>
          </div>

          {!mfaToken ? (
            <form className="card card-glow" onSubmit={onSubmit}>
              <div className="eyebrow" style={{ marginBottom: 4 }}>{t('login.title')}</div>
              <h1 className="h1" style={{ marginBottom: 18 }}>{t('login.welcome')}</h1>
              <div className="field">
                <label>{t('login.email')}</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="name@company.com" />
              </div>
              <div className="field">
                <label>{t('login.password')}</label>
                <div style={{ position: 'relative' }}>
                  <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" style={{ paddingRight: 64 }} />
                  <button type="button" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw((v) => !v)} className="faint" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--text-sm)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>{showPw ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}{showPw ? 'Hide' : 'Show'}</button>
                </div>
              </div>
              {error && <Alert variant="destructive" className="mb-3"><AlertDescription>{error}</AlertDescription></Alert>}
              <button className="btn block" style={{ marginTop: 6 }} disabled={busy}>
                {busy ? t('common.loading') : t('login.submit')} {!busy && <ArrowRight className="size-4" aria-hidden />}
              </button>
            </form>
          ) : (
            <form className="card card-glow" onSubmit={onSubmit2fa}>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Two-factor authentication</div>
              <h1 className="h1" style={{ marginBottom: 6 }}>Enter your code</h1>
              <p className="sub" style={{ marginBottom: 16 }}>Open your authenticator app and enter the 6-digit code, or use a recovery code.</p>
              <div className="field">
                <label>Verification code</label>
                <input value={code} onChange={(e) => setCode(e.target.value)} required autoFocus inputMode="numeric" autoComplete="one-time-code"
                  placeholder="123456" style={{ letterSpacing: '0.25em', fontFamily: 'ui-monospace, monospace', fontSize: 'var(--text-lg)' }} />
              </div>
              {error && <Alert variant="destructive" className="mb-3"><AlertDescription>{error}</AlertDescription></Alert>}
              <button className="btn block" style={{ marginTop: 6 }} disabled={busy || code.trim().length < 6}>
                {busy ? t('common.loading') : 'Verify'} {!busy && <ArrowRight className="size-4" aria-hidden />}
              </button>
              <button type="button" className="faint" onClick={() => { setMfaToken(null); setCode(''); setError(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--text-sm)', marginTop: 12, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><ArrowLeft className="size-4" aria-hidden /> Back to sign in</button>
            </form>
          )}
        </div>
      </div>

      {/* SAG — markali dekoratif panel (lg altinda gizli) */}
      <aside aria-hidden className="login-aside beam">
        <div
          style={{
            display: 'grid',
            alignContent: 'space-between',
            height: '100%',
            padding: 'clamp(40px, 6vw, 72px)',
          }}
        >
          {/* ust: marka mark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span
              aria-hidden
              style={{
                width: 44, height: 44, borderRadius: 14, background: 'var(--foil)',
                display: 'grid', placeItems: 'center', color: 'var(--on-gold)',
                fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24,
                boxShadow: '0 10px 26px -10px hsl(var(--primary) / .8)',
              }}
            >
              {APP_MONOGRAM}
            </span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, letterSpacing: '-.01em' }}>
              {APP_NAME}
            </span>
          </div>

          {/* orta: baslik + ozellik madde isaretleri */}
          <div style={{ maxWidth: 460 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Referral platform</div>
            <h2
              style={{
                fontFamily: 'var(--font-display)', fontWeight: 800,
                fontSize: 'clamp(28px, 3.4vw, 40px)', lineHeight: 1.1, letterSpacing: '-.02em',
                margin: '0 0 14px', color: 'hsl(var(--foreground))',
              }}
            >
              Every referral, paid to the cent.
            </h2>
            <p className="muted" style={{ fontSize: 15, lineHeight: 1.6, margin: '0 0 30px' }}>
              {t('login.tagline')}
            </p>

            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 16 }}>
              {[
                { Icon: ShieldCheck, title: 'Tamper-proof ledger', desc: 'Every commission event is recorded and auditable.' },
                { Icon: Coins, title: 'Commissions to the cent', desc: 'Exact, rounding-safe payouts on integer cents.' },
                { Icon: Banknote, title: 'Check & ACH payouts', desc: 'Pay your network the way that fits your business.' },
              ].map(({ Icon, title, desc }) => (
                <li key={title} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                  <span
                    aria-hidden
                    className="glow-primary"
                    style={{
                      flex: '0 0 auto', width: 40, height: 40, borderRadius: 12,
                      display: 'grid', placeItems: 'center',
                      background: 'hsl(var(--primary) / .12)',
                      color: 'hsl(var(--primary))',
                      border: '1px solid hsl(var(--primary) / .28)',
                    }}
                  >
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span style={{ display: 'grid', gap: 2, paddingTop: 2 }}>
                    <span style={{ fontWeight: 700, fontSize: 14.5, color: 'hsl(var(--foreground))' }}>{title}</span>
                    <span className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>{desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* alt: ince imza */}
          <div className="muted" style={{ fontSize: 12.5, letterSpacing: '.01em' }}>
            {APP_NAME} — referral commissions, automated end to end.
          </div>
        </div>
      </aside>
    </div>
  );
}
