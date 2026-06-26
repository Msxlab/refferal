'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Settings } from 'lucide-react';
import { Popover } from './Popover';
import { APP_MONOGRAM, APP_NAME } from '@/lib/brand';

/* ----------------------------------------------------- animasyonlu sayac */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function useCountUp(target: number, durationMs = 750): number {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const v = from + (target - from) * easeOut(p);
      setVal(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return val;
}

/** Cent (string/number) → animasyonlu para gosterimi. */
export function MoneyCounter({ cents, currency = 'USD', className }: { cents: string | number; currency?: string; className?: string }) {
  const target = Number(cents) / 100;
  const v = useCountUp(target);
  return <span className={`tnum ${className ?? ''}`}>{new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v)}</span>;
}

export function CountUp({ value, className }: { value: number; className?: string }) {
  const v = useCountUp(value);
  return <span className={`tnum ${className ?? ''}`}>{Math.round(v).toLocaleString('en-US')}</span>;
}

/* ----------------------------------------------------- SVG donut */
export interface Segment {
  label: string;
  value: number;
  color: string;
}

export function Donut({ segments, size = 168, thickness = 20, center }: { segments: Segment[]; size?: number; thickness?: number; center?: ReactNode }) {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  // ekran okuyucu icin grafik ozeti
  const ariaLabel = segments
    .map((s) => `${s.label}: ${total > 0 ? Math.round((Math.max(0, s.value) / total) * 100) : 0}%`)
    .join(', ');
  return (
    <div role="img" aria-label={ariaLabel} style={{ position: 'relative', width: '100%', maxWidth: size, aspectRatio: '1 / 1', margin: '0 auto' }}>
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" aria-hidden="true" style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={thickness} />
        {total > 0 &&
          segments.map((s, i) => {
            const frac = Math.max(0, s.value) / total;
            const len = frac * c;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeLinecap="round"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                style={{ transition: 'stroke-dasharray var(--dur-slow) var(--ease-out), stroke-dashoffset var(--dur-slow) var(--ease-out)' }}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      {center && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{center}</div>
      )}
    </div>
  );
}

/* ----------------------------------------------------- yatay bar */
export function Bars({ data, max, format }: { data: Array<{ label: string; value: number; color?: string }>; max?: number; format?: (v: number) => string }) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="grid" role="list" style={{ gap: 'var(--space-3)' }}>
      {data.map((d, i) => (
        <div key={i} role="listitem" aria-label={`${d.label}: ${format ? format(d.value) : d.value}`}>
          <div className="spread" style={{ marginBottom: 'var(--space-1)' }}>
            <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>{d.label}</span>
            <span className="tnum" style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>{format ? format(d.value) : d.value}</span>
          </div>
          <div style={{ height: 9, borderRadius: 6, background: 'hsl(var(--muted))', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, (d.value / top) * 100)}%`,
                borderRadius: 6,
                background: d.color ?? 'var(--grad-primary)',
                transition: 'width var(--dur-slow) var(--ease-out)',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------- stat kart */
export function StatCard({ label, value, icon, grad, hint, delay }: { label: string; value: ReactNode; icon?: ReactNode; grad?: string; hint?: string; delay?: string }) {
  return (
    <div className={`card hover stat fade-in ${delay ?? ''}`}>
      <div className="spread">
        <span className="k">{label}</span>
        {icon && <span className="icon" style={grad ? { background: grad } : undefined}>{icon}</span>}
      </div>
      <div className="v">{value}</div>
      {hint && <div className="faint" style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>{hint}</div>}
    </div>
  );
}

/* ----------------------------------------------------- modal / onay */
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // a11y: acilista odagi modala tasi; ESC ile kapat; arka plan scroll'unu kilitle
  useEffect(() => {
    ref.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--text-lg)', marginBottom: 'var(--space-3)', letterSpacing: '-.01em' }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ title, message, confirmLabel, danger, onConfirm, onClose, busy }: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>{message}</p>
      <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 'var(--space-5)' }}>
        <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className={`btn ${danger ? 'danger' : ''}`} onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------- marka (altin R monogram) */
export function Brand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const dot = size === 'lg' ? 34 : 26;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <span
        style={{
          width: dot, height: dot, borderRadius: dot * 0.32, background: 'var(--foil)',
          display: 'grid', placeItems: 'center', color: 'var(--on-gold)',
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: dot * 0.56,
          boxShadow: '0 8px 20px -8px hsl(var(--primary) / .7)',
        }}
      >
        {APP_MONOGRAM}
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: size === 'lg' ? 22 : 17, letterSpacing: '-.01em' }}>
        {APP_NAME}
      </span>
    </span>
  );
}

/* ----------------------------------------------------- tema toggle (light/dark) */
export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => {
    const cur = (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') ?? 'dark';
    setTheme(cur);
  }, []);
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('refearn.theme', next);
    } catch {
      /* yok say */
    }
    setTheme(next);
  }
  return (
    <button className="theme-toggle" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
      <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
    </button>
  );
}

/* ----------------------------------------------------- toggle (switch) */
export function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="spread" style={{ padding: 'var(--space-3) 0', borderTop: '1px solid hsl(var(--border))' }}>
      <span style={{ fontSize: 'var(--text-md)' }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          width: 46,
          height: 26,
          borderRadius: 999,
          border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          position: 'relative',
          background: checked ? 'var(--emerald)' : 'hsl(var(--muted))',
          transition: 'background var(--dur-fast) var(--ease-out)',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 3,
            left: checked ? 23 : 3,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'hsl(var(--card))',
            boxShadow: '0 1px 3px hsl(var(--foreground) / .25)',
            transition: 'left var(--dur-fast) var(--ease-out)',
          }}
        />
      </button>
    </div>
  );
}

/* ----------------------------------------------------- yukleme iskeleti */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid" role="status" aria-live="polite" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 64 }} />
      ))}
    </div>
  );
}

/* ----------------------------------------------------- bos durum */
export function Empty({ icon, title, message, action }: { icon?: ReactNode; title?: string; message: string; action?: ReactNode }) {
  return (
    <div
      role="status"
      style={{
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-8) var(--space-4)',
      }}
    >
      {icon && <div aria-hidden="true" style={{ fontSize: 'var(--text-2xl)', opacity: 0.5 }}>{icon}</div>}
      {title && <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--text-md)' }}>{title}</div>}
      <p className="muted" style={{ margin: 0, maxWidth: 320, fontSize: 'var(--text-md)' }}>{message}</p>
      {action && <div style={{ marginTop: 'var(--space-2)' }}>{action}</div>}
    </div>
  );
}

/* ----------------------------------------------------- hata durumu */
export function Error({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-8) var(--space-4)',
        color: 'var(--rose)',
      }}
    >
      <AlertTriangle className="size-7" aria-hidden />

      <p style={{ margin: 0, maxWidth: 320, fontSize: 'var(--text-md)', fontWeight: 600 }}>{message}</p>
      {onRetry && (
        <button className="btn ghost sm" onClick={onRetry} style={{ color: 'var(--text)' }}>Try again</button>
      )}
    </div>
  );
}

/* ----------------------------------------------------- basit toast hook */
export function useToast(): [string | null, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2800);
  };
  return [msg, show];
}

/* ----------------------------------------------------- sayfalama */
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= 0 || pages <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className="row no-print" style={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
      <span className="faint tnum" style={{ fontSize: 'var(--text-sm)' }}>{first}–{last} / {total}</span>
      <button className="btn ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ArrowLeft className="size-4" aria-hidden /></button>
      <span className="tnum" style={{ fontSize: 'var(--text-sm)' }}>{page} / {pages}</span>
      <button className="btn ghost sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ArrowRight className="size-4" aria-hidden /></button>
    </div>
  );
}

/* ----------------------------------------------------- gelismis tablo: kolon tercihleri */
export interface TableColumn { key: string; label: string; locked?: boolean }
export type Density = 'comfortable' | 'compact';

interface TablePrefs {
  isVisible: (key: string) => boolean;
  toggle: (key: string) => void;
  density: Density;
  setDensity: (d: Density) => void;
  reset: () => void;
  columns: TableColumn[];
  hiddenCount: number;
}

/** Kolon goster/gizle + yogunluk; kullanici basina localStorage'da kalici (tableId anahtari). */
export function useTablePrefs(tableId: string, columns: TableColumn[]): TablePrefs {
  const storeKey = `refearn.table.${tableId}`;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [density, setDensityState] = useState<Density>('comfortable');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        const p = JSON.parse(raw) as { hidden?: string[]; density?: Density };
        setHidden(new Set(p.hidden ?? []));
        if (p.density) setDensityState(p.density);
      }
    } catch { /* yok say */ }
  }, [storeKey]);

  const persist = (h: Set<string>, d: Density) => {
    try { localStorage.setItem(storeKey, JSON.stringify({ hidden: [...h], density: d })); } catch { /* yok say */ }
  };
  const toggle = (key: string) => {
    setHidden((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); persist(n, density); return n; });
  };
  const setDensity = (d: Density) => { setDensityState(d); persist(hidden, d); };
  const reset = () => { setHidden(new Set()); setDensityState('comfortable'); persist(new Set(), 'comfortable'); };

  return {
    isVisible: (key) => !hidden.has(key),
    toggle, density, setDensity, reset, columns,
    hiddenCount: [...hidden].filter((k) => columns.some((c) => c.key === k && !c.locked)).length,
  };
}

/** Kolon/yogunluk menusu (Popover). Kilitli kolonlar her zaman acik. */
export function ColumnsMenu({ prefs }: { prefs: TablePrefs }) {
  return (
    <Popover label={<><Settings className="size-4" aria-hidden /> Columns</>} badge={prefs.hiddenCount} width={240}>
      <div className="grid" style={{ gap: 'var(--space-1)' }}>
        {prefs.columns.map((c) => {
          const on = c.locked || prefs.isVisible(c.key);
          const toggle = () => { if (!c.locked) prefs.toggle(c.key); };
          return (
            <div
              key={c.key}
              role="checkbox"
              aria-checked={on}
              aria-disabled={c.locked || undefined}
              tabIndex={c.locked ? -1 : 0}
              onClick={toggle}
              onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } }}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderRadius: 8, cursor: c.locked ? 'default' : 'pointer', fontSize: 'var(--text-md)', opacity: c.locked ? 0.6 : 1 }}>
              <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 4, display: 'grid', placeItems: 'center', fontSize: 'var(--text-xs)', fontWeight: 900, background: on ? 'var(--gold-500)' : 'transparent', border: on ? 'none' : '1.5px solid var(--border-strong)', color: 'var(--on-gold)' }}>{on ? <Check className="size-3" aria-hidden /> : ''}</span>
              {c.label}{c.locked && <span className="faint" style={{ fontSize: 'var(--text-xs)' }}>(fixed)</span>}
            </div>
          );
        })}
        <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid hsl(var(--border))', marginTop: 'var(--space-1)', paddingTop: 'var(--space-2)' }}>
          <div className="seg-tabs" style={{ padding: 3 }}>
            <button className={`seg-tab ${prefs.density === 'comfortable' ? 'on' : ''}`} onClick={() => prefs.setDensity('comfortable')}>Comfortable</button>
            <button className={`seg-tab ${prefs.density === 'compact' ? 'on' : ''}`} onClick={() => prefs.setDensity('compact')}>Compact</button>
          </div>
          <button className="btn ghost sm" onClick={prefs.reset}>Reset</button>
        </div>
      </div>
    </Popover>
  );
}

/* ----------------------------------------------------- siralanabilir th */
export type SortDir = 'asc' | 'desc';
export function SortableTh({ label, field, sort, dir, onSort, align }: {
  label: string;
  field: string;
  sort: string;
  dir: SortDir;
  onSort: (field: string, dir: SortDir) => void;
  align?: 'left' | 'right';
}) {
  const active = sort === field;
  return (
    <th
      className="sortable"
      style={align === 'right' ? { textAlign: 'right' } : undefined}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      tabIndex={0}
      onClick={() => onSort(field, active && dir === 'desc' ? 'asc' : 'desc')}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onSort(field, active && dir === 'desc' ? 'asc' : 'desc'); } }}
    >
      {label}
      {active && <span className="sort-ind" aria-hidden="true">{dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}
