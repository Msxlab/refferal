'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from './ui/command';

interface SearchResp {
  members: { id: string; name: string; email: string; code: string }[];
  sales: { id: string; sellerName: string; sellerCode: string; amountCents: string; currency: string; status: string; customerRef: string | null }[];
}

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

/** Global komut paleti (Cmd/Ctrl+K): sayfa gezinme + uye/satis arama. Admin layout'ta mount.
 *  shadcn Command (cmdk) + Radix Dialog: klavye navigasyonu, focus-trap, scroll-lock dahili. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResp | null>(null);

  // Cmd/Ctrl+K ac/kapat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (!open) { setQ(''); setRes(null); } }, [open]);

  // arama (debounce)
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setRes(null); return; }
    const id = setTimeout(() => { api.get<SearchResp>(`/admin/search?q=${encodeURIComponent(term)}`).then(setRes).catch(() => {}); }, 200);
    return () => clearTimeout(id);
  }, [q, open]);

  const go = useCallback((path: string) => { setOpen(false); router.push(path); }, [router]);

  const navItems = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return NAV.filter((n) => !ql || n.label.toLowerCase().includes(ql));
  }, [q]);

  const hasResults = navItems.length > 0 || (res?.members?.length ?? 0) > 0 || (res?.sales?.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent hideClose className="top-[16%] max-w-[560px] translate-y-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        {/* cmdk client-filtreyi kapatiyoruz: nav'i kendimiz filtreliyoruz, uye/satis sunucudan geliyor */}
        <Command shouldFilter={false} className="bg-popover">
          <CommandInput value={q} onValueChange={setQ} placeholder="Search members, sales, or jump to a page…" />
          <CommandList>
            {!hasResults && <CommandEmpty>No matches.</CommandEmpty>}
            {navItems.length > 0 && (
              <CommandGroup heading="Navigate">
                {navItems.map((n) => (
                  <CommandItem key={n.path} value={`nav:${n.path}`} onSelect={() => go(n.path)}>
                    {n.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {(res?.members?.length ?? 0) > 0 && (
              <CommandGroup heading="Members">
                {res!.members.map((m) => (
                  <CommandItem key={m.id} value={`m:${m.id}`} onSelect={() => go('/admin/members')}>
                    <span className="flex-1">{m.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">member · {m.code}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {(res?.sales?.length ?? 0) > 0 && (
              <CommandGroup heading="Sales">
                {res!.sales.map((s) => (
                  <CommandItem key={s.id} value={`s:${s.id}`} onSelect={() => go('/admin/sales')}>
                    <span className="flex-1">{money(s.amountCents, s.currency)} · {s.sellerName}</span>
                    <span className="ml-auto text-xs text-muted-foreground">sale · {s.status}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
