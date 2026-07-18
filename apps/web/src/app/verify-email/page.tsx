'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Brand } from '@/components/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Status = 'checking' | 'success' | 'error' | 'missing';

function LoadingCard() {
  return (
    <div className="center px-4">
      <Card className="w-full max-w-[420px]">
        <CardContent>Loading...</CardContent>
      </Card>
    </div>
  );
}

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<Status>(token ? 'checking' : 'missing');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return;
    let active = true;
    api
      .post<{ ok: true }>('/auth/verify-email', { token })
      .then(() => {
        if (!active) return;
        setStatus('success');
        setMessage('Your email address has been verified.');
      })
      .catch((e) => {
        if (!active) return;
        setStatus('error');
        setMessage(e instanceof ApiError ? e.message : 'Verification link is invalid or expired.');
      });
    return () => {
      active = false;
    };
  }, [token]);

  const title =
    status === 'success'
      ? 'Email verified'
      : status === 'missing'
        ? 'Missing verification token'
        : status === 'error'
          ? 'Could not verify email'
          : 'Verifying email';
  const isProblem = status === 'error' || status === 'missing';

  return (
    <div className="center px-4">
      <div className="fade-in flex w-full max-w-[420px] flex-col gap-5">
        <div className="flex justify-center">
          <Brand size="lg" />
        </div>
        <Card>
          <CardHeader>
            <CardDescription>Account security</CardDescription>
            <CardTitle className="text-2xl">{title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Alert variant={isProblem ? 'destructive' : 'default'}>
              {status === 'checking' ? <Loader2 className="animate-spin" /> : status === 'success' ? <CheckCircle2 /> : <AlertCircle />}
              <AlertDescription>
                {status === 'checking'
                  ? 'Please wait while we verify your email address.'
                  : message || 'Open the verification link from your email again.'}
              </AlertDescription>
            </Alert>
            <Button className="w-full" asChild>
              <Link href="/login">
                Go to login
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<LoadingCard />}>
      <VerifyEmailInner />
    </Suspense>
  );
}
