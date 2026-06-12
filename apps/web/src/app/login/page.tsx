'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/api';
import { landingForSession, setSession } from '@/lib/auth';
import { Brand } from '@/components/ui';
import { t } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const session = await login(email.trim(), password);
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
    <div className="center">
      <div className="fade-in" style={{ width: 392 }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <Brand size="lg" />
          <div className="muted" style={{ marginTop: 10 }}>{t('login.tagline')}</div>
        </div>
        <form className="card card-glow" onSubmit={onSubmit}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>{t('login.title')}</div>
          <h1 className="h1" style={{ marginBottom: 18 }}>{t('login.welcome')}</h1>
          <div className="field">
            <label>{t('login.email')}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="name@company.com" />
          </div>
          <div className="field">
            <label>{t('login.password')}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          {error && <div className="error">{error}</div>}
          <button className="btn block" style={{ marginTop: 6 }} disabled={busy}>
            {busy ? t('common.loading') : t('login.submit')} {!busy && <span>→</span>}
          </button>
        </form>
      </div>
    </div>
  );
}
