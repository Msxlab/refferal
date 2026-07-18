'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { dateShort } from '@/lib/format';

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

  if (!keys) return <Loading rows={3} />;

  return (
    <div className="grid" style={{ gap: 18, maxWidth: 680 }}>
      {error && <div className="error">{error}</div>}

      <Card>
        <strong style={{ fontSize: 14 }}>API keys</strong>
        <div className="faint" style={{ fontSize: 12, marginBottom: 12 }}>Use <code>X-Api-Key</code> header. A key acts with the creating admin&apos;s role.</div>
        {createdKey && (
          <Card style={{ background: 'color-mix(in srgb, var(--emerald) 10%, transparent)', padding: 12, marginBottom: 12 }}>
            <div className="faint" style={{ fontSize: 11 }}>Copy now — shown once:</div>
            <code style={{ wordBreak: 'break-all', fontSize: 12 }}>{createdKey}</code>
            <div><Button variant="ghost" size="sm" className="mt-1.5" onClick={() => { navigator.clipboard.writeText(createdKey); showToast('Copied'); }}>Copy</Button></div>
          </Card>
        )}
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createKey(); }} placeholder="Key name (e.g. CRM import)" aria-label="API key name" name="new-api-key-name" style={{ flex: 1 }} />
          <Button size="sm" onClick={createKey} disabled={keyBusy}>{keyBusy ? 'Creating…' : 'Create'}</Button>
        </div>
        <table>
          <thead><tr><th>Name</th><th>Prefix</th><th>Last used</th><th></th></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}{k.revokedAt && <Badge variant="secondary" className="ml-1.5">revoked</Badge>}</td>
                <td className="faint tnum">{k.prefix}…</td>
                <td className="muted">{k.lastUsedAt ? dateShort(k.lastUsedAt) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{!k.revokedAt && <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => revokeKey(k.id)}>Revoke</Button>}</td>
              </tr>
            ))}
            {keys.length === 0 && <tr><td colSpan={4} className="muted">No keys.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card>
        <div className="spread"><strong style={{ fontSize: 14 }}>Webhooks</strong><Button variant="ghost" size="sm" onClick={testHook}>Send test</Button></div>
        <div className="faint" style={{ fontSize: 12, margin: '4px 0 12px' }}>HMAC-SHA256 signed (<code>X-Refearn-Signature</code>). Events: payout.paid, … (empty = all).</div>
        {createdSecret && (
          <Card style={{ background: 'color-mix(in srgb, var(--emerald) 10%, transparent)', padding: 12, marginBottom: 12 }}>
            <div className="faint" style={{ fontSize: 11 }}>Signing secret — shown once:</div>
            <code style={{ wordBreak: 'break-all', fontSize: 12 }}>{createdSecret}</code>
            <div><Button variant="ghost" size="sm" className="mt-1.5" onClick={() => { navigator.clipboard.writeText(createdSecret); showToast('Copied'); }}>Copy</Button></div>
          </Card>
        )}
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <Input value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createHook(); }} placeholder="https://your-app.com/webhooks/refearn" aria-label="Webhook URL" name="new-webhook-url" style={{ flex: 1 }} />
          <Button size="sm" onClick={createHook} disabled={hookBusy}>{hookBusy ? 'Adding…' : 'Add'}</Button>
        </div>
        <table>
          <thead><tr><th>URL</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {hooks.map((h) => (
              <tr key={h.id}><td className="faint" style={{ fontSize: 12, wordBreak: 'break-all' }}>{h.url}</td><td><Badge variant={h.active ? 'success' : 'secondary'}>{h.active ? 'active' : 'off'}</Badge></td><td style={{ textAlign: 'right' }}><Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => delHook(h.id)}>✕</Button></td></tr>
            ))}
            {hooks.length === 0 && <tr><td colSpan={3} className="muted">No endpoints.</td></tr>}
          </tbody>
        </table>
        {deliveries.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <strong style={{ fontSize: 13 }}>Recent deliveries</strong>
            <table>
              <thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th></th></tr></thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td>{d.event}</td>
                    <td><Badge variant={d.status === 'delivered' ? 'success' : d.status === 'failed' ? 'destructive' : 'pending'}>{d.status}{d.responseStatus ? ` ${d.responseStatus}` : ''}</Badge></td>
                    <td className="tnum">{d.attempts}</td>
                    <td style={{ textAlign: 'right' }}>{d.status !== 'delivered' && <Button variant="ghost" size="sm" onClick={() => replay(d.id)}>Replay</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
