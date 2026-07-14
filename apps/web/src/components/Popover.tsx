'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** Anchored popover panel for compact filters and contextual actions. */
export function Popover({
  label, badge, children, width = 320, align = 'left', variant = 'ghost',
}: {
  label: ReactNode;
  badge?: number;
  children: ReactNode | ((close: () => void) => ReactNode);
  width?: number;
  align?: 'left' | 'right';
  variant?: 'ghost' | 'solid';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <Button
        type="button"
        variant={variant === 'ghost' ? 'outline' : 'default'}
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {label}
        {badge !== undefined && badge > 0 && (
          <Badge variant="secondary">{badge}</Badge>
        )}
      </Button>
      {open && (
        <div className="popover-panel" role="dialog" style={{ width: `min(${width}px, 92vw)`, [align]: 0 } as React.CSSProperties}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}
