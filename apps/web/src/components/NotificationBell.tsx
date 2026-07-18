'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Bell, Info, Users, type LucideIcon } from 'lucide-react';
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

export function NotificationBell({ placement = 'down' }: { placement?: 'down' | 'up' }) {
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      try {
        const data = await api.get<Inbox>('/me/notifications?limit=12');
        setInbox(data);
        setUnread(data.unreadCount);
      } catch { /* silent */ } finally { setLoading(false); }
    }
  }

  async function markAll() {
    try {
      await api.post('/me/notifications/read-all');
      setInbox((prev) => prev ? { ...prev, items: prev.items.map((i) => ({ ...i, read: true })) } : prev);
      setUnread(0);
    } catch { /* silent */ }
  }

  async function openItem(it: Item) {
    if (!it.read) {
      setInbox((prev) => prev ? { ...prev, items: prev.items.map((i) => i.id === it.id ? { ...i, read: true } : i) } : prev);
      setUnread((u) => Math.max(0, u - 1));
      try { await api.post(`/me/notifications/${it.id}/read`); } catch { /* silent */ }
    }
  }

  return (
    <div ref={ref} className="relative">
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={toggle}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
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
          className="inbox-pop"
          role="dialog"
          aria-label="Notifications"
          style={placement === 'up' ? { bottom: 'calc(100% + 10px)', left: 0 } : { top: 'calc(100% + 10px)', right: 0 }}
        >
          <div className="flex items-center justify-between gap-3 border-b px-3.5 py-3">
            <strong className="text-sm">Notifications</strong>
            <Button variant="ghost" size="sm" onClick={markAll}>Mark all read</Button>
          </div>
          <div className="max-h-[380px] overflow-auto">
            {loading && <div className="p-5 text-xs text-muted-foreground">Loading...</div>}
            {!loading && inbox && inbox.items.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</div>
            )}
            {!loading && inbox?.items.map((it) => {
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
