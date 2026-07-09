import { useEffect, useMemo, useState } from 'react';

/** Stabil deep-equal (JSON round-trip yeterli: form slice'lari plain object/array/number/string/bool). */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * `current`i son yuklenen `baseline` ile karsilastirir. Yalniz DUZENLENEBILIR form slice'i
 * gecirilmeli (sunucu-eklentili alanlar disarida) — aksi halde her yuklemede kirli gorunur.
 * Baseline'i basarili save sonrasi setBaseline ile guncelle.
 */
export function useDirty<T>(current: T, initialBaseline: T): {
  dirty: boolean;
  baseline: T;
  setBaseline: (next: T) => void;
} {
  const [baseline, setBaseline] = useState<T>(initialBaseline);
  const dirty = useMemo(() => !deepEqual(current, baseline), [current, baseline]);

  // Tarayici kapatma/yenileme guardi — yalniz kirliyken.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return { dirty, baseline, setBaseline };
}
