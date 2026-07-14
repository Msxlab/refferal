'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Copy, UserCheck, UserPlus, UserX } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Confirm, Loading, Modal, useToast } from '@/components/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { t } from '@/lib/i18n';
import { accessChangeConfirmation } from '@/lib/privileged-actions';

interface MemberItem {
  id: string;
  fullName: string;
  email: string;
  referralCode: string;
  role: string;
  status: 'active' | 'inactive';
  depth: number;
  sponsorReferralCode: string | null;
  joinedAt: string;
}
interface MembersList { total: number; page: number; pageSize: number; items: MemberItem[] }
const ROLES = ['member', 'tenant_staff', 'tenant_admin'];
type PendingRoleChange = { member: MemberItem; nextRole: string };

export default function MembersPage() {
  const [list, setList] = useState<MembersList | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [sponsor, setSponsor] = useState('');
  const [latest, setLatest] = useState<string | null>(null);
  const [confirmM, setConfirmM] = useState<MemberItem | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<PendingRoleChange | null>(null);
  const [busy, setBusy] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      setError('');
      const q = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
      setList(await api.get<MembersList>(`/admin/members?page=${page}&pageSize=100${q}`));
    } catch (e) { setError(String((e as ApiError).message)); }
  }, [page, search]);

  useEffect(() => {
    const timeout = setTimeout(() => void load(), search.trim() ? 250 : 0);
    return () => clearTimeout(timeout);
  }, [load, search]);

  useEffect(() => {
    if (!list) return;
    const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));
    if (page > lastPage) setPage(lastPage);
  }, [list, page]);

  async function invite(e: FormEvent) {
    e.preventDefault(); setError('');
    try {
      const res = await api.post<{ code: string }>('/admin/members/invite', sponsor.trim() ? { sponsorReferralCode: sponsor.trim() } : {});
      setLatest(res.code);
      showToast('Invitation created');
    } catch (e) { setError(String((e as ApiError).message)); }
  }

  async function toggleStatus(m: MemberItem) {
    setBusy(true);
    try {
      await api.post(`/admin/members/${m.id}/${m.status === 'active' ? 'deactivate' : 'activate'}`);
      setConfirmM(null);
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function changeRole(m: MemberItem, role: string) {
    setBusy(true); setError('');
    try {
      await api.patch(`/admin/people/${m.id}/role`, { tier: role });
      setPendingRoleChange(null);
      showToast('Role updated');
      await load();
    } catch (e) { setError(String((e as ApiError).message)); }
    finally { setBusy(false); }
  }

  const inviteUrl = latest ? `${typeof window !== 'undefined' ? window.location.origin : ''}/i/${latest}` : '';
  const roleChangeConfirmation = pendingRoleChange
    ? accessChangeConfirmation({
        fullName: pendingRoleChange.member.fullName,
        currentTier: pendingRoleChange.member.role,
        nextTier: pendingRoleChange.nextRole,
      })
    : null;
  const pageCount = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <div>
      <div className="spread">
        <div>
          <div className="eyebrow fade-in">{t('nav.members')}</div>
          <h1 className="h1 fade-in">Member Management</h1>
          <p className="sub fade-in">Invite members, assign roles, deactivate. Placement is permanent.</p>
        </div>
        <Button className="fade-in" type="button" onClick={() => { setLatest(null); setShowInvite(true); }}>
          <UserPlus data-icon="inline-start" />
          {t('members.invite')}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Member action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="fade-in delay-1 my-4 max-w-sm">
        <Field>
          <FieldLabel htmlFor="member-search" className="sr-only">Search members</FieldLabel>
          <Input
            id="member-search"
            placeholder="Search name, email or code"
            value={search}
            onChange={(e) => { setPage(1); setSearch(e.target.value); }}
          />
        </Field>
      </div>

      <Card className="fade-in delay-2">
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>Invite, review, and manage member access.</CardDescription>
          <CardAction>
            {list && <Badge variant="outline">{list.total} total</Badge>}
          </CardAction>
        </CardHeader>
        <CardContent>
        {!list ? <Loading rows={4} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Sponsor</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>{t('members.role')}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="font-medium">{m.fullName}</div>
                    <div className="max-w-[260px] truncate text-sm text-muted-foreground">{m.email}</div>
                  </TableCell>
                  <TableCell className="font-mono">{m.referralCode}</TableCell>
                  <TableCell className="text-muted-foreground">{m.sponsorReferralCode ?? '-'}</TableCell>
                  <TableCell>{m.depth}</TableCell>
                  <TableCell>
                    {m.role === 'tenant_owner' ? <span className="text-sm text-muted-foreground">owner</span> : (
                      <Select
                        value={m.role}
                        disabled={busy}
                        onValueChange={(role: string) => {
                          if (role !== m.role) setPendingRoleChange({ member: m, nextRole: role });
                        }}
                      >
                        <SelectTrigger size="sm" className="min-w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.status === 'active' ? 'secondary' : 'outline'}>{m.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {m.role !== 'tenant_owner' && (
                      <Button variant="outline" size="sm" type="button" onClick={() => setConfirmM(m)}>
                        {m.status === 'active' ? <UserX data-icon="inline-start" /> : <UserCheck data-icon="inline-start" />}
                        {m.status === 'active' ? t('members.deactivate') : t('members.activate')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {list.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">No members found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
        </CardContent>
        {list && list.total > list.pageSize && (
          <CardContent className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
            <span className="text-xs text-muted-foreground">
              Page {list.page} of {pageCount} · {list.total} members
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={list.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft data-icon="inline-start" />
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={list.page >= pageCount}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              >
                Next
                <ChevronRight data-icon="inline-end" />
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {showInvite && (
        <Modal title="Invite a member" onClose={() => setShowInvite(false)}>
          <form onSubmit={invite} className="flex w-[440px] max-w-[88vw] flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="invite-sponsor-code">Sponsor referral code</FieldLabel>
                <Input
                  id="invite-sponsor-code"
                  value={sponsor}
                  onChange={(e) => setSponsor(e.target.value)}
                  placeholder="e.g. ALICE1"
                  autoFocus
                />
                <FieldDescription>Leave blank to sponsor the invite yourself.</FieldDescription>
              </Field>
            </FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Invitation could not be created</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {latest ? (
              <Alert>
                <UserPlus />
                <AlertTitle>Invite link ready</AlertTitle>
                <AlertDescription>
                  <div className="flex flex-col gap-2">
                    <span className="break-all font-mono text-sm">{inviteUrl}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-fit"
                      onClick={() => { navigator.clipboard.writeText(inviteUrl); showToast('Copied'); }}
                    >
                      <Copy data-icon="inline-start" />
                      Copy
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowInvite(false)}>{latest ? 'Done' : 'Cancel'}</Button>
              <Button type="submit">
                <UserPlus data-icon="inline-start" />
                {latest ? 'New invite' : t('members.invite')}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {confirmM && (
        <Confirm
          title={confirmM.status === 'active' ? 'Deactivate member' : 'Activate member'}
          message={confirmM.status === 'active'
            ? `${confirmM.fullName} will be deactivated. New invites and sign-ins are restricted; existing commission rights are preserved.`
            : `${confirmM.fullName} will be reactivated.`}
          confirmLabel={confirmM.status === 'active' ? t('members.deactivate') : t('members.activate')}
          danger={confirmM.status === 'active'}
          busy={busy}
          onConfirm={() => toggleStatus(confirmM)}
          onClose={() => setConfirmM(null)}
        />
      )}

      {pendingRoleChange && roleChangeConfirmation && (
        <Confirm
          title={roleChangeConfirmation.title}
          message={roleChangeConfirmation.message}
          confirmLabel={roleChangeConfirmation.confirmLabel}
          danger={roleChangeConfirmation.danger}
          busy={busy}
          onConfirm={() => changeRole(pendingRoleChange.member, pendingRoleChange.nextRole)}
          onClose={() => setPendingRoleChange(null)}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
