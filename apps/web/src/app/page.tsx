'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, landingForSession } from '@/lib/auth';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const s = getSession();
    router.replace(s ? landingForSession(s) : '/login');
  }, [router]);
  return <div className="center muted">Redirecting…</div>;
}
