'use client';

import { FormEvent, use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { landingPath, setSession, activeMembership, type Session } from '@/lib/auth';
import { Brand, Loading } from '@/components/ui';
import { t } from '@/lib/i18n';

interface InviteResolve {
  code: string;
  valid: boolean;
  tenantName: string;
  inviterName: string;
  inviterMessage: string | null;
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
    // funnel tracking (#14): goruntuleme + UTM kaynak
    const utm = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('utm_source') ?? undefined : undefined;
    api.post(`/invites/${encodeURIComponent(code)}/event`, { event: 'view', ...(utm ? { utmSource: utm } : {}) }).catch(() => { /* sessiz */ });
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

  return (
    <div className="center">
      <div className="fade-in" style={{ width: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}><Brand size="lg" /></div>
        <div className="card card-glow">
          <div className="eyebrow" style={{ marginBottom: 4 }}>{t('reg.title')}</div>

          {loadError || (invite && !invite.valid) ? (
            <>
              <h1 className="h1">Invitation Unavailable</h1>
              <div className="error">{t('reg.invalid')}</div>
            </>
          ) : !invite ? (
            <Loading rows={2} />
          ) : (
            <>
              <h1 className="h1" style={{ marginBottom: 14 }}>
                <span className="gradient-text">{invite.inviterName}</span> invited you
              </h1>
              {invite.inviterMessage && (
                <div className="card" style={{ background: 'var(--panel-2)', padding: 14, marginBottom: 14, fontStyle: 'italic', fontSize: 13.5 }}>
                  “{invite.inviterMessage}”
                  <div className="faint" style={{ fontStyle: 'normal', fontSize: 11, marginTop: 6 }}>— {invite.inviterName}</div>
                </div>
              )}
              <div className="card" style={{ background: 'rgba(124,139,255,.08)', padding: 14, marginBottom: 18 }}>
                <div className="spread">
                  <div>
                    <div className="faint" style={{ fontSize: 11 }}>{t('reg.tenant')}</div>
                    <div style={{ fontWeight: 700 }}>{invite.tenantName}</div>
                  </div>
                  <span className="badge active">Active invitation</span>
                </div>
              </div>
              <form onSubmit={onSubmit}>
                <div className="field">
                  <label>{t('reg.fullName')}</label>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} autoFocus placeholder="Full name" />
                </div>
                <div className="field">
                  <label>{t('login.email')}</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@company.com" />
                </div>
                <div className="field">
                  <label>{t('login.password')} <span className="faint">(min 10)</span></label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} placeholder="••••••••••" />
                </div>
                {error && <div className="error">{error}</div>}
                <button type="submit" className="btn block" style={{ marginTop: 6 }} disabled={busy}>
                  {busy ? t('common.loading') : t('reg.submit')} {!busy && <span>→</span>}
                </button>
              </form>
            </>
          )}
          <div className="faint" style={{ fontSize: 11, marginTop: 16, lineHeight: 1.5 }}>{t('me.incomeNote')}</div>
        </div>
      </div>
    </div>
  );
}
