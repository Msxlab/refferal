'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { login, loginTwoFactor } from '@/lib/api';
import { landingForSession, setSession, type Session } from '@/lib/auth';
import { Brand } from '@/components/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  );
}
