'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search, LayoutGrid, TrendingUp, Users, Share2, Flag, Wallet, ListChecks, Settings,
  User, Receipt, CornerDownLeft, ArrowUp, ArrowDown, Clock,
} from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';

interface SearchResp {
  members: { id: string; name: string; email: string; code: string }[];
  sales: { id: string; sellerName: string; sellerCode: string; amountCents: string; currency: string; status: string; customerRef: string | null }[];
}
type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
interface Cmd { key: string; label: string; hint?: string; icon: Icon; path: string; run: () => void }

const NAV: { label: string; path: string; icon: Icon }[] = [
  { label: 'Overview', path: '/admin', icon: LayoutGrid },
  { label: 'Sales', path: '/admin/sales', icon: TrendingUp },
  { label: 'Members', path: '/admin/members', icon: Users },
  { label: 'Network', path: '/admin/tree', icon: Share2 },
  { label: 'Campaigns', path: '/admin/campaigns', icon: Flag },
  { label: 'Payouts', path: '/admin/payouts', icon: Wallet },
  { label: 'Audit', path: '/admin/audit', icon: ListChecks },
  { label: 'Settings', path: '/admin/settings', icon: Settings },
];
const RECENT_KEY = 'refearn.cmdk.recent';

/** Global komut paleti (Cmd/Ctrl+K): premium animasyonlu — gezinme + uye/satis canli arama. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResp | null>(null);
  const [sel, setSel] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ(''); setRes(null); setSel(0);
      try { setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')); } catch { /* yok */ }
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setRes(null); return; }
    const id = setTimeout(() => { api.get<SearchResp>(`/admin/search?q=${encodeURIComponent(term)}`).then(setRes).catch(() => {}); }, 200);
    return () => clearTimeout(id);
  }, [q, open]);

  const go = useCallback((path: string) => {
    setOpen(false);
    try {
      const next = [path, ...recent.filter((p) => p !== path)].slice(0, 4);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch { /* yok */ }
    router.push(path);
  }, [router, recent]);

  // gruplu + duz: keyboard icin flat items, gorsel icin gruplar
  const { items, groups } = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const navAll = NAV.map((n) => ({ key: 'nav:' + n.path, label: n.label, hint: undefined as string | undefined, icon: n.icon, path: n.path, run: () => go(n.path) }));
    const nav = navAll.filter((n) => !ql || n.label.toLowerCase().includes(ql));
    const members: Cmd[] = (res?.members ?? []).map((m) => ({ key: 'm:' + m.id, label: m.name, hint: m.code, icon: User, path: '/admin/members', run: () => go('/admin/members') }));
    const sales: Cmd[] = (res?.sales ?? []).map((s) => ({ key: 's:' + s.id, label: `${money(s.amountCents, s.currency)} · ${s.sellerName}`, hint: s.status, icon: Receipt, path: '/admin/sales', run: () => go('/admin/sales') }));

    const g: { label: string; items: Cmd[] }[] = [];
    if (!ql) {
      const rec = recent.map((p) => navAll.find((n) => n.path === p)).filter(Boolean) as Cmd[];
      if (rec.length) g.push({ label: 'Recent', items: rec });
    }
    if (nav.length) g.push({ label: 'Navigation', items: nav });
    if (members.length) g.push({ label: 'Members', items: members });
    if (sales.length) g.push({ label: 'Sales', items: sales });

    // flat list with global indices (recent dahil ama gezinme grubuyla cakismasin diye recent'i ayri tut)
    const flat: Cmd[] = g.flatMap((grp) => grp.items);
    return { items: flat, groups: g };
  }, [q, res, recent, go]);

  useEffect(() => { setSel(0); }, [items.length]);
  const searching = q.trim().length >= 2 && res === null;

  let runningIndex = -1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="no-print fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
          onClick={() => setOpen(false)}
          style={{ background: 'hsl(var(--background) / 0.6)', backdropFilter: 'blur(6px)' }}
        >
          <motion.div
            role="dialog" aria-modal="true" aria-label="Command palette"
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="w-full max-w-[600px] overflow-hidden rounded-2xl border border-border bg-popover shadow-[0_24px_70px_-20px_rgba(0,0,0,0.6)]"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === 'Enter') { e.preventDefault(); items[sel]?.run(); }
            }}
          >
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
              <input
                ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search members, sales, or jump to a page…"
                role="combobox" aria-label="Search members, sales, or pages" aria-expanded aria-controls="cmdk-results"
                className="w-full border-0 bg-transparent py-4 text-[15px] text-foreground outline-none placeholder:text-muted-foreground/70"
                style={{ boxShadow: 'none' }}
              />
              {searching && <div className="size-4 shrink-0 animate-spin rounded-full border-2 border-muted border-t-primary" aria-hidden />}
            </div>

            <div id="cmdk-results" role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto p-2">
              {items.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-muted-foreground">{searching ? 'Searching…' : 'No matches.'}</div>
              ) : (
                groups.map((grp) => (
                  <div key={grp.label} className="mb-1">
                    <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">
                      {grp.label === 'Recent' && <Clock className="size-3" aria-hidden />}{grp.label}
                    </div>
                    {grp.items.map((it) => {
                      runningIndex += 1;
                      const i = runningIndex;
                      const active = i === sel;
                      const Ico = it.icon;
                      return (
                        <button
                          key={it.key} id={`cmdk-opt-${it.key}`} role="option" aria-selected={active}
                          onMouseMove={() => setSel(i)} onClick={it.run}
                          className="relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left"
                        >
                          {active && (
                            <motion.span layoutId="cmdk-cursor" className="absolute inset-0 rounded-lg bg-accent"
                              transition={{ type: 'spring', stiffness: 600, damping: 38 }} />
                          )}
                          <span className={`relative z-10 grid size-7 shrink-0 place-items-center rounded-md ${active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                            <Ico className="size-4" aria-hidden />
                          </span>
                          <span className="relative z-10 flex-1 truncate text-[13.5px] text-foreground">{it.label}</span>
                          {it.hint && <span className="relative z-10 truncate text-[11px] text-muted-foreground/70">{it.hint}</span>}
                          {active && <CornerDownLeft className="relative z-10 size-3.5 text-muted-foreground" aria-hidden />}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-4 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground/70">
              <span className="inline-flex items-center gap-1"><ArrowUp className="size-3" aria-hidden /><ArrowDown className="size-3" aria-hidden /> navigate</span>
              <span className="inline-flex items-center gap-1"><CornerDownLeft className="size-3" aria-hidden /> open</span>
              <span>esc close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
