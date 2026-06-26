'use client';

import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';

/** Sonner toaster — uygulamanin data-theme'ini izler ve tasarim token'lariyla stillenir. */
export function AppToaster() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => {
    const read = () => setTheme((document.documentElement.getAttribute('data-theme') as 'light' | 'dark') ?? 'dark');
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  return (
    <Toaster
      theme={theme}
      position="top-right"
      richColors
      closeButton
      gap={10}
      toastOptions={{
        style: {
          background: 'hsl(var(--popover))',
          color: 'hsl(var(--popover-foreground))',
          border: '1px solid hsl(var(--border))',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-card-hover)',
          fontFamily: 'var(--font-sans)',
        },
      }}
    />
  );
}
