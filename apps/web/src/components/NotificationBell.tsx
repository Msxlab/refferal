'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Popover as PopoverRoot, PopoverTrigger, PopoverContent } from './ui/popover';

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

export function NotificationBell({ placement = 'down' }: { placement?: 'down' | 'up' }) {
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  const refreshCount = useCallback(async () => {
    try {
      const { count } = await api.get<{ count: number }>('/me/notifications/unread-count');
      setUnread(count);
    } catch { /* sessiz */ }
  }, []);

  // ilk yukleme + periyodik okunmamis sayisi (hafif uc)
  useEffect(() => {
    refreshCount();
    const id = setInterval(refreshCount, 45_000);
    return () => clearInterval(id);
  }, [refreshCount]);

  // Radix Popover ac/kapa: acilista kutuyu cek (dis-tiklama/ESC/konumlandirma dahili)
  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setLoading(true);
      try {
        const data = await api.get<Inbox>('/me/notifications?limit=12');
        setInbox(data);
        setUnread(data.unreadCount);
      } catch { /* sessiz */ } finally { setLoading(false); }
    }
  }

  async function markAll() {
    try {
      await api.post('/me/notifications/read-all');
      setInbox((prev) => prev ? { ...prev, items: prev.items.map((i) => ({ ...i, read: true })) } : prev);
      setUnread(0);
    } catch { /* sessiz */ }
  }

  async function openItem(it: Item) {
    if (!it.read) {
      setInbox((prev) => prev ? { ...prev, items: prev.items.map((i) => i.id === it.id ? { ...i, read: true } : i) } : prev);
      setUnread((u) => Math.max(0, u - 1));
      try { await api.post(`/me/notifications/${it.id}/read`); } catch { /* sessiz */ }
    }
  }

  return (
    <PopoverRoot open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
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
        className="w-[360px] max-w-[92vw] p-0"
        aria-label="Notifications"
      >
        <div className="spread" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <strong style={{ fontSize: 13 }}>Notifications</strong>
          <button onClick={markAll}
            style={{ fontSize: 11, color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer' }}>
            Mark all read
          </button>
        </div>
        <div style={{ maxHeight: 380, overflow: 'auto' }}>
          {loading && <div className="faint" style={{ padding: 18, fontSize: 12 }}>Loading…</div>}
          {!loading && inbox && inbox.items.length === 0 && (
            <div className="faint" style={{ padding: 24, textAlign: 'center', fontSize: 12.5 }}>
              You&apos;re all caught up.
            </div>
          )}
          {!loading && inbox?.items.map((it) => {
            const k = KIND_ICON[it.kind];
            return (
              <button key={it.id} onClick={() => openItem(it)} className="inbox-row"
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
