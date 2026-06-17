'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { api, ApiError } from '@/lib/api';
import { activeMembership, getSession, isAdminRole, setSession } from '@/lib/auth';
import { Brand, Loading, ThemeToggle, useToast } from '@/components/ui';

interface Account {
  id: string; email: string; fullName: string; locale: string; avatarPath: string | null;
  emailVerified: boolean; twoFactorEnabled: boolean; createdAt: string;
}

export default function AccountPage() {
  const router = useRouter();
  const [acc, setAcc] = useState<Account | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [backHref, setBackHref] = useState('/app');

  // profil formu
  const [fullName, setFullName] = useState('');
  const [locale, setLocale] = useState('en');
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

  useEffect(() => {
    const s = getSession();
    if (!s) { router.replace('/login'); return; }
    const active = activeMembership(s);
    setBackHref(isAdminRole(active?.role) ? '/admin' : '/app');
    api.get<Account>('/account')
      .then((a) => { setAcc(a); setFullName(a.fullName); setLocale(a.locale); })
      .catch((e) => setError(String((e as ApiError).message)));
  }, [router]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const a = await api.patch<Account>('/account/profile', { fullName: fullName.trim(), locale });
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

  if (error) return <div className="center error">{error}</div>;
  if (!acc) return <div className="center"><Loading /></div>;

  const dirty = fullName.trim() !== acc.fullName || locale !== acc.locale;
  const joined = new Date(acc.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div style={{ minHeight: '100vh' }}>
      <header className="topbar">
        <div className="inner" style={{ maxWidth: 640 }}>
          <Brand />
          <span style={{ flex: 1 }} />
          <ThemeToggle />
          <Link href={backHref} className="btn ghost sm">← Back</Link>
        </div>
      </header>

      <main style={{ maxWidth: 640, margin: '0 auto', padding: '28px 18px 60px' }}>
        <div className="eyebrow fade-in">Account</div>
        <h1 className="h1 fade-in" style={{ marginBottom: 4 }}>{acc.fullName}</h1>
        <p className="sub fade-in" style={{ marginBottom: 22 }}>{acc.email} · joined {joined}</p>

        {/* ---- Profil ---- */}
        <form onSubmit={saveProfile} className="card fade-in delay-1" style={{ marginBottom: 16 }}>
          <strong style={{ fontSize: 15 }}>Profile</strong>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Full name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} minLength={2} maxLength={120} required />
          </div>
          <div className="field">
            <label>Email</label>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <input value={acc.email} disabled style={{ flex: 1 }} />
              <span className={`badge ${acc.emailVerified ? 'active' : 'inactive'}`} style={{ fontSize: 9 }}>
                {acc.emailVerified ? '✓ verified' : 'unverified'}
              </span>
            </div>
            <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Email change with re-verification is coming soon.</div>
          </div>
          <div className="field">
            <label>Language</label>
            <select value={locale} onChange={(e) => setLocale(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="en">English</option>
              <option value="tr">Türkçe</option>
            </select>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" type="submit" disabled={!dirty || savingProfile}>{savingProfile ? 'Saving…' : 'Save changes'}</button>
          </div>
        </form>

        {/* ---- Sifre ---- */}
        <form onSubmit={changePassword} className="card fade-in delay-2" style={{ marginBottom: 16 }}>
          <strong style={{ fontSize: 15 }}>Change password</strong>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Current password</label>
            <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" required />
          </div>
          <div className="field">
            <label>New password</label>
            <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" minLength={10} required />
          </div>
          <div className="field">
            <label>Confirm new password</label>
            <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" minLength={10} required />
          </div>
          {pwError && <div className="error" style={{ marginBottom: 10 }}>{pwError}</div>}
          <div className="spread" style={{ alignItems: 'center' }}>
            <span className="faint" style={{ fontSize: 11 }}>Changing your password signs out your other devices.</span>
            <button className="btn" type="submit" disabled={savingPw || !curPw || !newPw || !confirmPw}>{savingPw ? 'Saving…' : 'Change password'}</button>
          </div>
        </form>

        {/* ---- 2FA (TOTP) ---- */}
        <div className="card fade-in delay-3" style={{ marginBottom: 16 }}>
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <div>
              <strong style={{ fontSize: 15 }}>Two-factor authentication</strong>
              <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
                {acc.twoFactorEnabled
                  ? 'Enabled — sign-in requires a code from your authenticator app.'
                  : 'Add an authenticator app (Google Authenticator, 1Password, Authy…) for an extra layer of security. Optional.'}
              </div>
            </div>
            <span className="row" style={{ gap: 8, flexShrink: 0 }}>
              <span className={`badge ${acc.twoFactorEnabled ? 'active' : 'inactive'}`} style={{ fontSize: 9 }}>{acc.twoFactorEnabled ? 'on' : 'off'}</span>
              {twoFaStep === 'idle' && !acc.twoFactorEnabled && <button className="btn ghost sm" onClick={startSetup} disabled={twoFaBusy}>{twoFaBusy ? '…' : 'Set up'}</button>}
              {twoFaStep === 'idle' && acc.twoFactorEnabled && <button className="btn ghost sm" onClick={() => { setTwoFaError(''); setTwoFaStep('disable'); }}>Disable</button>}
              {twoFaStep !== 'idle' && twoFaStep !== 'recovery' && <button className="btn ghost sm" onClick={resetTwoFa}>Cancel</button>}
            </span>
          </div>

          {twoFaError && <div className="error" style={{ marginTop: 12 }}>{twoFaError}</div>}

          {twoFaStep === 'setup' && setupData && (
            <form onSubmit={enableTwoFa} style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ fontSize: 13, marginBottom: 10 }}>1. Scan this QR code with your authenticator app:</div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                <div className="qr"><QRCodeSVG value={setupData.otpauthUrl} size={144} /></div>
                <div style={{ minWidth: 170, flex: 1 }}>
                  <div className="faint" style={{ fontSize: 11, marginBottom: 4 }}>Or enter this key manually:</div>
                  <code style={{ fontSize: 12, wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace' }}>{setupData.secret}</code>
                </div>
              </div>
              <div className="field">
                <label>2. Enter the 6-digit code to confirm</label>
                <input value={twoFaCode} onChange={(e) => setTwoFaCode(e.target.value)} inputMode="numeric" placeholder="123456" autoFocus
                  style={{ maxWidth: 180, letterSpacing: '0.2em', fontFamily: 'ui-monospace, monospace', fontSize: 16 }} />
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn" type="submit" disabled={twoFaBusy || twoFaCode.trim().length < 6}>{twoFaBusy ? 'Verifying…' : 'Enable 2FA'}</button>
              </div>
            </form>
          )}

          {twoFaStep === 'recovery' && (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <strong style={{ fontSize: 13, color: 'var(--emerald)' }}>✓ Two-factor authentication enabled</strong>
              <p className="faint" style={{ fontSize: 12, margin: '6px 0 10px' }}>
                Save these recovery codes somewhere safe. Each works once if you lose your authenticator — they won&apos;t be shown again.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 6, fontFamily: 'ui-monospace, monospace', fontSize: 13, background: 'var(--panel-2)', padding: 12, borderRadius: 10 }}>
                {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button className="btn ghost sm" onClick={copyRecovery}>⧉ Copy</button>
                <button className="btn" onClick={resetTwoFa}>Done</button>
              </div>
            </div>
          )}

          {twoFaStep === 'disable' && (
            <form onSubmit={disableTwoFa} style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div className="field">
                <label>Enter your password to disable 2FA</label>
                <input type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} autoComplete="current-password" autoFocus style={{ maxWidth: 260 }} />
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn danger" type="submit" disabled={twoFaBusy || !disablePw}>{twoFaBusy ? 'Disabling…' : 'Disable 2FA'}</button>
              </div>
            </form>
          )}
        </div>

        {toast && <div className="toast" role="status">{toast}</div>}
      </main>
    </div>
  );
}
