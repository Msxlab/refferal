'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading } from '@/components/ui';
import { money, dateShort } from '@/lib/format';

type ActivityType = 'team_join' | 'sale_approved' | 'commission_credited' | 'check_mailed' | 'check_paid';
interface ActivityItem { id: string; type: ActivityType; ts: string; title: string; amountCents?: string; subject?: string }
interface FeedResp { items: ActivityItem[]; nextCursor: string | null }

const ICON: Record<ActivityType, string> = {
  team_join: '⬡',
  sale_approved: '◇',
  commission_credited: '◆',
  check_mailed: '✉',
  check_paid: '✓',
};

/** Gunun anahtari (yerel) — gruplama basligi icin. */
function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function ActivityFeed() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');

  const loadFirst = useCallback(async () => {
    try {
      const res = await api.get<FeedResp>('/app/activity');
      setItems(res.items);
      setCursor(res.nextCursor);
    } catch (e) { setError(String((e as ApiError).message)); } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadFirst(); }, [loadFirst]);

  async function loadMore() {
    if (!cursor) return;
    setMore(true);
    try {
      const res = await api.get<FeedResp>(`/app/activity?cursor=${encodeURIComponent(cursor)}`);
      setItems((prev) => [...prev, ...res.items]);
      setCursor(res.nextCursor);
    } catch (e) { setError(String((e as ApiError).message)); } finally { setMore(false); }
  }

  if (loading) return <Loading rows={3} />;

  // gune gore grupla (sirali — feed zaten desc)
  const groups: Array<{ day: string; rows: ActivityItem[] }> = [];
  for (const it of items) {
    const day = dayKey(it.ts);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(it);
    else groups.push({ day, rows: [it] });
  }

  return (
    <div className="card fade-in delay-2" style={{ marginTop: 16 }}>
      <div className="spread" style={{ marginBottom: 12 }}>
        <strong>Activity</strong>
        <span className="faint" style={{ fontSize: 12 }}>Your recent team & earnings events</span>
      </div>
      {error && <div className="error">{error}</div>}
      {items.length === 0 ? (
        <div className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
          No activity yet.<br />
          <span className="faint" style={{ fontSize: 12.5 }}>Invite someone to get started — joins, approvals and payouts show up here.</span>
        </div>
      ) : (
        <div className="grid" style={{ gap: 14 }}>
          {groups.map((g) => (
            <div key={g.day}>
              <div className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{dateShort(g.day)}</div>
              <div className="grid" style={{ gap: 6 }}>
                {g.rows.map((it) => (
                  <div key={it.id} className="row spread" style={{ gap: 10 }}>
                    <span className="row" style={{ gap: 10 }}>
                      <span style={{ width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center', background: 'var(--panel-2)', fontSize: 12 }}>{ICON[it.type]}</span>
                      <span style={{ fontSize: 13.5 }}>{it.title}</span>
                    </span>
                    {it.amountCents && <span className="tnum" style={{ fontWeight: 650, color: 'var(--gold-500)' }}>{money(it.amountCents)}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {cursor && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 4 }}>
              <button className="btn ghost sm" onClick={loadMore} disabled={more}>{more ? 'Loading…' : 'Load more'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
