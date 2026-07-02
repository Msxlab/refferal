'use client';

import { ReactNode, useState } from 'react';
import { Popover as PopoverRoot, PopoverTrigger, PopoverContent } from './ui/popover';
import { Button } from './ui/button';

/** Tetikleyici butona tutturulmus acilir panel (temiz arac cubugu: filtre/aksiyon talep uzerine).
 *  shadcn/Radix Popover ile: konumlandirma + dis-tiklama + ESC + portal/collision dahili. API ayni. */
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
  const close = () => setOpen(false);
  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={variant === 'ghost' ? 'ghost' : 'default'} size="sm" className="relative" aria-expanded={open}>
          {label}
          {badge !== undefined && badge > 0 && (
            <span className="ml-1.5 inline-grid h-[17px] min-w-[17px] place-items-center rounded-full bg-primary px-1 text-[10px] font-extrabold leading-none text-primary-foreground">
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align === 'right' ? 'end' : 'start'} style={{ width: `min(${width}px, 92vw)` }}>
        {typeof children === 'function' ? children(close) : children}
      </PopoverContent>
    </PopoverRoot>
  );
}
