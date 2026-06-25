'use client';

import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/lib/api';
import { getSession } from '@/lib/auth';

/** Backend EventsService ile ayni olay adlari (SSE 'event:' alani). */
const EVENT_TYPES = ['sale.created', 'sale.approved', 'payout.paid'] as const;

const LABELS: Record<string, string> = {
  'sale.created': 'New sale',
  'sale.approved': 'Sale approved',
  'payout.paid': 'Payout sent',
};

/**
 * Canli SSE gostergesi (Dalga 3). EventSource ile /events/stream'e baglanir,
 * baglanti durumunu nokta ile gosterir ve her olayda 'refearn:live' window
 * event'i yayar — boylece acik sayfalar verisini yenileyebilir.
 */
export function LiveIndicator() {
  const [connected, setConnected] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const token = getSession()?.accessToken;
    if (!token || typeof window === 'undefined') return;

    const es = new EventSource(`${API_BASE}/events/stream?token=${encodeURIComponent(token)}`);
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // EventSource kendisi yeniden baglanir

    const onEvent = (type: string) => (ev: MessageEvent) => {
      setLast(LABELS[type] ?? type);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setLast(null), 4000);
      let detail: unknown = {};
      try { detail = JSON.parse(ev.data); } catch { /* veri yoksa bos */ }
      window.dispatchEvent(new CustomEvent('refearn:live', { detail: { type, data: detail } }));
    };
    const handlers = EVENT_TYPES.map((t) => [t, onEvent(t)] as const);
    handlers.forEach(([t, h]) => es.addEventListener(t, h as EventListener));

    return () => {
      handlers.forEach(([t, h]) => es.removeEventListener(t, h as EventListener));
      es.close();
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  return (
    <span className="live" title={connected ? 'Live — connected' : 'Disconnected'} aria-live="polite">
      <span className={`live-dot ${connected ? 'on' : 'off'}`} />
      {last ? <span className="live-msg">{last}</span> : null}
    </span>
  );
}

/**
 * Sayfalarda kullanim: canli olay geldiginde callback calistirir (genelde refetch).
 * types verilmezse tum olaylar dinlenir.
 */
export function useLiveRefresh(cb: () => void, types?: readonly string[]): void {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ type: string }>).detail;
      if (!types || types.includes(detail?.type)) cbRef.current();
    };
    window.addEventListener('refearn:live', handler);
    return () => window.removeEventListener('refearn:live', handler);
  }, [types]);
}
