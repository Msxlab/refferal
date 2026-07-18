'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { dateShort } from '@/lib/format';

interface Item { id: string; title: string; body: string; reads: number; createdAt: string }

export default function Announcements() {
  const uid = useId();
  const [list, setList] = useState<Item[] | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try { setList(await api.get<Item[]>('/admin/announcements')); } catch (e) { setError(String((e as ApiError).message)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function publish() {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    try { await api.post('/admin/announcements', { title: title.trim(), body: body.trim() }); setTitle(''); setBody(''); showToast('Published ✓'); await load(); }
    catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    try { await api.del(`/admin/announcements/${id}`); await load(); } catch (e) { setError(String((e as ApiError).message)); }
  }

  if (!list) return <Loading rows={3} />;

  return (
    <div className="grid" style={{ gap: 18, maxWidth: 620 }}>
      {error && <div className="error">{error}</div>}
      <Card>
        <strong style={{ fontSize: 14 }}>New announcement</strong>
        <div className="faint" style={{ fontSize: 12, marginBottom: 10 }}>Members see this on their dashboard until they mark it read.</div>
        <div className="field"><Label htmlFor={`${uid}-title`} className="mb-1.5 block">Title</Label><Input id={`${uid}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} /></div>
        <div className="field"><Label htmlFor={`${uid}-body`} className="mb-1.5 block">Message</Label><Textarea id={`${uid}-body`} value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} style={{ resize: 'vertical' }} /></div>
        <div className="row"><Button onClick={publish} disabled={busy}>{busy ? 'Publishing…' : 'Publish'}</Button></div>
      </Card>

      <Card>
        <strong style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>Published</strong>
        {list.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>None yet.</div> : (
          <table>
            <thead><tr><th>Title</th><th>Reads</th><th>Date</th><th></th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}><td>{a.title}</td><td className="tnum">{a.reads}</td><td className="muted">{dateShort(a.createdAt)}</td><td style={{ textAlign: 'right' }}><Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => remove(a.id)}>✕</Button></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
