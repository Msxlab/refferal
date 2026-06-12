'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';

/** Tetikleyici butona tutturulmus açılır panel (temiz araç çubuğu: filtre/aksiyon talep üzerine). */
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
      <button className={`btn ${variant === 'ghost' ? 'ghost' : ''} sm`} onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ position: 'relative' }}>
        {label}
        {badge !== undefined && badge > 0 && (
          <span style={{ marginLeft: 6, minWidth: 17, height: 17, padding: '0 4px', borderRadius: 999, background: 'var(--gold-500)', color: 'var(--on-gold)', fontSize: 10, fontWeight: 800, display: 'inline-grid', placeItems: 'center', lineHeight: 1 }}>{badge}</span>
        )}
      </button>
      {open && (
        <div className="popover-panel" role="dialog" style={{ width: `min(${width}px, 92vw)`, [align]: 0 } as React.CSSProperties}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}
