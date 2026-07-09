'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { money } from '@/lib/format';

interface SearchResult {
  users: Array<{ userId: string; email: string; fullName: string; tenants: Array<{ tenantId: string; tenantName: string }> }>;
  members: Array<{ membershipId: string; referralCode: string; fullName: string; email: string; tenantId: string; tenantName: string; ctaHref: string }>;
  sales: Array<{ saleId: string; amountCents: string; externalRef: string | null; status: string; tenantId: string; tenantName: string; ctaHref: string }>;
  payouts: Array<{ payoutId: string; totalCents: string; ref: string | null; checkNumber: number | null; status: string; tenantId: string; tenantName: string; ctaHref: string }>;
}

const EMPTY: SearchResult = { users: [], members: [], sales: [], payouts: [] };

function total(r: SearchResult): number {
  return r.users.length + r.members.length + r.sales.length + r.payouts.length;
}

/** Item 5: header arama kutusu — 250ms debounce, min 2 karakter, gruplanmis acilir sonuc. */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [result, setResult] = useState<SearchResult>(EMPTY);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResult(EMPTY);
      return;
    }
    const h = setTimeout(() => {
      api.get<SearchResult>(`/platform/search?q=${encodeURIComponent(term)}`).then(setResult).catch(() => setResult(EMPTY));
    }, 250);
    return () => clearTimeout(h);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  const showDropdown = open && q.trim().length >= 2;
  const count = total(result);

  function go(href: string) {
    setOpen(false);
    setQ('');
    router.push(href);
  }

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', maxWidth: 340 }}>
      <input
        aria-label="Global search"
        placeholder="Search users, members, sales, payouts…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        style={{ width: '100%' }}
      />
      {showDropdown && (
        <div className="popover-panel" role="dialog" style={{ width: 'min(420px, 92vw)', left: 0, maxHeight: 420, overflowY: 'auto' }}>
          {count === 0 ? (
            <div className="muted" style={{ fontSize: 13, padding: '4px 2px' }}>No matches.</div>
          ) : (
            <div className="grid" style={{ gap: 14 }}>
              {result.users.length > 0 && (
                <SearchGroup label="Users">
                  {result.users.map((u) => {
                    const firstTenant = u.tenants[0];
                    const href = firstTenant ? `/platform/companies/${firstTenant.tenantId}?tab=users` : undefined;
                    return (
                      <SearchRow key={u.userId} href={href} onClick={href ? () => go(href) : undefined}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{u.fullName}</div>
                        <div className="faint" style={{ fontSize: 11.5 }}>
                          {u.email}{u.tenants.length > 0 ? ` · ${u.tenants.map((t) => t.tenantName).join(', ')}` : ' · no company'}
                        </div>
                      </SearchRow>
                    );
                  })}
                </SearchGroup>
              )}
              {result.members.length > 0 && (
                <SearchGroup label="Members">
                  {result.members.map((m) => (
                    <SearchRow key={m.membershipId} href={m.ctaHref} onClick={() => go(m.ctaHref)}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{m.fullName} <span className="faint tnum" style={{ fontWeight: 400 }}>{m.referralCode}</span></div>
                      <div className="faint" style={{ fontSize: 11.5 }}>{m.email} · {m.tenantName}</div>
                    </SearchRow>
                  ))}
                </SearchGroup>
              )}
              {result.sales.length > 0 && (
                <SearchGroup label="Sales">
                  {result.sales.map((s) => (
                    <SearchRow key={s.saleId} href={s.ctaHref} onClick={() => go(s.ctaHref)}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{money(s.amountCents)} <span className="faint" style={{ fontWeight: 400 }}>{s.status}</span></div>
                      <div className="faint" style={{ fontSize: 11.5 }}>{s.externalRef ?? '—'} · {s.tenantName}</div>
                    </SearchRow>
                  ))}
                </SearchGroup>
              )}
              {result.payouts.length > 0 && (
                <SearchGroup label="Payouts">
                  {result.payouts.map((p) => (
                    <SearchRow key={p.payoutId} href={p.ctaHref} onClick={() => go(p.ctaHref)}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{money(p.totalCents)} <span className="faint" style={{ fontWeight: 400 }}>{p.status}</span></div>
                      <div className="faint" style={{ fontSize: 11.5 }}>{p.ref ?? (p.checkNumber ? `#${p.checkNumber}` : '—')} · {p.tenantName}</div>
                    </SearchRow>
                  ))}
                </SearchGroup>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="faint" style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div className="grid" style={{ gap: 2 }}>{children}</div>
    </div>
  );
}

function SearchRow({ href, onClick, children }: { href?: string; onClick?: () => void; children: React.ReactNode }) {
  if (!href || !onClick) {
    return <div style={{ padding: '6px 8px', opacity: 0.6 }}>{children}</div>;
  }
  return (
    <Link
      href={href}
      onClick={(e) => { e.preventDefault(); onClick(); }}
      className="hover"
      style={{ display: 'block', padding: '6px 8px', borderRadius: 8, textDecoration: 'none', color: 'inherit' }}
    >
      {children}
    </Link>
  );
}
