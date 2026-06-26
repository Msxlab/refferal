'use client';

import { useEffect, useState } from 'react';

/**
 * Cevrimdisi durumunda ust bantta uyari gosterir. API canli veriyi yenileyemediginde
 * kullaniciya kirik ekran yerine net bir durum verir (finansal app — bayat veri gostermeyiz).
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(typeof navigator !== 'undefined' && !navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
        background: 'var(--amber)', color: 'var(--on-gold)', textAlign: 'center',
        padding: '6px 12px', fontSize: 'var(--text-md)', fontWeight: 600,
      }}
    >
      ⚠ You&apos;re offline — live data can&apos;t update. Some actions are paused until you reconnect.
    </div>
  );
}
