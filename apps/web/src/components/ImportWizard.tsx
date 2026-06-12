'use client';

import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Modal } from '@/components/ui';

interface Mapping { code: string; amount: string; date: string; customer: string; external: string }
interface PreviewRow { line: number; ok: boolean; code: string; amountCents?: string; saleDate?: string; sellerName?: string; reason?: string }
interface PreviewResp { preview: true; okCount: number; errorCount: number; rows: PreviewRow[] }

const SAMPLE = 'referral_code,amount_cents,sale_date,customer_ref\nALICE1,10000000,2026-06-01,Acme Corp\nBOB1,5000000,2026-06-02,Beta LLC';

/** Otomatik tahmin: bilinen baslik adlarini ilgili alana esle. */
function guess(headers: string[], names: string[]): string {
  const lower = headers.map((h) => h.toLowerCase());
  for (const n of names) {
    const i = lower.indexOf(n);
    if (i >= 0) return headers[i];
  }
  return '';
}

export function ImportWizard({ onClose, onDone }: { onClose: () => void; onDone: (created: number) => void }) {
  const [step, setStep] = useState<'data' | 'map' | 'preview'>('data');
  const [csv, setCsv] = useState(SAMPLE);
  const [mapping, setMapping] = useState<Mapping>({ code: '', amount: '', date: '', customer: '', external: '' });
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const headers = useMemo(() => {
    const first = csv.split(/\r?\n/).find((l) => l.trim());
    return first ? first.split(',').map((h) => h.trim()).filter(Boolean) : [];
  }, [csv]);

  function toMap() {
    if (headers.length === 0) { setErr('Add a CSV with a header row first.'); return; }
    setMapping({
      code: guess(headers, ['referral_code', 'code', 'seller']),
      amount: guess(headers, ['amount_cents', 'amount', 'cents']),
      date: guess(headers, ['sale_date', 'date']),
      customer: guess(headers, ['customer_ref', 'customer']),
      external: guess(headers, ['external_ref', 'external', 'ref']),
    });
    setErr(''); setStep('map');
  }

  async function toPreview() {
    if (!mapping.code || !mapping.amount) { setErr('Map both Referral code and Amount.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await api.post<PreviewResp>('/admin/sales/import', { csv, mapping: clean(mapping), preview: true });
      setPreview(res); setStep('preview');
    } catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function confirm() {
    setBusy(true); setErr('');
    try {
      const res = await api.post<{ created: number; errors: unknown[] }>('/admin/sales/import', { csv, mapping: clean(mapping) });
      onDone(res.created);
    } catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  return (
    <Modal title="Import sales — wizard" onClose={onClose}>
      <div style={{ width: 'min(640px, 88vw)' }}>
        <Steps step={step} />

        {step === 'data' && (
          <div>
            <div className="faint" style={{ fontSize: 12, marginBottom: 8 }}>
              Paste CSV with a header row. Any column names work — you'll map them next.
            </div>
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={9}
              style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
            <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>{headers.length} columns detected: {headers.join(', ') || '—'}</div>
          </div>
        )}

        {step === 'map' && (
          <div className="grid" style={{ gap: 12 }}>
            <div className="faint" style={{ fontSize: 12 }}>Match your columns to sale fields. * required.</div>
            <MapRow label="Referral code *" value={mapping.code} headers={headers} onChange={(v) => setMapping({ ...mapping, code: v })} />
            <MapRow label="Amount (cents) *" value={mapping.amount} headers={headers} onChange={(v) => setMapping({ ...mapping, amount: v })} />
            <MapRow label="Sale date" value={mapping.date} headers={headers} onChange={(v) => setMapping({ ...mapping, date: v })} />
            <MapRow label="Customer ref" value={mapping.customer} headers={headers} onChange={(v) => setMapping({ ...mapping, customer: v })} />
            <MapRow label="External ref" value={mapping.external} headers={headers} onChange={(v) => setMapping({ ...mapping, external: v })} />
          </div>
        )}

        {step === 'preview' && preview && (
          <div>
            <div className="row" style={{ gap: 16, marginBottom: 12 }}>
              <span className="badge active">{preview.okCount} ready</span>
              {preview.errorCount > 0 && <span className="badge failed">{preview.errorCount} errors</span>}
            </div>
            <div style={{ maxHeight: '40vh', overflow: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
              <table>
                <thead><tr><th>#</th><th>Code</th><th>Amount</th><th>Seller / error</th></tr></thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line}>
                      <td className="faint">{r.line}</td>
                      <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{r.code || '—'}</td>
                      <td className="tnum">{r.ok && r.amountCents ? `$${(Number(r.amountCents) / 100).toLocaleString('en-US')}` : '—'}</td>
                      <td>
                        {r.ok
                          ? <span style={{ color: 'var(--emerald)' }}>{r.sellerName}</span>
                          : <span style={{ color: 'var(--rose)', fontSize: 12 }}>{r.reason}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="faint" style={{ fontSize: 11, marginTop: 8 }}>Imported sales are created as drafts — approve them to distribute commissions.</div>
          </div>
        )}

        {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}

        <div className="row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
          <button className="btn ghost" onClick={step === 'data' ? onClose : () => setStep(step === 'preview' ? 'map' : 'data')} disabled={busy}>
            {step === 'data' ? 'Cancel' : 'Back'}
          </button>
          {step === 'data' && <button className="btn" onClick={toMap}>Next: map columns →</button>}
          {step === 'map' && <button className="btn" onClick={toPreview} disabled={busy}>{busy ? 'Checking…' : 'Preview →'}</button>}
          {step === 'preview' && <button className="btn" onClick={confirm} disabled={busy || preview?.okCount === 0}>{busy ? 'Importing…' : `Import ${preview?.okCount ?? 0} sales`}</button>}
        </div>
      </div>
    </Modal>
  );
}

function clean(m: Mapping) {
  return {
    code: m.code, amount: m.amount,
    date: m.date || undefined, customer: m.customer || undefined, external: m.external || undefined,
  };
}

function Steps({ step }: { step: 'data' | 'map' | 'preview' }) {
  const items: Array<{ k: typeof step; l: string }> = [{ k: 'data', l: 'Data' }, { k: 'map', l: 'Map' }, { k: 'preview', l: 'Preview' }];
  const idx = items.findIndex((i) => i.k === step);
  return (
    <div className="row" style={{ gap: 8, marginBottom: 16 }}>
      {items.map((it, i) => (
        <div key={it.k} className="row" style={{ gap: 8, flex: 1 }}>
          <span style={{ width: 22, height: 22, borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800,
            background: i <= idx ? 'var(--foil)' : 'var(--panel-2)', color: i <= idx ? 'var(--on-gold)' : 'var(--muted)' }}>{i + 1}</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: i === idx ? 'var(--text)' : 'var(--muted)' }}>{it.l}</span>
          {i < items.length - 1 && <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />}
        </div>
      ))}
    </div>
  );
}

function MapRow({ label, value, headers, onChange }: { label: string; value: string; headers: string[]; onChange: (v: string) => void }) {
  return (
    <div className="spread" style={{ gap: 12 }}>
      <label style={{ fontSize: 13, minWidth: 140 }}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, maxWidth: 280 }}>
        <option value="">— none —</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  );
}
