'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Brand } from '@/components/ui';

type Status = 'checking' | 'success' | 'error' | 'missing';

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

  return (
    <div className="center">
      <div className="fade-in" style={{ width: 420, maxWidth: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <Brand size="lg" />
        </div>
        <div className="card card-glow">
          <div className="eyebrow" style={{ marginBottom: 4 }}>Account security</div>
          <h1 className="h1" style={{ marginBottom: 12 }}>{title}</h1>
          {status === 'checking' ? (
            <div className="row" style={{ gap: 10, alignItems: 'center' }} role="status" aria-live="polite">
              <span className="skeleton" aria-hidden="true" style={{ width: 18, height: 18, borderRadius: '50%', flex: 'none' }} />
              <p className="muted" style={{ margin: 0 }}>Please wait while we verify your email address.</p>
            </div>
          ) : (
            <p
              className={status === 'success' ? 'muted' : 'error'}
              style={{ marginTop: 0 }}
              role={status === 'success' ? 'status' : 'alert'}
              aria-live="polite"
            >
              {message || 'Open the verification link from your email again.'}
            </p>
          )}
          <Link className="btn block" href="/login" style={{ marginTop: 18 }}>
            Go to login
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="center"><div className="card">Loading...</div></div>}>
      <VerifyEmailInner />
    </Suspense>
  );
}
