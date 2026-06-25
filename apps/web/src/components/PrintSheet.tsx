'use client';

import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Makbuz/dekont yazdirma: mount olunca body'ye .print-mode ekler ve window.print() cagirir.
 * @media print kurallari yalnizca .print-sheet icerigini basar (globals.css).
 * Kullanim: {printing && <PrintSheet onDone={() => setPrinting(false)}>…</PrintSheet>}
 */
export function PrintSheet({ children, onDone }: { children: ReactNode; onDone: () => void }) {
  useEffect(() => {
    document.body.classList.add('print-mode');
    const t = setTimeout(() => {
      window.print();
      onDone(); // print dialogu kapaninca (senkron doner) sheet'i kaldir
    }, 60);
    return () => {
      clearTimeout(t);
      document.body.classList.remove('print-mode');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Fragment ile sar: bilesenin donus tipi ReactPortal yerine JSX.Element olur
  // (monorepo'da react-native'in @types/react@18 sizintisi ReactPortal'i JSX'te bozuyor).
  return <>{createPortal(<div className="print-sheet">{children}</div>, document.body)}</>;
}

/** Antetli baslik: marka + belge adi + tarih. Tum makbuz/dekontlarda ortak gorunum. */
export function PrintHeader({ tenantName, title, subtitle }: { tenantName: string; title: string; subtitle?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #1a1404', paddingBottom: 12, marginBottom: 18 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>{tenantName}</div>
        {subtitle && <div style={{ fontSize: 11, color: '#6b7180', marginTop: 2 }}>{subtitle}</div>}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>{title}</div>
        <div style={{ fontSize: 11, color: '#6b7180', marginTop: 2 }}>{new Date().toLocaleDateString()}</div>
      </div>
    </div>
  );
}

/** Imza alani (iki kolon): teslim eden / teslim alan vb. */
export function PrintSignatures({ left, right }: { left: string; right: string }) {
  return (
    <div style={{ display: 'flex', gap: 40, marginTop: 48 }}>
      {[left, right].map((label) => (
        <div key={label} style={{ flex: 1 }}>
          <div style={{ borderTop: '1px solid #15171e', paddingTop: 6, fontSize: 11, color: '#6b7180' }}>{label}</div>
        </div>
      ))}
    </div>
  );
}
