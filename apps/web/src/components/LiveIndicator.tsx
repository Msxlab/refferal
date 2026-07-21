'use client';

import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/lib/api';
import { getSession } from '@/lib/auth';
import { getActiveCompanyToken } from '@/lib/active-company';

/** Backend EventsService ile ayni olay adlari (SSE 'event:' alani). */
const EVENT_TYPES = ['sale.created', 'sale.approved', 'payout.paid'] as const;

const LABELS: Record<string, string> = {
  'sale.created': 'New sale',
  'sale.approved': 'Sale approved',
  'payout.paid': 'Payout sent',
};

const RECONNECT_DELAY_MS = 2_000;

interface ParsedSseEvent {
  type: string;
  data: string;
}

function parseSseFrame(frame: string): ParsedSseEvent | null {
  let type = 'message';
  const data: string[] = [];

  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') type = value;
    if (field === 'data') data.push(value);
  }

  return data.length > 0 ? { type, data: data.join('\n') } : null;
}

function appendSseChunk(buffer: string, chunk: string): string {
  // A CRLF sequence can cross a network chunk boundary. Preserve a trailing
  // carriage return until the next chunk so one line break never becomes two.
  return `${buffer}${chunk}`.replace(/\r\n/g, '\n').replace(/\r(?!$)/g, '\n');
}

/** Canli SSE gostergesi: bearer fetch stream ile baglanir; token URL'ye yazilmaz. */
export function LiveIndicator() {
  const [connected, setConnected] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let stopped = false;
    const abort = new AbortController();

    const emit = (type: string, rawData: string) => {
      if (!EVENT_TYPES.includes(type as (typeof EVENT_TYPES)[number])) return;
      setLast(LABELS[type] ?? type);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setLast(null), 4000);
      let detail: unknown = {};
      try { detail = JSON.parse(rawData); } catch { /* veri yoksa bos */ }
      window.dispatchEvent(new CustomEvent('refearn:live', { detail: { type, data: detail } }));
    };

    const scheduleReconnect = (connect: () => Promise<void>) => {
      if (stopped || reconnectTimer.current) return;
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        void connect();
      }, RECONNECT_DELAY_MS);
    };

    const connect = async (): Promise<void> => {
      // HQ drill-in icinde aktif sirket token'i kullan; her yeniden baglanmada
      // guncel oturumu yeniden oku ki token rotasyonu sonrasi eski JWT tutulmasin.
      let token: string | undefined;
      try {
        token = getActiveCompanyToken() ?? getSession()?.accessToken;
      } catch {
        setConnected(false);
        return;
      }
      if (!token || stopped) {
        setConnected(false);
        return;
      }

      try {
        const response = await fetch(`${API_BASE}/events/stream`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
          signal: abort.signal,
        });
        if (!response.ok || !response.body) {
          setConnected(false);
          // Yetki hatasinda tekrar denemek eski/iptal edilmis tokeni gereksizce kullanir.
          if (response.status !== 401 && response.status !== 403) scheduleReconnect(connect);
          return;
        }

        setConnected(true);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer = appendSseChunk(buffer, decoder.decode(value, { stream: true }));

          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const event = parseSseFrame(frame);
            if (event) emit(event.type, event.data);
            boundary = buffer.indexOf('\n\n');
          }
        }

        if (!stopped) {
          setConnected(false);
          scheduleReconnect(connect);
        }
      } catch {
        if (stopped || abort.signal.aborted) return;
        setConnected(false);
        scheduleReconnect(connect);
      }
    };

    void connect();

    return () => {
      stopped = true;
      abort.abort();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
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
