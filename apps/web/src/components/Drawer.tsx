'use client';

import { ReactNode, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from './ui/sheet';

/** Sagdan acilan slide-over panel (detay/CRM cekmecesi).
 *  shadcn/Radix Sheet ile: focus-trap + ESC + dis-tiklama + arka plan scroll-lock + portal.
 *  Govde KENDI icinde kayar (flex-1 overflow-y-auto); baslik/altlik sabit kalir. */
export function Drawer({ title, subtitle, onClose, children, footer, width = 460 }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const [open, setOpen] = useState(true);
  const handle = (o: boolean) => {
    if (!o) { setOpen(false); onClose(); }
  };
  return (
    <Sheet open={open} onOpenChange={handle}>
      <SheetContent
        side="right"
        className="w-full p-0"
        style={{ width: `min(${width}px, 94vw)`, maxWidth: '94vw' }}
      >
        <SheetHeader className="flex flex-row items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="truncate text-[17px] font-bold">{title}</SheetTitle>
            {subtitle && <SheetDescription className="mt-0.5 text-xs">{subtitle}</SheetDescription>}
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <SheetFooter className="flex flex-wrap justify-end gap-2.5 border-t border-border px-5 py-3.5">{footer}</SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
