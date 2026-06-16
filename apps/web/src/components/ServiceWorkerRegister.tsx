'use client';

import { useEffect } from 'react';

/**
 * Service worker'i kaydeder (yalniz production — dev'de HMR ile cakismasin).
 * SW stratejisi public/sw.js: app-shell cache, API asla cache'lenmez.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* kayit basarisiz olsa da uygulama calismaya devam eder */
    });
  }, []);
  return null;
}
