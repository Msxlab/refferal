'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Info, TrendingDown, TrendingUp, Users, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';

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

const KIND_ICON: Record<Item['kind'], { ic: LucideIcon; color: string }> = {
  positive: { ic: TrendingUp, color: 'var(--emerald)' },
  negative: { ic: TrendingDown, color: 'var(--rose)' },
  team: { ic: Users, color: 'var(--sky)' },
  system: { ic: Info, color: 'hsl(var(--muted-foreground))' },
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
    } catch { /* sessiz */ }
  }, []);

  // ilk yukleme + periyodik okunmamis sayisi (hafif uc)
  useEffect(() => {
    refreshCount();
    const id = setInterval(refreshCount, 45_000);
    return () => clearInterval(id);
  }, [refreshCount]);

  // disari tiklayinca kapat
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
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="theme-toggle"
        onClick={toggle}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
        style={{ position: 'relative' }}
      >
        <Bell className="size-[18px]" aria-hidden />

        {unread > 0 && (
          <span aria-hidden style={{
            position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 999, background: 'var(--rose)', color: 'var(--on-gold)', fontSize: 'var(--text-xs)', fontWeight: 800,
            display: 'grid', placeItems: 'center', lineHeight: 1, boxShadow: '0 0 0 2px var(--panel)',
          }}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div
          className="inbox-pop"
          role="dialog"
          aria-label="Notifications"
          style={placement === 'up' ? { bottom: 'calc(100% + 10px)', left: 0 } : { top: 'calc(100% + 10px)', right: 0 }}
        >
          <div className="spread" style={{ padding: '12px 14px', borderBottom: '1px solid hsl(var(--border))' }}>
            <strong style={{ fontSize: 'var(--text-md)' }}>Notifications</strong>
            <button className="link-btn" onClick={markAll}
              style={{ fontSize: 'var(--text-xs)', color: 'var(--gold-500)', background: 'none', border: 'none', cursor: 'pointer' }}>
              Mark all read
            </button>
          </div>
          <div style={{ maxHeight: 380, overflow: 'auto' }}>
            {loading && <div className="faint" style={{ padding: 18, fontSize: 'var(--text-sm)' }}>Loading…</div>}
            {!loading && inbox && inbox.items.length === 0 && (
              <div className="faint" style={{ padding: 24, textAlign: 'center', fontSize: 'var(--text-sm)' }}>
                You&apos;re all caught up.
              </div>
            )}
            {!loading && inbox?.items.map((it) => {
              const k = KIND_ICON[it.kind];
              const KindIcon = k.ic;
              return (
                <button key={it.id} onClick={() => openItem(it)} className="inbox-row"
                  style={{ background: it.read ? 'transparent' : 'var(--panel-2)' }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center',
                    background: `color-mix(in srgb, ${k.color} 16%, transparent)`, color: k.color, fontWeight: 800, fontSize: 'var(--text-md)',
                  }}><KindIcon className="size-4" aria-hidden /></span>
                  <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                    <span className="spread" style={{ gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text)' }}>{it.title}</span>
                      <span className="faint" style={{ fontSize: 'var(--text-xs)', flexShrink: 0 }}>{ago(it.createdAt)}</span>
                    </span>
                    <span className="faint" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.45, display: 'block', marginTop: 2 }}>{it.body}</span>
                  </span>
                  {!it.read && <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--gold-500)', flexShrink: 0, alignSelf: 'center' }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
