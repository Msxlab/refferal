'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { dateShort } from '@/lib/format';

interface Item { id: string; title: string; body: string; reads: number; createdAt: string }

export default function Announcements() {
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

  if (!list) {
    if (error) return <div className="error">{error}</div>;
    return <Loading rows={3} />;
  }

  return (
    <div className="grid" style={{ gap: 20, maxWidth: 620 }}>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <strong style={{ fontFamily: 'var(--font-display)', fontSize: 14 }}>New announcement</strong>
        <div className="faint" style={{ fontSize: 12, marginBottom: 10 }}>Members see this on their dashboard until they mark it read.</div>
        <div className="field"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} /></div>
        <div className="field"><label>Message</label><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} style={{ resize: 'vertical' }} /></div>
        <div className="row"><button className="btn" onClick={publish} disabled={busy}>{busy ? 'Publishing…' : 'Publish'}</button></div>
      </div>

      <div className="card">
        <strong style={{ fontFamily: 'var(--font-display)', fontSize: 14, display: 'block', marginBottom: 12 }}>Published</strong>
        {list.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>None yet.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Title</th><th style={{ textAlign: 'right' }}>Reads</th><th>Date</th><th></th></tr></thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id}><td>{a.title}</td><td className="tnum" style={{ textAlign: 'right' }}>{a.reads}</td><td className="muted">{dateShort(a.createdAt)}</td><td style={{ textAlign: 'right' }}><button className="btn ghost sm danger" aria-label={`Delete announcement: ${a.title}`} onClick={() => remove(a.id)}>✕</button></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
