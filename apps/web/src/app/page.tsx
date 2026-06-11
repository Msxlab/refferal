'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSession } from '@/lib/auth';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getSession() ? '/admin' : '/login');
  }, [router]);
  return <div className="center muted">Yonlendiriliyor...</div>;
}
