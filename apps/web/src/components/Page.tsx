'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { TrendBadge } from '@/components/ui';

/** Tutarli sayfa basligi: eyebrow + h1 + aciklama + sag-hizali aksiyonlar. TUM admin/panel sayfalari kullanir. */
export function PageHeader({ eyebrow, title, description, actions, className }: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-primary">{eyebrow}</div>}
        <h1 className="mt-1 font-display text-[26px] font-extrabold leading-tight tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
    </div>
  );
}

/** Kanonik KPI karti — TUM sayfalarda ayni gorunum (label + tabular deger + ikon cipi + trend/hint). */
export function KpiCard({ label, value, icon, hint, trend, accent, valueClassName, className }: {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  trend?: number | null;
  accent?: boolean;
  valueClassName?: string;
  className?: string;
}) {
  return (
    <Card className={cn('lift p-5', accent && 'beam glow-primary border-primary/30', className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-medium text-muted-foreground">{label}</span>
        {icon && (
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-primary [&_svg]:size-[18px]">
            {icon}
          </span>
        )}
      </div>
      <div className={cn('mt-2.5 font-display text-[26px] font-extrabold tabular-nums leading-none tracking-tight', accent ? 'text-primary' : 'text-foreground', valueClassName)}>
        {value}
      </div>
      {(trend !== undefined && trend !== null) || hint ? (
        <div className="mt-2 flex items-center gap-2">
          {trend !== undefined && trend !== null && <TrendBadge delta={trend} />}
          {hint && <span className="text-[11.5px] text-muted-foreground/70">{hint}</span>}
        </div>
      ) : null}
    </Card>
  );
}

/** Responsive KPI izgarasi (2/3/4 kolon). */
export function KpiGrid({ cols = 4, children, className }: { cols?: 2 | 3 | 4; children: ReactNode; className?: string }) {
  const colClass = cols === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : cols === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2';
  return <div className={cn('grid gap-4', colClass, className)}>{children}</div>;
}
