'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';

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
    <div role="img" aria-label={ariaLabel} style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={thickness} />
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
                style={{ transition: 'stroke-dasharray .7s ease, stroke-dashoffset .7s ease' }}
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
          <div className="spread" style={{ marginBottom: 5 }}>
            <span className="muted" style={{ fontSize: 12 }}>{d.label}</span>
            <span className="tnum" style={{ fontSize: 13, fontWeight: 650 }}>{format ? format(d.value) : d.value}</span>
          </div>
          <div style={{ height: 9, borderRadius: 6, background: 'rgba(255,255,255,.05)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, (d.value / top) * 100)}%`,
                borderRadius: 6,
                background: d.color ?? 'var(--grad-primary)',
                transition: 'width .7s cubic-bezier(.2,.9,.3,1)',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------- stat kart */
export function StatCard({ label, value, icon, grad, hint, delay }: { label: string; value: ReactNode; icon?: string; grad?: string; hint?: string; delay?: string }) {
  return (
    <div className={`card hover stat fade-in ${delay ?? ''}`}>
      <div className="spread">
        <span className="k">{label}</span>
        {icon && <span className="icon" style={grad ? { background: grad } : undefined}>{icon}</span>}
      </div>
      <div className="v">{value}</div>
      {hint && <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

/* ----------------------------------------------------- modal / onay */
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // a11y: acilista odagi modala tasi; ESC ile kapat
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
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
        <div style={{ fontWeight: 720, fontSize: 'var(--text-lg)', marginBottom: 'var(--space-3)' }}>{title}</div>
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
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
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
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span
        style={{
          width: dot, height: dot, borderRadius: dot * 0.32, background: 'var(--foil)',
          display: 'grid', placeItems: 'center', color: 'var(--on-gold)',
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: dot * 0.56,
          boxShadow: '0 8px 20px -8px rgba(212,175,55,.7)',
        }}
      >
        R
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: size === 'lg' ? 22 : 17, letterSpacing: '-.01em' }}>
        Refearn
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
      {theme === 'dark' ? '☾' : '☀'}
    </button>
  );
}

/* ----------------------------------------------------- toggle (switch) */
export function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="spread" style={{ padding: 'var(--space-3) 0', borderTop: '1px solid var(--border)' }}>
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
          background: checked ? 'var(--grad-emerald)' : 'rgba(255,255,255,.12)',
          transition: 'background var(--dur-fast) ease',
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
            background: '#fff',
            transition: 'left var(--dur-fast) ease',
          }}
        />
      </button>
    </div>
  );
}

/* ----------------------------------------------------- yukleme iskeleti */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid" role="status" aria-label="Yukleniyor">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 64 }} />
      ))}
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
