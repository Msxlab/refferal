'use client';

import { useEffect, useId, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Sub { frequency: 'weekly' | 'monthly'; recipients: string[]; lastSentAt: string | null }

export default function Reports() {
  const uid = useId();
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
    <Card style={{ maxWidth: 560 }}>
      <strong style={{ fontSize: 14 }}>Scheduled email reports</strong>
      <div className="faint" style={{ fontSize: 12, marginBottom: 14 }}>A period summary (revenue, commission, payouts) is emailed to recipients automatically.</div>
      <div className="field">
        <Label htmlFor={`${uid}-freq`} className="mb-1.5 block">Frequency</Label>
        <select id={`${uid}-freq`} value={frequency} onChange={(e) => setFrequency(e.target.value as 'weekly' | 'monthly')}>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      <div className="field">
        <Label htmlFor={`${uid}-rcpt`} className="mb-1.5 block">Recipients (comma or line separated)</Label>
        <Textarea id={`${uid}-rcpt`} value={recipients} onChange={(e) => setRecipients(e.target.value)} rows={3} placeholder="owner@company.com, finance@company.com" style={{ resize: 'vertical' }} />
      </div>
      {lastSentAt && <div className="faint" style={{ fontSize: 11, marginBottom: 10 }}>Last sent: {new Date(lastSentAt).toLocaleString()}</div>}
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ gap: 10 }}>
        <Button onClick={save} disabled={busy}>Save</Button>
        <Button variant="ghost" onClick={sendTest} disabled={busy}>Send test now</Button>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </Card>
  );
}
