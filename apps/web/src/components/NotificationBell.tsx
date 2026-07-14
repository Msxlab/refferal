'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Bell, Info, Users, X, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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
type InboxCloseReason = 'escape' | 'toggle' | 'close-button' | 'outside-pointer';

const KIND_ICON: Record<Item['kind'], { Icon: LucideIcon; color: string }> = {
  positive: { Icon: ArrowUp, color: 'var(--emerald)' },
  negative: { Icon: ArrowDown, color: 'var(--rose)' },
  team: { Icon: Users, color: 'var(--sky)' },
  system: { Icon: Info, color: 'var(--muted)' },
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

function shouldRestoreTriggerFocus(reason: InboxCloseReason): boolean {
  return reason !== 'outside-pointer';
}

function inboxRequestIsCurrent(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration;
}

export function NotificationBell({ placement = 'down' }: { placement?: 'down' | 'up' }) {
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [inboxError, setInboxError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const inboxRequestGeneration = useRef(0);
  const triggerId = useId();
  const dialogId = useId();
  const titleId = useId();

  const refreshCount = useCallback(async () => {
    try {
      const { count } = await api.get<{ count: number }>('/me/notifications/unread-count');
      setUnread(count);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refreshCount();
    const id = setInterval(refreshCount, 45_000);
    return () => clearInterval(id);
  }, [refreshCount]);

  useEffect(() => () => {
    inboxRequestGeneration.current += 1;
  }, []);

  const invalidateInboxLoads = useCallback(() => {
    inboxRequestGeneration.current += 1;
    setLoading(false);
  }, []);

  const loadInbox = useCallback(async () => {
    const requestGeneration = ++inboxRequestGeneration.current;
    const isCurrent = () => inboxRequestIsCurrent(requestGeneration, inboxRequestGeneration.current);
    setLoading(true);
    try {
      const data = await api.get<Inbox>('/me/notifications?limit=12');
      if (!isCurrent()) return;
      setInbox(data);
      setUnread(data.unreadCount);
      setInboxError(false);
    } catch {
      if (isCurrent()) setInboxError(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  const closeInbox = useCallback((reason: InboxCloseReason) => {
    setOpen(false);
    if (!shouldRestoreTriggerFocus(reason)) return;
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeInbox('outside-pointer');
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeInbox('escape');
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [closeInbox, open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      initialFocusRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  function toggle() {
    if (open) {
      closeInbox('toggle');
      return;
    }
    setOpen(true);
    void loadInbox();
  }

  function handleRetry() {
    initialFocusRef.current?.focus({ preventScroll: true });
    void loadInbox();
  }

  async function markAll() {
    invalidateInboxLoads();
    try {
      await api.post('/me/notifications/read-all');
      setInbox((prev) => prev ? { ...prev, items: prev.items.map((i) => ({ ...i, read: true })) } : prev);
      setUnread(0);
    } catch { /* silent */ }
  }

  async function openItem(it: Item) {
    if (!it.read) {
      invalidateInboxLoads();
      setInbox((prev) => prev ? { ...prev, items: prev.items.map((i) => i.id === it.id ? { ...i, read: true } : i) } : prev);
      setUnread((u) => Math.max(0, u - 1));
      try { await api.post(`/me/notifications/${it.id}/read`); } catch { /* silent */ }
    }
  }

  return (
    <div ref={ref} className="relative">
      <Button
        ref={triggerRef}
        id={triggerId}
        type="button"
        variant="outline"
        size="icon"
        onClick={toggle}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
        aria-controls={dialogId}
        aria-haspopup="dialog"
        className="relative"
      >
        <Bell />
        {unread > 0 && (
          <span aria-hidden className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-destructive-foreground ring-2 ring-background">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>

      {open && (
        <div
          id={dialogId}
          className="inbox-pop"
          role="dialog"
          aria-labelledby={titleId}
          style={placement === 'up' ? { bottom: 'calc(100% + 10px)', left: 0 } : { top: 'calc(100% + 10px)', right: 0 }}
        >
          <div className="flex items-center justify-between gap-3 border-b px-3.5 py-3">
            <strong id={titleId} className="text-sm">Notifications</strong>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={markAll}
                disabled={loading || !inbox || unread === 0}
              >
                Mark all read
              </Button>
              <Button
                ref={initialFocusRef}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close notifications"
                onClick={() => closeInbox('close-button')}
              >
                <X />
              </Button>
            </div>
          </div>
          <div className="max-h-[380px] overflow-auto" aria-busy={loading}>
            {loading && !inbox && !inboxError && <div className="p-5 text-xs text-muted-foreground" role="status">Loading...</div>}
            {inboxError && (
              <div className="flex items-start justify-between gap-3 border-b bg-destructive/10 p-3" role="alert">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-foreground">
                    {inbox ? 'Notifications may be stale' : 'Notifications unavailable'}
                  </div>
                  <div className="mt-0.5 text-xs leading-normal text-muted-foreground">
                    {inboxFailureMessage(Boolean(inbox))}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRetry}
                  disabled={loading}
                >
                  {loading ? 'Refreshing...' : 'Retry'}
                </Button>
              </div>
            )}
            {loading && inbox && !inboxError && <div className="border-b px-3.5 py-2 text-xs text-muted-foreground" role="status">Refreshing...</div>}
            {inbox && inbox.items.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</div>
            )}
            {inbox?.items.map((it) => {
              const { Icon, color } = KIND_ICON[it.kind];
              return (
                <Button
                  key={it.id}
                  type="button"
                  variant="ghost"
                  onClick={() => openItem(it)}
                  className="h-auto w-full justify-start gap-3 rounded-none border-b px-3.5 py-3 text-left whitespace-normal last:border-b-0"
                  style={{ background: it.read ? 'transparent' : 'var(--panel-2)' }}
                >
                  <span style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }} className="grid size-7 shrink-0 place-items-center rounded-lg">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{it.title}</span>
                      <span className="shrink-0 text-[10.5px] text-muted-foreground">{ago(it.createdAt)}</span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-normal text-muted-foreground">{it.body}</span>
                  </span>
                  {!it.read && <Badge variant="default" className="size-2 rounded-full p-0" aria-label="Unread" />}
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
