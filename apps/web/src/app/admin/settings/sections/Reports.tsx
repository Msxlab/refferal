'use client';

import { useEffect, useState } from 'react';
import { Save, Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Sub { frequency: 'weekly' | 'monthly'; recipients: string[]; lastSentAt: string | null }

export default function Reports() {
  const [frequency, setFrequency] = useState<'weekly' | 'monthly'>('weekly');
  const [recipients, setRecipients] = useState('');
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

  useEffect(() => {
    api.get<Sub>('/admin/report-subscription').then((s) => {
      setFrequency(s.frequency); setRecipients(s.recipients.join(', ')); setLastSentAt(s.lastSentAt);
    }).catch((e) => setError(String((e as ApiError).message))).finally(() => setLoaded(true));
  }, []);

  function parseRecipients(): string[] {
    return recipients.split(/[,\n]/).map((r) => r.trim().toLowerCase()).filter(Boolean);
  }

  async function save() {
    setBusy(true); setError('');
    try { await api.put('/admin/report-subscription', { frequency, recipients: parseRecipients() }); showToast('Saved ✓'); }
    catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }
  async function sendTest() {
    setBusy(true);
    try { const r = await api.post<{ sent: number }>('/admin/report-subscription/test'); showToast(`Sent to ${r.sent} recipient(s)`); }
    catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  if (!loaded) return <Loading rows={3} />;

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <strong style={{ fontFamily: 'var(--font-display)', fontSize: 14 }}>Scheduled email reports</strong>
      <div className="faint" style={{ fontSize: 12, marginBottom: 14 }}>A period summary (revenue, commission, payouts) is emailed to recipients automatically.</div>
      <div className="field">
        <label>Frequency</label>
        <Select value={frequency} onValueChange={(v) => setFrequency(v as 'weekly' | 'monthly')}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="field">
        <label>Recipients (comma or line separated)</label>
        <textarea value={recipients} onChange={(e) => setRecipients(e.target.value)} rows={3} placeholder="owner@company.com, finance@company.com" style={{ resize: 'vertical' }} />
      </div>
      {lastSentAt && <div className="faint" style={{ fontSize: 11, marginBottom: 10 }}>Last sent: {new Date(lastSentAt).toLocaleString()}</div>}
      {error && <Alert variant="destructive" className="mb-2.5"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="row" style={{ gap: 10 }}>
        <button className="btn" onClick={save} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Save className="size-4" aria-hidden /> Save</button>
        <button className="btn ghost" onClick={sendTest} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Send className="size-4" aria-hidden /> Send test now</button>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
