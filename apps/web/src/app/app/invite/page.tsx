'use client';

import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { dateShort } from '@/lib/format';
import { t } from '@/lib/i18n';

interface InviteItem {
  id: string;
  code: string;
  email: string | null;
  status: string;
  expiresAt: string;
  usedByMembershipId: string | null;
  createdAt: string;
}

export default function InvitePage() {
  const [invites, setInvites] = useState<InviteItem[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [savingMsg, setSavingMsg] = useState(false);
  const [toast, showToast] = useToast();

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const linkFor = (code: string) => `${origin}/i/${code}`;

  const load = useCallback(async () => {
    try {
      const items = await api.get<InviteItem[]>('/app/invites');
      setInvites(items);
      // auto-show an existing active invite link so reps can copy & share in one step
      setLatest((cur) => cur ?? items.find((i) => i.status === 'active')?.code ?? null);
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }, []);

  useEffect(() => {
    void load();
    api.get<{ message: string | null }>('/app/invites/message').then((r) => setMessage(r.message ?? '')).catch(() => {});
  }, [load]);

  async function saveMessage() {
    setSavingMsg(true);
    try { await api.post('/app/invites/message', { message: message.trim() || null }); showToast('Welcome message saved ✓'); }
    catch (e) { setError(String((e as ApiError).message)); } finally { setSavingMsg(false); }
  }

  async function create() {
    setBusy(true);
    setError('');
    try {
      const inv = await api.post<{ code: string }>('/app/invites', {});
      setLatest(inv.code);
      await load();
    } catch (e) {
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  async function copy(code: string) {
    await navigator.clipboard.writeText(linkFor(code));
    showToast(t('me.copied') + ' ✓');
  }

  return (
    <div>
      <div className="eyebrow fade-in">{t('anav.invite')}</div>
      <h1 className="h1 fade-in">Grow Your Team</h1>
      <p className="sub fade-in">Share your invite link; everyone who joins becomes part of your tree.</p>

      <div className="card fade-in" style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>Personal welcome message (shown on your invite page)</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={280} rows={2} placeholder="e.g. Hey! Join my team and let's grow together." style={{ marginTop: 6, resize: 'vertical' }} />
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
          <span className="faint" style={{ fontSize: 11 }}>{message.length}/280</span>
          <button className="btn ghost sm" onClick={saveMessage} disabled={savingMsg}>{savingMsg ? 'Saving…' : 'Save message'}</button>
        </div>
      </div>

      <div className="card card-glow fade-in delay-1" style={{ textAlign: 'center' }}>
        {!latest ? (
          <>
            <div aria-hidden="true" style={{ fontSize: 40, marginBottom: 8 }}>✦</div>
            <p className="muted" style={{ marginTop: 0 }}>Create a new invite link.</p>
            <button className="btn" onClick={create} disabled={busy} style={{ margin: '0 auto' }}>{t('me.inviteCreate')}</button>
          </>
        ) : (
          <>
            <div className="qr"><QRCodeSVG value={linkFor(latest)} size={172} /></div>
            <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
              <input readOnly value={linkFor(latest)} style={{ maxWidth: 340 }} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn sm" onClick={() => copy(latest)}>{t('me.copy')}</button>
            </div>
            <button className="btn ghost sm" onClick={create} disabled={busy} style={{ margin: '14px auto 0' }}>New invite</button>
          </>
        )}
        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      <div className="card fade-in delay-2" style={{ marginTop: 16 }}>
        <strong style={{ display: 'block', marginBottom: 12 }}>{t('me.myInvites')}</strong>
        {!invites ? (
          <Loading rows={2} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Code</th><th>Status</th><th>Expires</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id}>
                    <td style={{ fontFamily: 'ui-monospace, monospace' }}>{i.code}</td>
                    <td><span className={`badge ${i.status}`}>{i.status}</span></td>
                    <td className="muted">{dateShort(i.expiresAt)}</td>
                    <td className="muted">{dateShort(i.createdAt)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {i.status === 'active' && <button className="btn ghost sm" onClick={() => copy(i.code)}>{t('me.copy')}</button>}
                    </td>
                  </tr>
                ))}
                {invites.length === 0 && <tr><td colSpan={5} className="muted">{t('me.noData')}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
