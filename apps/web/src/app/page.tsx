'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, landingForSession } from '@/lib/auth';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const session = getSession();
    router.replace(session ? landingForSession(session) : '/login');
  }, [router]);
  return <div className="center muted">Yonlendiriliyor...</div>;
}
