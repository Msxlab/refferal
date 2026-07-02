'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Brand } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ResetPasswordInner() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!token) {
      setError('Password reset token is missing.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.post<{ ok: true }>('/auth/password-reset/confirm', { token, newPassword: password });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Password reset link is invalid or expired.');
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
          <div className="eyebrow" style={{ marginBottom: 4 }}>Account security</div>
          <h1 className="h1" style={{ marginBottom: 12 }}>{done ? 'Password updated' : 'Reset password'}</h1>
          {done ? (
            <>
              <p className="muted" style={{ marginTop: 0 }}>Your password has been changed. Existing sessions were signed out.</p>
              <Link className="btn block" href="/login" style={{ marginTop: 18 }}>Go to login</Link>
            </>
          ) : (
            <>
              {!token && <div className="error">Password reset token is missing.</div>}
              <div className="field">
                <Label htmlFor="reset-new" className="mb-1.5 block">New password</Label>
                <Input
                  id="reset-new"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={10}
                  required
                  autoFocus
                  placeholder="At least 10 characters"
                />
              </div>
              <div className="field">
                <Label htmlFor="reset-confirm" className="mb-1.5 block">Confirm new password</Label>
                <Input
                  id="reset-confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  minLength={10}
                  required
                  placeholder="Repeat your new password"
                />
              </div>
              {error && <div className="error">{error}</div>}
              <Button type="submit" className="mt-1.5 w-full" disabled={busy || !token}>
                {busy ? 'Updating...' : 'Update password'}
              </Button>
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <Link href="/login" className="faint" style={{ fontSize: 12 }}>Back to login</Link>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="center"><div className="card">Loading...</div></div>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
