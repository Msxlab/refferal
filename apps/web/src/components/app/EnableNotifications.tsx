'use client';

import { useEffect, useState } from 'react';
import { Bell, BellRing, BellOff, X } from 'lucide-react';
import { useToast } from '@/components/ui';
import { getPushState, enablePush, disablePush, type PushState } from '@/lib/push';

/**
 * Uye yeniden-etkilesim: tarayici push bildirimleri ac/kapa.
 * - Desteklenmiyorsa / yukleniyorsa hicbir sey gostermez.
 * - Abone degilse: premium bir "ac" promtu (kapatilabilir).
 * - Aboneyse: sade bir "acik" satiri + kapat baglantisi.
 * - Tarayicida engellendiyse: nazik bir aciklama.
 */
export function EnableNotifications() {
  const [, toast] = useToast();
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    getPushState().then(setState).catch(() => setState('unsupported'));
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const ok = await enablePush();
      if (ok) {
        setState('subscribed');
        toast('Notifications enabled');
      } else {
        const denied = typeof Notification !== 'undefined' && Notification.permission === 'denied';
        setState(denied ? 'denied' : 'unsubscribed');
        if (denied) toast('Notifications were blocked in your browser');
      }
    } catch {
      toast('Could not enable notifications');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await disablePush();
      setState('unsubscribed');
      toast('Notifications turned off');
    } catch {
      toast('Could not turn off notifications');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading' || state === 'unsupported') return null;

  // Engellendi — tarayici ayarlarindan acmasi gerektigini nazikce soyle.
  if (state === 'denied') {
    if (dismissed) return null;
    return (
      <div className="card fade-in" style={{ marginBottom: 16 }}>
        <div className="spread" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span className="icon" style={{ flexShrink: 0 }}><BellOff className="size-[18px]" aria-hidden /></span>
            <div>
              <strong style={{ fontSize: 14 }}>Notifications are blocked</strong>
              <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                Enable them for this site in your browser settings to get alerts when you earn or get paid.
              </div>
            </div>
          </div>
          <button className="faint" onClick={() => setDismissed(true)} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  // Abone — sade "acik" satiri.
  if (state === 'subscribed') {
    return (
      <div className="card fade-in" style={{ marginBottom: 16 }}>
        <div className="spread" style={{ alignItems: 'center', gap: 12 }}>
          <span className="row" style={{ gap: 10, alignItems: 'center', fontSize: 13.5 }}>
            <span className="icon" style={{ background: 'var(--foil)', color: 'var(--on-gold)' }}><BellRing className="size-[18px]" aria-hidden /></span>
            <span><strong style={{ fontWeight: 700 }}>Notifications are on.</strong> <span className="muted">We&apos;ll ping you when you earn or get paid.</span></span>
          </span>
          <button className="btn ghost sm" disabled={busy} onClick={disable}>Turn off</button>
        </div>
      </div>
    );
  }

  // Abone degil — premium "ac" promtu.
  if (dismissed) return null;
  return (
    <div className="card fade-in glow-primary" style={{ marginBottom: 16, borderColor: 'color-mix(in srgb, var(--gold-500) 35%, transparent)' }}>
      <div className="spread" style={{ alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <span className="icon" style={{ background: 'var(--foil)', color: 'var(--on-gold)', flexShrink: 0 }}><Bell className="size-[18px]" aria-hidden /></span>
          <div>
            <strong style={{ fontSize: 14 }}>Never miss a payout</strong>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Get a notification the moment you earn a commission, gain a recruit, or your payout is on the way.
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <button className="btn sm" disabled={busy} onClick={enable}>
            <Bell className="size-4" aria-hidden />{busy ? 'Enabling…' : 'Enable notifications'}
          </button>
          <button className="faint" onClick={() => setDismissed(true)} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
