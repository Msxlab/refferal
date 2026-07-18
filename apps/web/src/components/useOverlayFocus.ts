'use client';

import { type KeyboardEvent, type RefObject, useCallback, useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let openOverlayCount = 0;

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.closest('[aria-hidden="true"], [inert]') && element.getClientRects().length > 0,
  );
}

/** Focus, keyboard, and scroll-lock behavior shared by modal overlays and drawers. */
export function useOverlayFocus(containerRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openOverlayCount += 1;
    document.documentElement.dataset.overlayOpen = 'true';

    const frame = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const initialFocus =
        container.querySelector<HTMLElement>('[data-initial-focus]') ??
        focusableElements(container)[0] ??
        container;
      initialFocus.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      openOverlayCount = Math.max(0, openOverlayCount - 1);
      if (openOverlayCount === 0) delete document.documentElement.dataset.overlayOpen;

      const returnFocus = returnFocusRef.current;
      window.requestAnimationFrame(() => {
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      });
    };
  }, [containerRef]);

  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const container = containerRef.current;
      if (!container) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = focusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const focusIsOutside = !container.contains(active);

      if (event.shiftKey && (active === first || focusIsOutside)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || focusIsOutside)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    },
    [containerRef],
  );
}
