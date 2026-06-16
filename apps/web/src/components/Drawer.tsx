'use client';

import { ReactNode, useEffect, useRef } from 'react';

/** Sagdan acilan slide-over panel (detay/CRM cekmecesi). ESC + dis-tiklama ile kapanir. */
export function Drawer({ title, subtitle, onClose, children, footer, width = 460 }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // arka plan scroll'unu kilitle
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ width: `min(${width}px, 94vw)` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 750, fontSize: 17, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            {subtitle && <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button className="theme-toggle" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>
  );
}
