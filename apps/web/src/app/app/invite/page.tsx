'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QRCodeSVG } from 'qrcode.react';
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

type BadgeVariant = 'default' | 'secondary' | 'success' | 'destructive';
const INVITE_VARIANT: Record<string, BadgeVariant> = { active: 'success', used: 'default', expired: 'secondary', revoked: 'destructive' };

export default function InvitePage() {
  const uid = useId();
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

  // clipboard izin reddi / insecure-context'te sessiz patlamayi onle (denetim bulgusu)
  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(linkFor(code));
      showToast(t('me.copied') + ' ✓');
    } catch {
      showToast('Copy failed — select the link and copy manually');
    }
  }

  return (
    <div>
      <div className="fade-in text-[11px] font-bold uppercase tracking-[0.14em] text-primary">{t('anav.invite')}</div>
      <h1 className="fade-in mb-1.5 font-display text-2xl font-bold tracking-tight">Grow Your Team</h1>
      <p className="fade-in mb-5 text-sm text-muted-foreground">Share your invite link; everyone who joins becomes part of your tree.</p>

      <Card className="fade-in mb-4 p-5">
        <Label htmlFor={`${uid}-msg`} className="block">Personal welcome message (shown on your invite page)</Label>
        <textarea
          id={`${uid}-msg`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={280}
          rows={2}
          placeholder="e.g. Hey! Join my team and let's grow together."
          className="mt-1.5 resize-y"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{message.length}/280</span>
          <Button variant="ghost" size="sm" onClick={saveMessage} disabled={savingMsg}>{savingMsg ? 'Saving…' : 'Save message'}</Button>
        </div>
      </Card>

      <Card className="card-glow fade-in delay-1 p-5 text-center">
        {!latest ? (
          <>
            <div className="mb-2 text-[40px]">✦</div>
            <p className="mt-0 text-muted-foreground">Create a new invite link.</p>
            <Button onClick={create} disabled={busy} className="mx-auto mt-2">{t('me.inviteCreate')}</Button>
          </>
        ) : (
          <>
            <div className="flex justify-center">
              <div className="inline-block rounded-2xl bg-white p-3.5 shadow-lg">
                <QRCodeSVG value={linkFor(latest)} size={172} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
              <Input readOnly value={linkFor(latest)} className="max-w-[340px]" onFocus={(e) => e.currentTarget.select()} />
              <Button size="sm" onClick={() => copy(latest)}>{t('me.copy')}</Button>
            </div>
            <Button variant="ghost" size="sm" onClick={create} disabled={busy} className="mx-auto mt-3.5">New invite</Button>
          </>
        )}
        {error && <div className="mt-3 text-sm text-destructive">{error}</div>}
      </Card>

      <Card className="fade-in delay-2 mt-4 p-5">
        <strong className="mb-3 block">{t('me.myInvites')}</strong>
        {!invites ? (
          <Loading rows={2} />
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead><tr><th>Code</th><th>Status</th><th>Expires</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id}>
                    <td className="font-mono">{i.code}</td>
                    <td><Badge variant={INVITE_VARIANT[i.status] ?? 'secondary'}>{i.status}</Badge></td>
                    <td className="text-muted-foreground">{dateShort(i.expiresAt)}</td>
                    <td className="text-muted-foreground">{dateShort(i.createdAt)}</td>
                    <td className="text-right">
                      {i.status === 'active' && <Button variant="ghost" size="sm" onClick={() => copy(i.code)}>{t('me.copy')}</Button>}
                    </td>
                  </tr>
                ))}
                {invites.length === 0 && <tr><td colSpan={5} className="text-muted-foreground">{t('me.noData')}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
