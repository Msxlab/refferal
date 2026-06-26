'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { APP_NAME } from '@/lib/brand';

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const KEY = 'refearn.install.dismissed';

/** Zarif "Uygulamayi yukle" banner'i — beforeinstallprompt yakalandiginda gosterir (PWA A2HS). */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try { setDismissed(localStorage.getItem(KEY) === '1'); } catch { setDismissed(false); }
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent); };
    const onInstalled = () => { setDeferred(null); try { localStorage.setItem(KEY, '1'); } catch { /* yok */ } };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  if (!deferred || dismissed) return null;

  const install = async () => {
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } finally {
      setDeferred(null);
    }
  };
  const dismiss = () => { setDismissed(true); try { localStorage.setItem(KEY, '1'); } catch { /* yok */ } };

  return (
    <div className="no-print fixed bottom-4 left-1/2 z-50 w-[min(420px,92vw)] -translate-x-1/2 animate-in slide-in-from-bottom-3 fade-in duration-300">
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-popover/95 p-3 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.5)] backdrop-blur">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
          <Download className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-foreground">Install {APP_NAME}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">Add to your home screen — faster, full-screen, works offline.</div>
        </div>
        <button onClick={install} className="btn sm shrink-0">Install</button>
        <button onClick={dismiss} aria-label="Dismiss" className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
