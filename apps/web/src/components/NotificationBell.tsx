'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { Popover as PopoverRoot, PopoverTrigger, PopoverContent } from './ui/popover';
import { Button } from './ui/button';

interface Item {
  id: string;
  template: string;
  kind: 'positive' | 'negative' | 'team' | 'system';
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}
interface Inbox { items: Item[]; unreadCount: number; nextBefore: string | null }

const KIND_ICON: Record<Item['kind'], { ic: string; color: string }> = {
  positive: { ic: '↑', color: 'var(--emerald)' },
  negative: { ic: '↓', color: 'var(--rose)' },
  team: { ic: '⬡', color: 'var(--sky)' },
  system: { ic: '◔', color: 'var(--muted)' },
};

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function inboxFailureMessage(hasInbox: boolean): string {
  return hasInbox
    ? 'Notifications could not be refreshed. Showing previously loaded notifications.'
    : 'Notifications could not be loaded.';
}

function requestIsCurrent(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration;
}

export function NotificationBell({ placement = 'down' }: { placement?: 'down' | 'up' }) {
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [inboxError, setInboxError] = useState(false);
  const [markAllPending, setMarkAllPending] = useState(false);
  const mountedRef = useRef(false);
  const inboxRequestGeneration = useRef(0);
  const unreadWriteGeneration = useRef(0);
  const countRequestFlight = useRef<Promise<void> | null>(null);
  const notificationMutationPendingRef = useRef(0);
  const markAllPendingRef = useRef(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      inboxRequestGeneration.current += 1;
    };
  }, []);

  const refreshCount = useCallback((): Promise<void> | null => {
    if (notificationMutationPendingRef.current > 0 || countRequestFlight.current) return countRequestFlight.current;
    const unreadGeneration = ++unreadWriteGeneration.current;
    const flight = api.get<{ count: number }>('/me/notifications/unread-count')
      .then(({ count }) => {
        if (mountedRef.current && requestIsCurrent(unreadGeneration, unreadWriteGeneration.current)) {
          setUnread(count);
        }
      })
      .catch(() => { /* silent */ });
    countRequestFlight.current = flight;
    void flight.finally(() => {
      if (countRequestFlight.current === flight) countRequestFlight.current = null;
    });
    return flight;
  }, []);

  // ilk yukleme + periyodik okunmamis sayisi (hafif uc)
  useEffect(() => {
    refreshCount();
    const id = setInterval(refreshCount, 45_000);
    return () => clearInterval(id);
  }, [refreshCount]);

  const invalidateNotificationLoads = useCallback(() => {
    inboxRequestGeneration.current += 1;
    unreadWriteGeneration.current += 1;
    if (mountedRef.current) setLoading(false);
  }, []);

  function beginNotificationMutation() {
    notificationMutationPendingRef.current += 1;
    invalidateNotificationLoads();
  }

  function endNotificationMutation() {
    notificationMutationPendingRef.current = Math.max(0, notificationMutationPendingRef.current - 1);
  }

  async function loadInbox() {
    if (notificationMutationPendingRef.current > 0) return;
    const requestGeneration = ++inboxRequestGeneration.current;
    const inboxUnreadGeneration = ++unreadWriteGeneration.current;
    const isCurrent = () => mountedRef.current && requestIsCurrent(requestGeneration, inboxRequestGeneration.current);
    setLoading(true);
    try {
      const data = await api.get<Inbox>('/me/notifications?limit=12');
      if (!isCurrent()) return;
      setInbox(data);
      if (requestIsCurrent(inboxUnreadGeneration, unreadWriteGeneration.current)) {
        setUnread(data.unreadCount);
      }
      setInboxError(false);
    } catch {
      if (isCurrent()) setInboxError(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }

  // Radix Popover ac/kapa: acilista kutuyu cek (dis-tiklama/ESC/konumlandirma dahili)
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void loadInbox();
  }

  function handleOpenAutoFocus(event: Event) {
    event.preventDefault();
    closeButtonRef.current?.focus({ preventScroll: true });
  }

  function handleRetry() {
    closeButtonRef.current?.focus({ preventScroll: true });
    void loadInbox();
  }

  async function markAll() {
    if (markAllPendingRef.current) return;
    markAllPendingRef.current = true;
    setMarkAllPending(true);
    beginNotificationMutation();
    try {
      await api.post('/me/notifications/read-all');
      if (!mountedRef.current) return;
      setInbox((prev) => prev ? { ...prev, items: prev.items.map((i) => ({ ...i, read: true })) } : prev);
      setUnread(0);
    } catch { /* sessiz */ } finally {
      endNotificationMutation();
      markAllPendingRef.current = false;
      if (mountedRef.current) setMarkAllPending(false);
    }
  }

  async function openItem(it: Item) {
    if (!it.read) {
      beginNotificationMutation();
      setInbox((prev) => prev ? { ...prev, items: prev.items.map((i) => i.id === it.id ? { ...i, read: true } : i) } : prev);
      setUnread((u) => Math.max(0, u - 1));
      try { await api.post(`/me/notifications/${it.id}/read`); } catch { /* sessiz */ } finally {
        endNotificationMutation();
      }
    }
  }

  return (
    <PopoverRoot open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="theme-toggle"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
          style={{ position: 'relative' }}
        >
          <span aria-hidden style={{ fontSize: 15 }}>◔</span>
          {unread > 0 && (
            <span aria-hidden style={{
              position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, padding: '0 4px',
              borderRadius: 999, background: 'var(--rose)', color: '#fff', fontSize: 10, fontWeight: 800,
              display: 'grid', placeItems: 'center', lineHeight: 1, boxShadow: '0 0 0 2px var(--panel)',
            }}>{unread > 9 ? '9+' : unread}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={placement === 'up' ? 'top' : 'bottom'}
        align="end"
        className="max-h-[var(--radix-popover-content-available-height)] w-[360px] max-w-[92vw] overflow-hidden p-0"
        aria-labelledby={headingId}
        onOpenAutoFocus={handleOpenAutoFocus}
      >
        <div className="spread" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <strong id={headingId} style={{ fontSize: 13 }}>Notifications</strong>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Button type="button" variant="ghost" size="sm" onClick={markAll}
              disabled={loading || markAllPending || !inbox || unread === 0}
              className="px-2 text-[11px] text-[var(--brand)] hover:text-[var(--brand)]">
              {markAllPending ? 'Marking...' : 'Mark all read'}
            </Button>
            <Button ref={closeButtonRef} type="button" variant="ghost" size="icon"
              aria-label="Close notifications" onClick={() => setOpen(false)}>
              <X aria-hidden="true" />
            </Button>
          </span>
        </div>
        <div style={{ maxHeight: 'min(380px, calc(var(--radix-popover-content-available-height) - 65px))', overflow: 'auto' }}>
          {loading && !inbox && !inboxError && <div className="faint" style={{ padding: 18, fontSize: 12 }}>Loading…</div>}
          {inboxError && (
            <div role="alert" style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
              <strong style={{ display: 'block', fontSize: 12.5 }}>
                {inbox ? 'Notifications may be stale' : 'Notifications unavailable'}
              </strong>
              <span className="faint" style={{ display: 'block', marginTop: 3, fontSize: 11.5 }}>
                {inboxFailureMessage(Boolean(inbox))}
              </span>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={handleRetry} disabled={loading}>
                {loading ? 'Refreshing...' : 'Retry'}
              </Button>
            </div>
          )}
          {loading && inbox && !inboxError && (
            <div className="faint" style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 11.5 }}>
              Refreshing...
            </div>
          )}
          {inbox && inbox.items.length === 0 && (
            <div className="faint" style={{ padding: 24, textAlign: 'center', fontSize: 12.5 }}>
              You&apos;re all caught up.
            </div>
          )}
          {inbox?.items.map((it) => {
            const k = KIND_ICON[it.kind];
            return (
              <button key={it.id} type="button" onClick={() => openItem(it)} className="inbox-row"
                style={{ background: it.read ? 'transparent' : 'var(--panel-2)' }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center',
                  background: `color-mix(in srgb, ${k.color} 16%, transparent)`, color: k.color, fontWeight: 800, fontSize: 13,
                }}>{k.ic}</span>
                <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                  <span className="spread" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text)' }}>{it.title}</span>
                    <span className="faint" style={{ fontSize: 10.5, flexShrink: 0 }}>{ago(it.createdAt)}</span>
                  </span>
                  <span className="faint" style={{ fontSize: 11.5, lineHeight: 1.45, display: 'block', marginTop: 2 }}>{it.body}</span>
                </span>
                {!it.read && <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--brand)', flexShrink: 0, alignSelf: 'center' }} />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}
