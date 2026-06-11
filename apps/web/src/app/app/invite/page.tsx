'use client';

import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api, ApiError } from '@/lib/api';
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
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const linkFor = (code: string) => `${origin}/i/${code}`;

  const load = useCallback(async () => {
    try {
      setInvites(await api.get<InviteItem[]>('/app/invites'));
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError('');
    try {
      const inv = await api.post<{ code: string }>('/app/invites', {});
      setLatest(inv.code);
      setCopied(false);
      await load();
    } catch (e) {
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  async function copy(code: string) {
    await navigator.clipboard.writeText(linkFor(code));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <h1 className="h1">{t('anav.invite')}</h1>

      <div className="card" style={{ marginBottom: 18, textAlign: 'center' }}>
        <button className="btn" onClick={create} disabled={busy} style={{ margin: '0 auto' }}>
          {t('me.inviteCreate')}
        </button>

        {latest && (
          <div style={{ marginTop: 18 }}>
            <div className="qr">
              <QRCodeSVG value={linkFor(latest)} size={160} />
            </div>
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <input readOnly value={linkFor(latest)} style={{ maxWidth: 320 }} />
              <button className="btn ghost sm" onClick={() => copy(latest)}>
                {copied ? t('me.copied') : t('me.copy')}
              </button>
            </div>
          </div>
        )}
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      <div className="card">
        <strong style={{ display: 'block', marginBottom: 10 }}>{t('me.myInvites')}</strong>
        <table>
          <thead>
            <tr><th>Kod</th><th>Durum</th><th>Gecerlilik</th><th>Olusturma</th><th></th></tr>
          </thead>
          <tbody>
            {invites.map((i) => (
              <tr key={i.id}>
                <td>{i.code}</td>
                <td><span className={`badge ${i.status === 'used' ? 'paid' : i.status === 'active' ? 'payable' : 'inactive'}`}>{i.status}</span></td>
                <td>{dateShort(i.expiresAt)}</td>
                <td>{dateShort(i.createdAt)}</td>
                <td>
                  {i.status === 'active' && (
                    <button className="btn ghost sm" onClick={() => copy(i.code)}>{t('me.copy')}</button>
                  )}
                </td>
              </tr>
            ))}
            {invites.length === 0 && <tr><td colSpan={5} className="muted">{t('me.noData')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
