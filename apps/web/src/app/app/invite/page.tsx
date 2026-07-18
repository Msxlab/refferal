'use client';

import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AlertCircle, Copy, Gift, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { dateShort } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
  const [toast, showToast] = useToast();

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const linkFor = (code: string) => `${origin}/i/${code}`;

  const load = useCallback(async () => {
    try {
      setInvites(await api.get<InviteItem[]>('/app/invites'));
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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
    showToast(t('me.copied'));
  }

  return (
    <div>
      <div className="eyebrow fade-in">{t('anav.invite')}</div>
      <h1 className="h1 fade-in">Grow Your Team</h1>
      <p className="sub fade-in">Share your invite link; everyone who joins becomes part of your tree.</p>

      <Card className="fade-in delay-1">
        <CardContent className="grid place-items-center gap-4 text-center">
          {!latest ? (
            <>
              <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary"><Gift className="size-6" /></span>
              <p className="m-0 text-sm text-muted-foreground">Create a new invite link.</p>
              <Button onClick={create} disabled={busy}><Plus />{t('me.inviteCreate')}</Button>
            </>
          ) : (
            <>
              <div className="qr"><QRCodeSVG value={linkFor(latest)} size={172} /></div>
              <div className="flex w-full max-w-xl flex-col justify-center gap-2 sm:flex-row">
                <Input readOnly value={linkFor(latest)} onFocus={(e) => e.currentTarget.select()} />
                <Button onClick={() => copy(latest)}><Copy />{t('me.copy')}</Button>
              </div>
              <Button variant="ghost" size="sm" onClick={create} disabled={busy}><Plus />New invite</Button>
            </>
          )}
          {error && (
            <Alert variant="destructive" className="w-full text-left">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4 fade-in delay-2 py-0">
        <CardHeader className="border-b"><CardTitle>{t('me.myInvites')}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!invites ? <div className="p-4"><Loading rows={2} /></div> : (
            <Table>
              <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Status</TableHead><TableHead>Expires</TableHead><TableHead>Created</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {invites.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell className="font-mono">{invite.code}</TableCell>
                    <TableCell><StatusBadge status={invite.status} /></TableCell>
                    <TableCell className="text-muted-foreground">{dateShort(invite.expiresAt)}</TableCell>
                    <TableCell className="text-muted-foreground">{dateShort(invite.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {invite.status === 'active' && <Button variant="ghost" size="sm" onClick={() => copy(invite.code)}><Copy />{t('me.copy')}</Button>}
                    </TableCell>
                  </TableRow>
                ))}
                {invites.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">{t('me.noData')}</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'active' ? 'default' : status === 'expired' ? 'destructive' : 'secondary'}>{status}</Badge>;
}