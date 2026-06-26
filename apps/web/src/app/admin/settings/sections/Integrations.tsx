'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Copy, Send, RefreshCw, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { dateShort } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ApiKey { id: string; name: string; prefix: string; role: string; lastUsedAt: string | null; revokedAt: string | null }
interface Hook { id: string; url: string; events: string[]; active: boolean; secretPrefix: string }
interface Delivery { id: string; event: string; status: string; attempts: number; responseStatus: number | null; url: string; createdAt: string }

export default function Integrations() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [hookUrl, setHookUrl] = useState('');
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [hookBusy, setHookBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try {
      const [k, h, d] = await Promise.all([
        api.get<ApiKey[]>('/admin/api-keys'),
        api.get<Hook[]>('/admin/webhooks'),
        api.get<Delivery[]>('/admin/webhooks/deliveries'),
      ]);
      setKeys(k); setHooks(h); setDeliveries(d);
    } catch (e) { setError(String((e as ApiError).message)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function createKey() {
    if (keyBusy || !newKeyName.trim()) return;
    setKeyBusy(true);
    try { const r = await api.post<{ key: string }>('/admin/api-keys', { name: newKeyName.trim() }); setCreatedKey(r.key); setNewKeyName(''); await load(); }
    catch (e) { setError(String((e as ApiError).message)); }
    finally { setKeyBusy(false); }
  }
  async function revokeKey(id: string) {
    try { await api.del(`/admin/api-keys/${id}`); await load(); } catch (e) { setError(String((e as ApiError).message)); }
  }
  async function createHook() {
    if (hookBusy || !hookUrl.trim()) return;
    setHookBusy(true);
    try { const r = await api.post<{ secret: string }>('/admin/webhooks', { url: hookUrl.trim(), events: [] }); setCreatedSecret(r.secret); setHookUrl(''); await load(); }
    catch (e) { setError(String((e as ApiError).message)); }
    finally { setHookBusy(false); }
  }
  async function delHook(id: string) { try { await api.del(`/admin/webhooks/${id}`); await load(); } catch (e) { setError(String((e as ApiError).message)); } }
  async function testHook() { try { const r = await api.post<{ queued: number }>('/admin/webhooks/test'); showToast(`Queued ${r.queued} test event(s)`); await load(); } catch (e) { setError(String((e as ApiError).message)); } }
  async function replay(id: string) { try { await api.post(`/admin/webhooks/deliveries/${id}/replay`); showToast('Re-queued'); await load(); } catch (e) { setError(String((e as ApiError).message)); } }

  if (!keys) {
    if (error) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;
    return <Loading rows={3} />;
  }

  return (
    <div className="grid" style={{ gap: 20, maxWidth: 680 }}>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <div className="card">
        <strong style={{ fontFamily: 'var(--font-display)', fontSize: 14 }}>API keys</strong>
        <div className="faint" style={{ fontSize: 12, marginBottom: 12 }}>Use <code>X-Api-Key</code> header. A key acts with the creating admin&apos;s role.</div>
        {createdKey && (
          <div className="card" style={{ background: 'color-mix(in srgb, var(--emerald) 10%, transparent)', padding: 12, marginBottom: 12 }}>
            <div className="faint" style={{ fontSize: 11 }}>Copy now — shown once:</div>
            <code style={{ wordBreak: 'break-all', fontSize: 12 }}>{createdKey}</code>
            <div><button className="btn ghost sm" style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => { navigator.clipboard.writeText(createdKey); showToast('Copied'); }}><Copy className="size-4" aria-hidden /> Copy</button></div>
          </div>
        )}
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createKey(); }} placeholder="Key name (e.g. CRM import)" style={{ flex: 1 }} />
          <button className="btn sm" onClick={createKey} disabled={keyBusy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus className="size-4" aria-hidden /> {keyBusy ? 'Creating…' : 'Create'}</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Name</th><th>Prefix</th><th>Last used</th><th></th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}{k.revokedAt && <span className="badge inactive" style={{ marginLeft: 6 }}>revoked</span>}</td>
                  <td className="faint tnum">{k.prefix}…</td>
                  <td className="muted">{k.lastUsedAt ? dateShort(k.lastUsedAt) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{!k.revokedAt && <button className="btn ghost sm danger" onClick={() => revokeKey(k.id)}>Revoke</button>}</td>
                </tr>
              ))}
              {keys.length === 0 && <tr><td colSpan={4} className="muted">No keys.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="spread"><strong style={{ fontFamily: 'var(--font-display)', fontSize: 14 }}>Webhooks</strong><button className="btn ghost sm" onClick={testHook} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Send className="size-4" aria-hidden /> Send test</button></div>
        <div className="faint" style={{ fontSize: 12, margin: '4px 0 12px' }}>HMAC-SHA256 signed (<code>X-Refearn-Signature</code>). Events: payout.paid, … (empty = all).</div>
        {createdSecret && (
          <div className="card" style={{ background: 'color-mix(in srgb, var(--emerald) 10%, transparent)', padding: 12, marginBottom: 12 }}>
            <div className="faint" style={{ fontSize: 11 }}>Signing secret — shown once:</div>
            <code style={{ wordBreak: 'break-all', fontSize: 12 }}>{createdSecret}</code>
            <div><button className="btn ghost sm" style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => { navigator.clipboard.writeText(createdSecret); showToast('Copied'); }}><Copy className="size-4" aria-hidden /> Copy</button></div>
          </div>
        )}
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <input value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createHook(); }} placeholder="https://your-app.com/webhooks/refearn" style={{ flex: 1 }} />
          <button className="btn sm" onClick={createHook} disabled={hookBusy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus className="size-4" aria-hidden /> {hookBusy ? 'Adding…' : 'Add'}</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>URL</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {hooks.map((h) => (
                <tr key={h.id}><td className="faint" style={{ fontSize: 12, wordBreak: 'break-all' }}>{h.url}</td><td><span className={`badge ${h.active ? 'active' : 'inactive'}`}>{h.active ? 'active' : 'off'}</span></td><td style={{ textAlign: 'right' }}><button className="btn ghost sm danger" aria-label={`Delete webhook: ${h.url}`} onClick={() => delHook(h.id)}><Trash2 className="size-4" aria-hidden /></button></td></tr>
              ))}
              {hooks.length === 0 && <tr><td colSpan={3} className="muted">No endpoints.</td></tr>}
            </tbody>
          </table>
        </div>
        {deliveries.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <strong style={{ fontFamily: 'var(--font-display)', fontSize: 13 }}>Recent deliveries</strong>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Event</th><th>Status</th><th style={{ textAlign: 'right' }}>Attempts</th><th></th></tr></thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id}>
                      <td>{d.event}</td>
                      <td><span className={`badge ${d.status === 'delivered' ? 'paid' : d.status === 'failed' ? 'failed' : 'pending'}`}>{d.status}{d.responseStatus ? ` ${d.responseStatus}` : ''}</span></td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{d.attempts}</td>
                      <td style={{ textAlign: 'right' }}>{d.status !== 'delivered' && <button className="btn ghost sm" onClick={() => replay(d.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><RefreshCw className="size-4" aria-hidden /> Replay</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
