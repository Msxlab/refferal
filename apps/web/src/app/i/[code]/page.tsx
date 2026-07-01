'use client';

import { FormEvent, use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { landingPath, setSession, activeMembership, type Session } from '@/lib/auth';
import { Brand, Loading } from '@/components/ui';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
  const [accept, setAccept] = useState(false);
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
        acceptDisclaimer: true,
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
      <div className="fade-in" style={{ width: '100%', maxWidth: 420 }}>
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
                <Card style={{ background: 'var(--panel-2)', padding: 14, marginBottom: 14, fontStyle: 'italic', fontSize: 13.5 }}>
                  “{invite.inviterMessage}”
                  <div className="faint" style={{ fontStyle: 'normal', fontSize: 11, marginTop: 6 }}>— {invite.inviterName}</div>
                </Card>
              )}
              <Card style={{ background: 'rgba(124,139,255,.08)', padding: 14, marginBottom: 14 }}>
                <div className="spread">
                  <div>
                    <div className="faint" style={{ fontSize: 11 }}>{t('reg.tenant')}</div>
                    <div style={{ fontWeight: 700 }}>{invite.tenantName}</div>
                  </div>
                  <Badge variant="success">Active invitation</Badge>
                </div>
              </Card>

              {/* show the opportunity before the form — people join for a reward, not an account */}
              <Card style={{ background: 'color-mix(in srgb, var(--gold-500) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--gold-500) 28%, transparent)', padding: 14, marginBottom: 18 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>💸 What you’ll earn</div>
                <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                  Earn a commission on every sale you make — and a share of the sales made by the people you bring in. Record a sale, your company verifies it, and your commission is tracked and paid out automatically.
                </div>
              </Card>

              <form onSubmit={onSubmit}>
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
                {/* Faz A1: self-attestation + sorumluluk metni. Onay ZORUNLU; tarih+IP backend'de saklanir. */}
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
                    I confirm that the name and information I provide are accurate and that I am the
                    person registering. I understand commissions are paid by check mailed to the
                    address on my account once my balance reaches the payout minimum, and that I am
                    responsible for keeping my details correct. I agree to the{' '}
                    <a href="/terms" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent, var(--gold-500))', textDecoration: 'underline' }}>program terms</a>.
                  </span>
                </label>
                {error && <div className="error">{error}</div>}
                <Button type="submit" className="mt-1.5 w-full" disabled={busy || !accept}>
                  {busy ? t('common.loading') : t('reg.submit')} {!busy && <span>→</span>}
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
