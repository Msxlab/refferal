'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/api';
import { isAdminRole, setSession, activeMembership } from '@/lib/auth';
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
      const active = activeMembership(session);
      if (!isAdminRole(active?.role)) {
        setError('Bu hesabin isletme yonetim yetkisi yok.');
        setBusy(false);
        return;
      }
      setSession(session);
      router.replace('/admin');
    } catch {
      setError(t('login.error'));
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card" style={{ width: 360 }} onSubmit={onSubmit}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>Refearn</div>
        <div className="muted" style={{ marginBottom: 18 }}>{t('login.title')}</div>
        <div className="field">
          <label>{t('login.email')}</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label>{t('login.password')}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
          {busy ? t('common.loading') : t('login.submit')}
        </button>
      </form>
    </div>
  );
}
