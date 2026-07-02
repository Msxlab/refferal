'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { api, ApiError } from '@/lib/api';
import { activeMembership, getSession, isAdminRole, setSession } from '@/lib/auth';
import { Brand, Loading, ThemeToggle, useToast } from '@/components/ui';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { dateShort } from '@/lib/format';

interface Account {
  id: string; email: string; fullName: string; locale: string; avatarPath: string | null;
  emailVerified: boolean; twoFactorEnabled: boolean; createdAt: string;
}

interface SessionRow {
  id: string; device: string; ip: string | null; lastActive: string; current: boolean;
}

interface MailingAddress {
  mailingName: string | null; mailingLine1: string | null; mailingLine2: string | null;
  mailingCity: string | null; mailingState: string | null; mailingPostal: string | null; mailingCountry: string;
}
interface MailingResp { hasMembership: boolean; complete: boolean; address: MailingAddress | null; }

export default function AccountPage() {
  const uid = useId();
  const router = useRouter();
  const [acc, setAcc] = useState<Account | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [backHref, setBackHref] = useState('/app');

  // profil formu
  const [fullName, setFullName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // sifre formu
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState('');

  // 2FA akisi
  const [twoFaStep, setTwoFaStep] = useState<'idle' | 'setup' | 'recovery' | 'disable'>('idle');
  const [setupData, setSetupData] = useState<{ otpauthUrl: string; secret: string } | null>(null);
  const [twoFaCode, setTwoFaCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [disablePw, setDisablePw] = useState('');
  const [twoFaBusy, setTwoFaBusy] = useState(false);
  const [twoFaError, setTwoFaError] = useState('');

  function resetTwoFa() {
    setTwoFaStep('idle'); setSetupData(null); setTwoFaCode(''); setRecoveryCodes([]); setDisablePw(''); setTwoFaError('');
  }

  async function startSetup() {
    setTwoFaBusy(true); setTwoFaError('');
    try {
      const d = await api.post<{ otpauthUrl: string; secret: string }>('/account/2fa/setup');
      setSetupData(d); setTwoFaStep('setup');
    } catch (err) { setTwoFaError(String((err as ApiError).message)); } finally { setTwoFaBusy(false); }
  }

  async function enableTwoFa(e: React.FormEvent) {
    e.preventDefault(); setTwoFaBusy(true); setTwoFaError('');
    try {
      const r = await api.post<{ enabled: boolean; recoveryCodes: string[] }>('/account/2fa/enable', { code: twoFaCode.trim() });
      setRecoveryCodes(r.recoveryCodes); setTwoFaStep('recovery'); setTwoFaCode('');
      if (acc) setAcc({ ...acc, twoFactorEnabled: true });
    } catch (err) { setTwoFaError(String((err as ApiError).message)); } finally { setTwoFaBusy(false); }
  }

  async function disableTwoFa(e: React.FormEvent) {
    e.preventDefault(); setTwoFaBusy(true); setTwoFaError('');
    try {
      await api.post('/account/2fa/disable', { password: disablePw });
      if (acc) setAcc({ ...acc, twoFactorEnabled: false });
      resetTwoFa(); showToast('Two-factor authentication disabled');
    } catch (err) { setTwoFaError(String((err as ApiError).message)); } finally { setTwoFaBusy(false); }
  }

  function copyRecovery() {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(recoveryCodes.join('\n')).then(() => showToast('Recovery codes copied')).catch(() => showToast('Could not copy'));
    }
  }

  // cek posta adresi (Faz A2)
  const [mailing, setMailing] = useState<MailingResp | null>(null);
  const [maName, setMaName] = useState('');
  const [maLine1, setMaLine1] = useState('');
  const [maLine2, setMaLine2] = useState('');
  const [maCity, setMaCity] = useState('');
  const [maState, setMaState] = useState('');
  const [maPostal, setMaPostal] = useState('');
  const [savingMa, setSavingMa] = useState(false);
  const [maError, setMaError] = useState('');

  function fillMailing(r: MailingResp) {
    setMailing(r);
    if (r.address) {
      setMaName(r.address.mailingName ?? '');
      setMaLine1(r.address.mailingLine1 ?? '');
      setMaLine2(r.address.mailingLine2 ?? '');
      setMaCity(r.address.mailingCity ?? '');
      setMaState(r.address.mailingState ?? '');
      setMaPostal(r.address.mailingPostal ?? '');
    }
  }
  async function saveMailing(e: React.FormEvent) {
    e.preventDefault();
    setMaError(''); setSavingMa(true);
    try {
      const r = await api.patch<MailingResp>('/account/mailing-address', {
        mailingName: maName.trim(),
        mailingLine1: maLine1.trim(),
        mailingLine2: maLine2.trim() || null,
        mailingCity: maCity.trim(),
        mailingState: maState.trim().toUpperCase(),
        mailingPostal: maPostal.trim(),
      });
      fillMailing(r);
      showToast('Mailing address saved');
    } catch (err) {
      setMaError(String((err as ApiError).message));
    } finally {
      setSavingMa(false);
    }
  }

  // aktif oturumlar
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  function loadSessions() {
    api.get<{ sessions: SessionRow[] }>('/account/sessions').then((r) => setSessions(r.sessions)).catch(() => { /* opsiyonel */ });
  }
  async function revokeSession(id: string) {
    try { await api.del(`/account/sessions/${id}`); loadSessions(); showToast('Signed out that device'); }
    catch (err) { showToast(String((err as ApiError).message)); }
  }
  async function revokeOtherSessions() {
    try { const r = await api.post<{ revoked: number }>('/account/sessions/revoke-others'); loadSessions(); showToast(`Signed out ${r.revoked} other device${r.revoked === 1 ? '' : 's'}`); }
    catch (err) { showToast(String((err as ApiError).message)); }
  }

  useEffect(() => {
    const s = getSession();
    if (!s) { router.replace('/login'); return; }
    const active = activeMembership(s);
    setBackHref(isAdminRole(active?.role) ? '/admin' : '/app');
    api.get<Account>('/account')
      .then((a) => { setAcc(a); setFullName(a.fullName); })
      .catch((e) => setError(String((e as ApiError).message)));
    api.get<MailingResp>('/account/mailing-address').then(fillMailing).catch(() => { /* uyeliksiz principal */ });
    loadSessions();
  }, [router]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const a = await api.patch<Account>('/account/profile', { fullName: fullName.trim() });
      setAcc(a);
      const s = getSession();
      if (s) setSession({ ...s, user: { ...s.user, fullName: a.fullName, locale: a.locale } });
      showToast('Profile updated');
    } catch (err) {
      showToast(String((err as ApiError).message));
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    if (newPw !== confirmPw) { setPwError('New passwords do not match.'); return; }
    if (newPw.length < 10) { setPwError('New password must be at least 10 characters.'); return; }
    setSavingPw(true);
    try {
      await api.post('/account/password', { currentPassword: curPw, newPassword: newPw });
      setCurPw(''); setNewPw(''); setConfirmPw('');
      showToast('Password changed — other devices signed out');
    } catch (err) {
      setPwError(String((err as ApiError).message));
    } finally {
      setSavingPw(false);
    }
  }

  if (error) return <div className="center text-sm text-destructive">{error}</div>;
  if (!acc) return <div className="center"><Loading /></div>;

  const dirty = fullName.trim() !== acc.fullName;
  const joined = new Date(acc.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const cardCls = 'rounded-2xl border border-border bg-card p-5 shadow-sm';

  return (
    <div style={{ minHeight: '100vh' }}>
      <header className="topbar">
        <div className="inner" style={{ maxWidth: 640 }}>
          <Brand />
          <span style={{ flex: 1 }} />
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href={backHref}>← Back</Link>
          </Button>
        </div>
      </header>

      <main style={{ maxWidth: 640, margin: '0 auto', padding: '28px 18px 60px' }}>
        <div className="eyebrow fade-in">Account</div>
        <h1 className="h1 fade-in" style={{ marginBottom: 4 }}>{acc.fullName}</h1>
        <p className="sub fade-in" style={{ marginBottom: 22 }}>{acc.email} · joined {joined}</p>

        {/* ---- Profil ---- */}
        <form onSubmit={saveProfile} className={`${cardCls} fade-in delay-1 mb-4`}>
          <strong style={{ fontSize: 15 }}>Profile</strong>
          <div className="mt-3">
            <Label htmlFor={`${uid}-name`} className="mb-1.5 block">Full name</Label>
            <Input id={`${uid}-name`} value={fullName} onChange={(e) => setFullName(e.target.value)} minLength={2} maxLength={120} required />
          </div>
          <div className="mt-3.5">
            <Label htmlFor={`${uid}-email`} className="mb-1.5 block">Email</Label>
            <div className="flex items-center gap-2">
              <Input id={`${uid}-email`} value={acc.email} disabled className="flex-1" />
              <Badge variant={acc.emailVerified ? 'success' : 'secondary'}>{acc.emailVerified ? '✓ verified' : 'unverified'}</Badge>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">Email change with re-verification is coming soon.</div>
          </div>
          <div className="mt-3.5 flex justify-end">
            <Button type="submit" disabled={!dirty || savingProfile}>{savingProfile ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </form>

        {/* ---- Cek posta adresi (Faz A2) ---- */}
        {mailing?.hasMembership && (
          <form onSubmit={saveMailing} className={`${cardCls} fade-in delay-1 mb-4`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <strong style={{ fontSize: 15 }}>Mailing address</strong>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Commission checks are mailed here. Keep it current — you can&apos;t request a payout without a complete address.
                </div>
              </div>
              <Badge variant={mailing.complete ? 'success' : 'secondary'} className="flex-shrink-0">{mailing.complete ? '✓ complete' : 'incomplete'}</Badge>
            </div>
            <div className="mt-3">
              <Label htmlFor={`${uid}-maname`} className="mb-1.5 block">Payable to (name on check)</Label>
              <Input id={`${uid}-maname`} value={maName} onChange={(e) => setMaName(e.target.value)} minLength={2} maxLength={120} placeholder="Full legal name" required />
            </div>
            <div className="mt-3.5">
              <Label htmlFor={`${uid}-maline1`} className="mb-1.5 block">Street address</Label>
              <Input id={`${uid}-maline1`} value={maLine1} onChange={(e) => setMaLine1(e.target.value)} minLength={3} maxLength={120} placeholder="123 Main St" required />
            </div>
            <div className="mt-3.5">
              <Label htmlFor={`${uid}-maline2`} className="mb-1.5 block">Apt / Suite <span className="text-muted-foreground">(optional)</span></Label>
              <Input id={`${uid}-maline2`} value={maLine2} onChange={(e) => setMaLine2(e.target.value)} maxLength={120} placeholder="Apt 4B" />
            </div>
            <div className="mt-3.5 flex gap-2.5">
              <div className="flex-[2]">
                <Label htmlFor={`${uid}-macity`} className="mb-1.5 block">City</Label>
                <Input id={`${uid}-macity`} value={maCity} onChange={(e) => setMaCity(e.target.value)} minLength={2} maxLength={80} placeholder="Los Angeles" required />
              </div>
              <div className="flex-1">
                <Label htmlFor={`${uid}-mastate`} className="mb-1.5 block">State</Label>
                <Input id={`${uid}-mastate`} value={maState} onChange={(e) => setMaState(e.target.value.toUpperCase())} maxLength={2} placeholder="CA" className="uppercase" required />
              </div>
              <div className="flex-1">
                <Label htmlFor={`${uid}-mazip`} className="mb-1.5 block">ZIP</Label>
                <Input id={`${uid}-mazip`} value={maPostal} onChange={(e) => setMaPostal(e.target.value)} inputMode="numeric" placeholder="90001" required />
              </div>
            </div>
            {maError && <div className="mb-2.5 mt-2 text-sm text-destructive">{maError}</div>}
            <div className="mt-3.5 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">United States only.</span>
              <Button type="submit" disabled={savingMa}>{savingMa ? 'Saving…' : 'Save address'}</Button>
            </div>
          </form>
        )}
        {mailing && !mailing.hasMembership && (
          <div className={`${cardCls} fade-in delay-1 mb-4 text-sm text-muted-foreground`}>
            A mailing address (for commission checks) becomes available once you have an active membership in a company.
          </div>
        )}

        {/* ---- Sifre ---- */}
        <form onSubmit={changePassword} className={`${cardCls} fade-in delay-2 mb-4`}>
          <strong style={{ fontSize: 15 }}>Change password</strong>
          <div className="mt-3">
            <Label htmlFor={`${uid}-curpw`} className="mb-1.5 block">Current password</Label>
            <Input id={`${uid}-curpw`} type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" required />
          </div>
          <div className="mt-3.5">
            <Label htmlFor={`${uid}-newpw`} className="mb-1.5 block">New password</Label>
            <Input id={`${uid}-newpw`} type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" minLength={10} required />
          </div>
          <div className="mt-3.5">
            <Label htmlFor={`${uid}-confpw`} className="mb-1.5 block">Confirm new password</Label>
            <Input id={`${uid}-confpw`} type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" minLength={10} required />
          </div>
          {pwError && <div className="mb-2.5 mt-2 text-sm text-destructive">{pwError}</div>}
          <div className="mt-3.5 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Changing your password signs out your other devices.</span>
            <Button type="submit" disabled={savingPw || !curPw || !newPw || !confirmPw}>{savingPw ? 'Saving…' : 'Change password'}</Button>
          </div>
        </form>

        {/* ---- 2FA (TOTP) ---- */}
        <div className={`${cardCls} fade-in delay-3 mb-4`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <strong style={{ fontSize: 15 }}>Two-factor authentication</strong>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {acc.twoFactorEnabled
                  ? 'Enabled — sign-in requires a code from your authenticator app.'
                  : 'Add an authenticator app (Google Authenticator, 1Password, Authy…) for an extra layer of security. Optional.'}
              </div>
            </div>
            <span className="flex flex-shrink-0 items-center gap-2">
              <Badge variant={acc.twoFactorEnabled ? 'success' : 'secondary'}>{acc.twoFactorEnabled ? 'on' : 'off'}</Badge>
              {twoFaStep === 'idle' && !acc.twoFactorEnabled && <Button variant="ghost" size="sm" onClick={startSetup} disabled={twoFaBusy}>{twoFaBusy ? '…' : 'Set up'}</Button>}
              {twoFaStep === 'idle' && acc.twoFactorEnabled && <Button variant="ghost" size="sm" onClick={() => { setTwoFaError(''); setTwoFaStep('disable'); }}>Disable</Button>}
              {twoFaStep !== 'idle' && twoFaStep !== 'recovery' && <Button variant="ghost" size="sm" onClick={resetTwoFa}>Cancel</Button>}
            </span>
          </div>

          {twoFaError && <div className="mt-3 text-sm text-destructive">{twoFaError}</div>}

          {twoFaStep === 'setup' && setupData && (
            <form onSubmit={enableTwoFa} className="mt-3.5 border-t border-border pt-3.5">
              <div className="mb-2.5 text-[13px]">1. Scan this QR code with your authenticator app:</div>
              <div className="mb-3 flex flex-wrap items-center gap-[18px]">
                <div className="inline-block rounded-2xl bg-white p-3.5 shadow-lg"><QRCodeSVG value={setupData.otpauthUrl} size={144} /></div>
                <div className="min-w-[170px] flex-1">
                  <div className="mb-1 text-[11px] text-muted-foreground">Or enter this key manually:</div>
                  <code className="break-all font-mono text-xs">{setupData.secret}</code>
                </div>
              </div>
              <div className="mt-2">
                <Label htmlFor={`${uid}-2facode`} className="mb-1.5 block">2. Enter the 6-digit code to confirm</Label>
                <Input id={`${uid}-2facode`} value={twoFaCode} onChange={(e) => setTwoFaCode(e.target.value)} inputMode="numeric" placeholder="123456" autoFocus
                  className="max-w-[180px] font-mono text-base tracking-[0.2em]" />
              </div>
              <div className="mt-3.5 flex justify-end">
                <Button type="submit" disabled={twoFaBusy || twoFaCode.trim().length < 6}>{twoFaBusy ? 'Verifying…' : 'Enable 2FA'}</Button>
              </div>
            </form>
          )}

          {twoFaStep === 'recovery' && (
            <div className="mt-3.5 border-t border-border pt-3.5">
              <strong className="text-[13px] text-[color:var(--emerald)]">✓ Two-factor authentication enabled</strong>
              <p className="my-1.5 mb-2.5 text-xs text-muted-foreground">
                Save these recovery codes somewhere safe. Each works once if you lose your authenticator — they won&apos;t be shown again.
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1.5 rounded-[10px] bg-secondary p-3 font-mono text-[13px]">
                {recoveryCodes.map((cd) => <span key={cd}>{cd}</span>)}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={copyRecovery}>⧉ Copy</Button>
                <Button onClick={resetTwoFa}>Done</Button>
              </div>
            </div>
          )}

          {twoFaStep === 'disable' && (
            <form onSubmit={disableTwoFa} className="mt-3.5 border-t border-border pt-3.5">
              <div>
                <Label htmlFor={`${uid}-disablepw`} className="mb-1.5 block">Enter your password to disable 2FA</Label>
                <Input id={`${uid}-disablepw`} type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} autoComplete="current-password" autoFocus className="max-w-[260px]" />
              </div>
              <div className="mt-3.5 flex justify-end">
                <Button variant="destructive" type="submit" disabled={twoFaBusy || !disablePw}>{twoFaBusy ? 'Disabling…' : 'Disable 2FA'}</Button>
              </div>
            </form>
          )}
        </div>

        {/* ---- Aktif oturumlar ---- */}
        {sessions && (
          <div className={`${cardCls} fade-in mb-4`}>
            <div className="flex items-start justify-between gap-3" style={{ marginBottom: sessions.length ? 10 : 0 }}>
              <div>
                <strong style={{ fontSize: 15 }}>Active sessions</strong>
                <div className="mt-0.5 text-xs text-muted-foreground">Devices currently signed in to your account.</div>
              </div>
              {sessions.filter((s) => !s.current).length > 0 && <Button variant="ghost" size="sm" onClick={revokeOtherSessions}>Sign out others</Button>}
            </div>
            <table>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="flex items-center gap-2 text-[13px] font-semibold">
                        {s.device}
                        {s.current && <Badge variant="success">this device</Badge>}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{s.ip ?? 'unknown IP'} · active {dateShort(s.lastActive)}</div>
                    </td>
                    <td className="text-right">
                      {!s.current && <Button variant="ghost" size="sm" onClick={() => revokeSession(s.id)}>Sign out</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {toast && <div className="toast" role="status">{toast}</div>}
      </main>
    </div>
  );
}
