'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { setSession, type Session } from '@/lib/auth';
import { Brand } from '@/components/ui';

function AcceptInviteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!token) {
      setError('Invite link is missing its token.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const session = await api.post<Session>('/auth/accept-owner-invite', {
        token,
        password,
        fullName: fullName.trim() || undefined,
      });
      setSession(session);
      router.push('/admin');
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 ? 'This invite link is invalid or has expired.' : 'Could not accept the invite. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="fade-in" style={{ width: 420, maxWidth: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <Brand size="lg" />
        </div>
        <form className="card card-glow" onSubmit={onSubmit}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Welcome</div>
          <h1 className="h1" style={{ marginBottom: 12 }}>Set up your account</h1>
          {!token && <div className="error">Invite link is missing its token.</div>}
          <div className="field">
            <label>Full name (optional)</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
              placeholder="Jane Doe"
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={10}
              required
              placeholder="At least 10 characters"
            />
          </div>
          <div className="field">
            <label>Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={10}
              required
              placeholder="Repeat your password"
            />
          </div>
          {error && <div className="error">{error}</div>}
          <button className="btn block" style={{ marginTop: 6 }} disabled={busy || !token}>
            {busy ? 'Setting up…' : 'Set password & continue'}
          </button>
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <Link href="/login" className="faint" style={{ fontSize: 12 }}>Back to login</Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="center"><div className="card">Loading...</div></div>}>
      <AcceptInviteInner />
    </Suspense>
  );
}
