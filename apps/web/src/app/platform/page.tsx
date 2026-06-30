'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loading } from '@/components/ui';

// Eski sahip ana sayfasi emekliye ayrildi: HQ drill-in (/hq) artik tek giris.
export default function PlatformHomePage() {
  const router = useRouter();
  useEffect(() => { router.replace('/hq'); }, [router]);
  return <div className="center"><Loading rows={3} /></div>;
}
