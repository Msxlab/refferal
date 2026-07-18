'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Brand } from '@/components/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

function LoadingCard() {
  return (
    <div className="center px-4">
      <Card className="w-full max-w-[420px]">
        <CardContent>Loading...</CardContent>
      </Card>
    </div>
  );
}

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
    <div className="center px-4">
      <div className="fade-in flex w-full max-w-[420px] flex-col gap-5">
        <div className="flex justify-center">
          <Brand size="lg" />
        </div>
        <Card>
          <CardHeader>
            <CardDescription>Account security</CardDescription>
            <CardTitle className="text-2xl">{done ? 'Password updated' : 'Reset password'}</CardTitle>
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="flex flex-col gap-5">
                <Alert>
                  <CheckCircle2 />
                  <AlertDescription>Your password has been changed. Existing sessions were signed out.</AlertDescription>
                </Alert>
                <Button className="w-full" asChild>
                  <Link href="/login">
                    Go to login
                    <ArrowRight data-icon="inline-end" />
                  </Link>
                </Button>
              </div>
            ) : (
              <form className="flex flex-col gap-5" onSubmit={onSubmit}>
                <FieldGroup>
                  <Field data-invalid={!token || undefined}>
                    <FieldLabel htmlFor="new-password">New password</FieldLabel>
                    <Input
                      id="new-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={10}
                      required
                      autoFocus
                      placeholder="At least 10 characters"
                      aria-invalid={!token || undefined}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
                    <Input
                      id="confirm-password"
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      minLength={10}
                      required
                      placeholder="Repeat your new password"
                    />
                  </Field>
                </FieldGroup>
                {!token && (
                  <Alert variant="destructive">
                    <AlertCircle />
                    <AlertDescription>Password reset token is missing.</AlertDescription>
                  </Alert>
                )}
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button className="w-full" disabled={busy || !token}>
                  {busy ? 'Updating...' : 'Update password'}
                </Button>
                <Button variant="link" asChild>
                  <Link href="/login">Back to login</Link>
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<LoadingCard />}>
      <ResetPasswordInner />
    </Suspense>
  );
}
