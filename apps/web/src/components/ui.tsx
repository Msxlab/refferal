'use client';

import Image from 'next/image';
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { APP_NAME, normalizeRuntimeBrand, type RuntimeBrand } from '@/lib/brand';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useOverlayFocus } from '@/components/useOverlayFocus';
import { cn } from '@/lib/utils';

/* ----------------------------------------------------- animated counter */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function useCountUp(target: number, durationMs = 750): number {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      fromRef.current = target;
      setVal(target);
      return;
    }
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

/** Animated money display for cent values supplied as strings or numbers. */
export function MoneyCounter({ cents, currency = 'USD', className }: { cents: string | number; currency?: string; className?: string }) {
  const target = Number(cents) / 100;
  const v = useCountUp(target);
  return <span className={cn('tnum', className)}>{new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v)}</span>;
}

export function CountUp({ value, className }: { value: number; className?: string }) {
  const v = useCountUp(value);
  return <span className={cn('tnum', className)}>{Math.round(v).toLocaleString('en-US')}</span>;
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
  // Chart summary for screen readers.
  const ariaLabel = segments
    .map((s) => `${s.label}: ${total > 0 ? Math.round((Math.max(0, s.value) / total) * 100) : 0}%`)
    .join(', ');
  return (
    <div role="img" aria-label={ariaLabel} style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} />
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

/* ----------------------------------------------------- horizontal bars */
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
          <div style={{ height: 9, borderRadius: 6, background: 'var(--panel-3)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, (d.value / top) * 100)}%`,
                borderRadius: 6,
                background: d.color ?? 'var(--primary)',
                transition: 'width .7s cubic-bezier(.2,.9,.3,1)',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------- stat card */
export function StatCard({ label, value, icon, grad, hint, delay }: { label: string; value: ReactNode; icon?: string; grad?: string; hint?: string; delay?: string }) {
  return (
    <Card className={cn('fade-in transition-shadow hover:shadow-lg', delay)}>
      <CardHeader className="grid-cols-[1fr_auto] items-center">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
        {icon && (
          <span
            className="grid size-9 place-items-center rounded-lg border bg-muted text-base"
            style={grad ? { background: grad } : undefined}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className="font-[var(--font-display)] text-2xl font-bold">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

/* ----------------------------------------------------- modal / confirmation */
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onKeyDown = useOverlayFocus(ref, onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="modal-title">{title}</h2>
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
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={danger ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------- brand mark */
export function Brand({
  size = 'md',
  brand,
  className,
}: {
  size?: 'md' | 'lg';
  brand?: Partial<RuntimeBrand> | null;
  className?: string;
}) {
  const runtimeBrand = brand ? normalizeRuntimeBrand(brand) : null;
  const name = runtimeBrand?.name ?? APP_NAME;
  const brandStyle = runtimeBrand ? ({ '--brand-accent': runtimeBrand.primaryColor } as CSSProperties) : undefined;
  return (
    <span className={cn('brand-lockup', size === 'lg' && 'brand-lockup-lg', className)} style={brandStyle}>
      <span className="brand-mark">
        <Image
          src="/brand/refearn-network-mark-v1.png"
          alt=""
          aria-hidden="true"
          width={size === 'lg' ? 34 : 26}
          height={size === 'lg' ? 34 : 26}
          className="brand-mark-image"
        />
      </span>
      <span className="brand-wordmark" translate="no">{name}</span>
    </span>
  );
}

/* ----------------------------------------------------- theme toggle (light/dark) */
export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => {
    const cur = (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') ?? 'dark';
    setTheme(cur);
  }, []);
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.colorScheme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#f5f7fb' : '#0b1324');
    try {
      localStorage.setItem('refearn.theme', next);
    } catch {
      /* ignore storage failures */
    }
    setTheme(next);
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {theme === 'dark' ? <Moon /> : <Sun />}
    </Button>
  );
}

/* ----------------------------------------------------- toggle (switch) */
export function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-3 py-3">
      <Separator />
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{label}</span>
        <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
      </div>
    </div>
  );
}

/* ----------------------------------------------------- loading skeleton */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid" role="status" aria-live="polite" aria-atomic="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

/* ----------------------------------------------------- simple toast hook */
export function useToast(): [string | null, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2800);
  };
  return [msg, show];
}
