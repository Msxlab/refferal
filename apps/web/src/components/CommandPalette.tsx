'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { money } from '@/lib/format';

interface SearchResp {
  members: { id: string; name: string; email: string; code: string }[];
  sales: { id: string; sellerName: string; sellerCode: string; amountCents: string; currency: string; status: string; customerRef: string | null }[];
}
interface Cmd { key: string; label: string; hint?: string; run: () => void }

const NAV: { label: string; path: string }[] = [
  { label: 'Go to Overview', path: '/admin' },
  { label: 'Go to Sales', path: '/admin/sales' },
  { label: 'Go to Members', path: '/admin/members' },
  { label: 'Go to Network', path: '/admin/tree' },
  { label: 'Go to Campaigns', path: '/admin/campaigns' },
  { label: 'Go to Payouts', path: '/admin/payouts' },
  { label: 'Go to Audit', path: '/admin/audit' },
  { label: 'Go to Settings', path: '/admin/settings' },
];

/** Global komut paleti (Cmd/Ctrl+K): sayfa gezinme + uye/satis arama. Admin layout'ta mount. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResp | null>(null);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+K ac/kapat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (open) { setQ(''); setRes(null); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  // arama (debounce)
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setRes(null); return; }
    const id = setTimeout(() => { api.get<SearchResp>(`/admin/search?q=${encodeURIComponent(term)}`).then(setRes).catch(() => {}); }, 200);
    return () => clearTimeout(id);
  }, [q, open]);

  const go = useCallback((path: string) => { setOpen(false); router.push(path); }, [router]);

  // duz komut listesi (gezinme + sonuclar) — klavye navigasyonu icin
  const items: Cmd[] = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const nav = NAV.filter((n) => !ql || n.label.toLowerCase().includes(ql)).map((n) => ({ key: 'nav:' + n.path, label: n.label, run: () => go(n.path) }));
    const members = (res?.members ?? []).map((m) => ({ key: 'm:' + m.id, label: m.name, hint: `member · ${m.code}`, run: () => go('/admin/members') }));
    const sales = (res?.sales ?? []).map((s) => ({ key: 's:' + s.id, label: `${money(s.amountCents, s.currency)} · ${s.sellerName}`, hint: `sale · ${s.status}${s.customerRef ? ' · ' + s.customerRef : ''}`, run: () => go('/admin/sales') }));
    return [...nav, ...members, ...sales];
  }, [q, res, go]);

  useEffect(() => { setSel(0); }, [items.length]);

  if (!open) return null;

  return (
    <div className="modal-backdrop no-print" style={{ alignItems: 'flex-start', paddingTop: '12vh' }} onClick={() => setOpen(false)}>
      <div className="card" style={{ width: 'min(560px, 92vw)', padding: 0, overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          if (e.key === 'Enter') { e.preventDefault(); items[sel]?.run(); }
        }}>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members, sales, or jump to a page…"
          style={{ border: 'none', borderRadius: 0, borderBottom: '1px solid hsl(var(--border))', padding: '16px 18px', fontSize: 15 }} />
        <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
          {items.length === 0 ? (
            <div className="muted" style={{ padding: 18, fontSize: 13 }}>No matches.</div>
          ) : items.map((it, i) => (
            <button key={it.key} onMouseEnter={() => setSel(i)} onClick={it.run} className="row"
              style={{ width: '100%', textAlign: 'left', gap: 10, padding: '11px 18px', border: 'none', borderBottom: '1px solid hsl(var(--border))', cursor: 'pointer', background: i === sel ? 'var(--panel-2)' : 'transparent' }}>
              <span style={{ flex: 1, fontSize: 13.5 }}>{it.label}</span>
              {it.hint && <span className="faint" style={{ fontSize: 11 }}>{it.hint}</span>}
            </button>
          ))}
        </div>
        <div className="faint" style={{ padding: '8px 18px', fontSize: 11, display: 'flex', gap: 14 }}>
          <span>↑↓ navigate</span><span>⏎ open</span><span>esc close</span>
        </div>
      </div>
    </div>
  );
}
