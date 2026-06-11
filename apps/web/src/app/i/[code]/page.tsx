'use client';

import { FormEvent, use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { landingPath, setSession, activeMembership, type Session } from '@/lib/auth';
import { t } from '@/lib/i18n';

interface InviteResolve {
  code: string;
  valid: boolean;
  tenantName: string;
  inviterName: string;
  emailLocked: boolean;
}

export default function InviteRegisterPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [invite, setInvite] = useState<InviteResolve | null>(null);
  const [loadError, setLoadError] = useState('');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
      const session = await api.post<Session>('/auth/register-by-invite', {
        inviteCode: code,
        email: email.trim(),
        password,
        fullName: fullName.trim(),
      });
      setSession(session);
      router.replace(landingPath(activeMembership(session)?.role));
    } catch (e) {
      setError(String((e as ApiError).message));
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="center">
        <div className="card" style={{ width: 380, textAlign: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Refearn</div>
          <div className="error" style={{ marginTop: 12 }}>{t('reg.invalid')}</div>
        </div>
      </div>
    );
  }

  if (!invite) return <div className="center muted">{t('common.loading')}</div>;

  return (
    <div className="center">
      <form className="card" style={{ width: 400 }} onSubmit={onSubmit}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>Refearn</div>
        <div className="muted" style={{ marginBottom: 16 }}>{t('reg.title')}</div>

        {!invite.valid ? (
          <div className="error">{t('reg.invalid')}</div>
        ) : (
          <>
            <div className="card" style={{ background: 'var(--panel-2)', marginBottom: 16, padding: 12 }}>
              <div className="muted" style={{ fontSize: 12 }}>{t('reg.tenant')}</div>
              <div style={{ fontWeight: 600 }}>{invite.tenantName}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t('reg.invitedBy')}</div>
              <div>{invite.inviterName}</div>
            </div>
            <div className="field">
              <label>{t('reg.fullName')}</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} autoFocus />
            </div>
            <div className="field">
              <label>{t('login.email')}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label>{t('login.password')} <span className="muted">(min 10)</span></label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
            </div>
            {error && <div className="error">{error}</div>}
            <button className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
              {busy ? t('common.loading') : t('reg.submit')}
            </button>
          </>
        )}
        <div className="muted" style={{ fontSize: 11, marginTop: 14 }}>{t('me.incomeNote')}</div>
      </form>
    </div>
  );
}
