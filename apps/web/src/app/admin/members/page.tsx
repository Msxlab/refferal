'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { ColumnsMenu, Confirm, Loading, Modal, TableColumn, useTablePrefs, useToast } from '@/components/ui';
import { Drawer } from '@/components/Drawer';
import { MemberDrawer as MemberRowDrawer } from '@/components/admin/MemberDrawer';
import { PrintSheet, PrintHeader } from '@/components/PrintSheet';
import { activeMembership, getSession, isAdminRole, startImpersonation, type Session } from '@/lib/auth';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type SortDir = 'asc' | 'desc';

interface MemberItem {
  id: string;
  fullName: string;
  email: string;
  emailVerified: boolean;
  referralCode: string;
  role: string;
  status: 'active' | 'inactive';
  depth: number;
  sponsorReferralCode: string | null;
  soldCents: string;
  earnedCents: string;
  joinedAt: string;
}
interface MembersList { total: number; page: number; pageSize: number; items: MemberItem[] }
const ROLES = ['member', 'tenant_staff', 'tenant_admin'];
// human labels for the raw role enums (API value stays the same)
const ROLE_LABELS: Record<string, string> = { member: 'Rep', tenant_staff: 'Staff', tenant_admin: 'Admin', tenant_owner: 'Owner' };
const roleLabel = (r: string): string => ROLE_LABELS[r] ?? r;
const STATUS_TABS = [['', 'All'], ['active', 'Active'], ['inactive', 'Inactive']] as const;
const MEMBER_COLUMNS: TableColumn[] = [
  { key: 'member', label: 'Member', locked: true },
  { key: 'code', label: 'Code' },
  { key: 'sponsor', label: 'Sponsor' },
  { key: 'level', label: 'Level' },
  { key: 'sold', label: 'Sales $' },
  { key: 'earned', label: 'Earned $' },
  { key: 'role', label: 'Role' },
  { key: 'status', label: 'Status' },
  { key: 'joined', label: 'Joined' },
];

const initialsOf = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';

/* -------- inline indigo-theme sortable header -------- */
function SortHead({ label, field, sort, dir, onSort, align, className }: {
  label: string; field: string; sort: string; dir: SortDir;
  onSort: (field: string, d: SortDir) => void; align?: 'left' | 'right'; className?: string;
}) {
  const active = sort === field;
  return (
    <th
      className={cn(
        'px-4 py-2.5 font-medium text-muted-foreground select-none cursor-pointer hover:text-foreground transition-colors',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onSort(field, active && dir === 'desc' ? 'asc' : 'desc')}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <span className="text-primary text-[10px]">{dir === 'asc' ? '▲' : '▼'}</span>}
      </span>
    </th>
  );
}

/* -------- inline indigo-theme status / role pills -------- */
function StatusPill({ status }: { status: 'active' | 'inactive' }) {
  return status === 'active'
    ? <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">active</Badge>
    : <Badge variant="outline" className="border-border bg-muted text-muted-foreground">inactive</Badge>;
}

export default function MembersPage() {
  const [list, setList] = useState<MembersList | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('joinedAt');
  const [dir, setDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [sponsor, setSponsor] = useState('');
  const [latest, setLatest] = useState<string | null>(null);
  const [confirmM, setConfirmM] = useState<MemberItem | null>(null);
  const [bulkRole, setBulkRole] = useState('member');
  // satir-ici rol degisimi icin in-flight guard (membership id ile)
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null);
  const [pendingBulk, setPendingBulk] = useState<{ action: 'activate' | 'deactivate' | 'set_role'; role?: string } | null>(null);
  const [preview, setPreview] = useState<{ total: number; willChange: number; skipped: { id: string; reason: string }[]; openPayoutRequests: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  // manuel uye ekleme
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addSponsor, setAddSponsor] = useState('');
  const [addRole, setAddRole] = useState('member');
  const [addAsLeader, setAddAsLeader] = useState(false);
  // profil duzenle
  const [editM, setEditM] = useState<MemberItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [addResult, setAddResult] = useState<{ referralCode: string; tempPassword?: string; newUser: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  // satira tiklayinca acilan, salt-sunum (sadece satir verisi) detay cekmecesi
  const [rowDetail, setRowDetail] = useState<MemberItem | null>(null);
  const cols = useTablePrefs('members', MEMBER_COLUMNS);
  const colCount = 1 + MEMBER_COLUMNS.filter((c) => cols.isVisible(c.key)).length + 1;
  const [nps, setNps] = useState<{ nps: number | null; total: number } | null>(null);
  const [funnel, setFunnel] = useState<{ views: number; signups: number; conversionPct: number | null } | null>(null);
  useEffect(() => {
    api.get<{ nps: number | null; total: number }>('/admin/surveys').then(setNps).catch(() => {});
    api.get<{ views: number; signups: number; conversionPct: number | null }>('/admin/invite-funnel').then(setFunnel).catch(() => {});
  }, []);

  const filterQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set('search', search.trim());
    if (status) p.set('status', status);
    return p.toString();
  }, [search, status]);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams(filterQuery);
      p.set('sort', sort); p.set('dir', dir); p.set('page', String(page)); p.set('pageSize', '25');
      setList(await api.get<MembersList>(`/admin/members?${p.toString()}`));
      setSelected(new Set());
    } catch (e) { setError(String((e as ApiError).message)); }
  }, [filterQuery, sort, dir, page]);

  useEffect(() => { const id = setTimeout(() => void load(), 250); return () => clearTimeout(id); }, [load]);

  function onSort(field: string, d: SortDir) { setSort(field); setDir(d); setPage(1); }

  async function invite(e: FormEvent) {
    e.preventDefault(); setError('');
    try {
      const res = await api.post<{ code: string }>('/admin/members/invite', sponsor.trim() ? { sponsorReferralCode: sponsor.trim() } : {});
      setLatest(res.code);
      showToast('Invitation created ✓');
    } catch (e) { setError(String((e as ApiError).message)); }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault(); if (!editM) return; setError(''); setBusy(true);
    try {
      await api.patch(`/admin/members/${editM.id}`, { fullName: editName.trim(), email: editEmail.trim() });
      showToast('Profile updated ✓');
      setEditM(null);
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function createMember(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const res = await api.post<{ referralCode: string; tempPassword?: string; newUser: boolean }>('/admin/members', {
        fullName: addName.trim(),
        email: addEmail.trim(),
        ...(addAsLeader ? { asLeader: true } : (addSponsor.trim() ? { sponsorReferralCode: addSponsor.trim() } : {})),
        role: addRole,
      });
      setAddResult(res);
      showToast('Member added ✓');
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function toggleStatus(m: MemberItem) {
    setBusy(true);
    try {
      await api.post(`/admin/members/${m.id}/${m.status === 'active' ? 'deactivate' : 'activate'}`);
      setConfirmM(null);
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  // dry-run: once etki ozetini al, modal'da goster
  async function openBulk(action: 'activate' | 'deactivate' | 'set_role') {
    const body = { action, ids: [...selected], ...(action === 'set_role' ? { role: bulkRole } : {}) };
    try {
      const pv = await api.post<typeof preview>('/admin/members/bulk', { ...body, preview: true });
      setPreview(pv);
      setPendingBulk({ action, role: action === 'set_role' ? bulkRole : undefined });
    } catch (e) { setError(String((e as ApiError).message)); }
  }
  async function applyBulk() {
    if (!pendingBulk) return;
    setBusy(true);
    try {
      const res = await api.post<{ succeeded: number; failed: { id: string; reason: string }[] }>('/admin/members/bulk', {
        action: pendingBulk.action, ids: [...selected], ...(pendingBulk.role ? { role: pendingBulk.role } : {}),
      });
      showToast(`${res.succeeded} updated${res.failed.length ? `, ${res.failed.length} skipped` : ''}`);
      setPendingBulk(null); setPreview(null);
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function changeRole(m: MemberItem, role: string) {
    if (roleBusyId) return;
    setRoleBusyId(m.id);
    try { await api.post(`/admin/members/${m.id}/role`, { role }); showToast('Role updated'); await load(); }
    catch (e) { setError(String((e as ApiError).message)); } finally { setRoleBusyId(null); }
  }

  async function exportCsv() {
    try { await downloadCsv(`/admin/members/export.csv${filterQuery ? `?${filterQuery}` : ''}`, 'members.csv'); }
    catch (e) { setError(String((e as ApiError).message)); }
  }

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    if (!list) return;
    setSelected((prev) => prev.size === list.items.length ? new Set() : new Set(list.items.map((m) => m.id)));
  }
  // sponsor koduyla o uyeyi ac (listede varsa)
  function openSponsor(code: string) {
    const found = list?.items.find((m) => m.referralCode === code);
    if (found) setDetailId(found.id);
    else { setSearch(code); showToast('Filtered to sponsor — click the row'); }
  }

  const inviteUrl = latest ? `${typeof window !== 'undefined' ? window.location.origin : ''}/i/${latest}` : '';
  const selActivatable = useMemo(() => list?.items.filter((m) => selected.has(m.id) && m.status === 'inactive' && m.role !== 'tenant_owner').length ?? 0, [list, selected]);
  const selDeactivatable = useMemo(() => list?.items.filter((m) => selected.has(m.id) && m.status === 'active' && m.role !== 'tenant_owner').length ?? 0, [list, selected]);

  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;
  const firstRow = list ? (list.page - 1) * list.pageSize + 1 : 0;
  const lastRow = list ? Math.min(list.page * list.pageSize, list.total) : 0;

  return (
    <div className="mx-auto max-w-[1160px] px-7 pb-16 pt-6 text-foreground">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-primary">{t('nav.members')}</div>
          <h1 className="mt-1 font-display text-[27px] font-extrabold tracking-tight text-foreground">Member Management</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Invite members, assign roles, deactivate. Placement is permanent.
            {nps && nps.total > 0 && nps.nps != null && (
              <Badge variant="outline" className="ml-2 border-emerald-500/30 bg-emerald-500/10 font-medium text-emerald-400">NPS {nps.nps} · {nps.total} responses</Badge>
            )}
            {funnel && funnel.views > 0 && (
              <Badge variant="outline" className="ml-2 border-primary/30 bg-primary/10 font-medium text-primary">
                Invite funnel: {funnel.views} views → {funnel.signups} signups{funnel.conversionPct != null ? ` (${funnel.conversionPct}%)` : ''}
              </Badge>
            )}
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>⇩ Export CSV</Button>
          <Button variant="outline" size="sm" onClick={() => { setError(''); setAddName(''); setAddEmail(''); setAddSponsor(''); setAddRole('member'); setAddAsLeader(false); setAddResult(null); setShowAdd(true); }}>＋ Add member</Button>
          <Button size="sm" onClick={() => { setLatest(null); setShowInvite(true); }}>✦ {t('members.invite')}</Button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      {/* filter bar */}
      <div className="no-print my-[18px] flex flex-wrap items-center gap-[11px]">
        <div className="flex h-9 max-w-[320px] flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/70">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" />
          </svg>
          <input
            aria-label="Search members by name, email, or code"
            placeholder="Search name, email or code…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 outline-none"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
          {STATUS_TABS.map(([v, lbl]) => (
            <button
              key={v}
              onClick={() => { setStatus(v); setPage(1); }}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                status === v ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {lbl}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <ColumnsMenu prefs={cols} />
      </div>

      {/* table card */}
      <Card className="overflow-hidden rounded-2xl border-border bg-card shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
          <strong className="text-sm">Members {list && <span className="font-normal text-muted-foreground/70">({list.total})</span>}</strong>
        </div>
        {!list ? (
          <div className="p-5"><Loading rows={4} /></div>
        ) : (
          <div className="relative w-full overflow-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="no-print w-[34px] px-[18px] py-2.5">
                    <input type="checkbox" className="accent-primary" checked={selected.size > 0 && selected.size === list.items.length} onChange={toggleAll} aria-label="Select all" />
                  </th>
                  {cols.isVisible('member') && <SortHead label="Member" field="fullName" sort={sort} dir={dir} onSort={onSort} />}
                  {cols.isVisible('code') && <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Code</th>}
                  {cols.isVisible('sponsor') && <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Sponsor</th>}
                  {cols.isVisible('level') && <SortHead label="Lvl." field="depth" sort={sort} dir={dir} onSort={onSort} className="text-center" />}
                  {cols.isVisible('sold') && <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Sales $</th>}
                  {cols.isVisible('earned') && <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Earned $</th>}
                  {cols.isVisible('role') && <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">{t('members.role')}</th>}
                  {cols.isVisible('status') && <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>}
                  {cols.isVisible('joined') && <SortHead label="Joined" field="joinedAt" sort={sort} dir={dir} onSort={onSort} />}
                  <th className="no-print px-4 py-2.5 text-right font-medium text-muted-foreground">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((m) => (
                  <tr
                    key={m.id}
                    className={cn(
                      'cursor-pointer border-t border-border transition-colors hover:bg-muted/50',
                      selected.has(m.id) && 'bg-primary/5',
                    )}
                    onClick={() => setRowDetail(m)}
                  >
                    <td className="no-print px-[18px] py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="accent-primary" checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Select ${m.fullName}`} />
                    </td>
                    {cols.isVisible('member') && (
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/15 font-display text-[11px] font-bold text-primary">{initialsOf(m.fullName)}</span>
                          <div className="min-w-0">
                            <div className="font-semibold text-foreground">{m.fullName}</div>
                            <div className="text-[11px] text-muted-foreground/70">{m.email}</div>
                          </div>
                        </div>
                      </td>
                    )}
                    {cols.isVisible('code') && (
                      <td className="px-4 py-2.5 font-mono text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex items-center gap-1.5">
                          {m.referralCode}
                          <button
                            title="Copy code"
                            aria-label={`Copy ${m.referralCode}`}
                            className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => { navigator.clipboard.writeText(m.referralCode).then(() => showToast('Copied ✓')).catch(() => {}); }}
                          >⧉</button>
                        </span>
                      </td>
                    )}
                    {cols.isVisible('sponsor') && (
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        {m.sponsorReferralCode
                          ? <button className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs text-foreground transition-colors hover:border-primary hover:text-primary" onClick={() => openSponsor(m.sponsorReferralCode!)}>{m.sponsorReferralCode}</button>
                          : <span className="text-muted-foreground/70">—</span>}
                      </td>
                    )}
                    {cols.isVisible('level') && <td className="px-4 py-2.5 text-center tabular-nums text-muted-foreground">{m.depth}</td>}
                    {cols.isVisible('sold') && <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{Number(m.soldCents) > 0 ? money(m.soldCents) : '—'}</td>}
                    {cols.isVisible('earned') && <td className={cn('px-4 py-2.5 text-right font-semibold tabular-nums', Number(m.earnedCents) > 0 ? 'text-emerald-400' : 'text-muted-foreground/70')}>{Number(m.earnedCents) > 0 ? money(m.earnedCents) : '—'}</td>}
                    {cols.isVisible('role') && (
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        {m.role === 'tenant_owner' ? <span className="text-muted-foreground/70">Owner</span> : (
                          <select
                            value={m.role}
                            disabled={roleBusyId === m.id}
                            onChange={(e) => changeRole(m, e.target.value)}
                            aria-label={`Role for ${m.fullName}`}
                            className="w-[120px] rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors hover:border-primary/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                          </select>
                        )}
                      </td>
                    )}
                    {cols.isVisible('status') && <td className="px-4 py-2.5"><StatusPill status={m.status} /></td>}
                    {cols.isVisible('joined') && <td className="px-4 py-2.5 tabular-nums text-muted-foreground/70">{dateShort(m.joinedAt)}</td>}
                    <td className="no-print px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        <button
                          title="Edit profile"
                          aria-label={`Edit ${m.fullName}`}
                          className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => { setError(''); setEditM(m); setEditName(m.fullName); setEditEmail(m.email); }}
                        >✎</button>
                        {m.role !== 'tenant_owner' && (
                          <button
                            className="rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => setConfirmM(m)}
                          >
                            {m.status === 'active' ? t('members.deactivate') : t('members.activate')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {list.items.length === 0 && (
                  <tr><td colSpan={colCount} className="px-4 py-10 text-center text-muted-foreground">No members found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* pager */}
        {list && list.total > 0 && pages > 1 && (
          <div className="no-print flex items-center justify-between border-t border-border px-[18px] py-3 text-xs text-muted-foreground/70">
            <span className="tabular-nums">Showing {firstRow}–{lastRow} of {list.total}</span>
            <div className="flex items-center gap-1.5">
              <button
                className="grid h-7 w-7 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-40"
                disabled={list.page <= 1}
                onClick={() => setPage(list.page - 1)}
                aria-label="Previous page"
              >‹</button>
              <span className="tabular-nums px-1.5 text-foreground">{list.page} / {pages}</span>
              <button
                className="grid h-7 w-7 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-40"
                disabled={list.page >= pages}
                onClick={() => setPage(list.page + 1)}
                aria-label="Next page"
              >›</button>
            </div>
          </div>
        )}
      </Card>

      {/* sticky bulk-action bar */}
      {selected.size > 0 && (
        <div className="no-print sticky bottom-[18px] z-30 mx-auto mt-4 flex max-w-[680px] flex-wrap items-center gap-2.5 rounded-xl border border-input bg-popover px-3.5 py-2.5 shadow-lg">
          <strong className="text-[13px]">{selected.size} selected</strong>
          <div className="hidden flex-1 sm:block" />
          <Button size="sm" disabled={selActivatable === 0} onClick={() => openBulk('activate')}>Activate {selActivatable || ''}</Button>
          <Button size="sm" variant="destructive" disabled={selDeactivatable === 0} onClick={() => openBulk('deactivate')}>Deactivate {selDeactivatable || ''}</Button>
          <span className="flex items-center gap-1.5">
            <select
              value={bulkRole}
              onChange={(e) => setBulkRole(e.target.value)}
              aria-label="Bulk role"
              className="h-8 rounded-md border border-input bg-card px-2 text-xs text-foreground outline-none focus:border-primary"
            >
              {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={() => openBulk('set_role')}>Set role</Button>
          </span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {showInvite && (
        <Modal title="Invite a member" onClose={() => setShowInvite(false)}>
          <form onSubmit={invite} className="w-[min(440px,88vw)]">
            <div className="mb-3">
              <label className="mb-1.5 block text-xs text-muted-foreground">Sponsor referral code (blank = yourself)</label>
              <input
                value={sponsor}
                onChange={(e) => setSponsor(e.target.value)}
                placeholder="e.g. ALICE1"
                autoFocus
                className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
            </div>
            {error && <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            {latest ? (
              <div className="mt-1 rounded-xl border border-primary/20 bg-primary/10 p-3">
                <div className="mb-1.5 text-[11px] text-muted-foreground/70">Invite link — share it:</div>
                <div className="flex items-center justify-between gap-2">
                  <span className="break-all text-[12.5px] text-primary">{inviteUrl}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(inviteUrl); showToast('Copied ✓'); }}>Copy</Button>
                </div>
              </div>
            ) : null}
            <div className="mt-3.5 flex justify-end gap-2.5">
              <Button type="button" variant="ghost" onClick={() => setShowInvite(false)}>{latest ? 'Done' : 'Cancel'}</Button>
              <Button type="submit">✦ {latest ? 'New invite' : t('members.invite')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {showAdd && (
        <Modal title="Add member" onClose={() => setShowAdd(false)}>
          <div className="w-[min(460px,100%)]">
            {addResult ? (
              <div>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5">
                  <div className="mb-1.5 font-bold text-foreground">✓ Member added</div>
                  <div className="flex items-center justify-between text-[13px]"><span className="text-muted-foreground">Referral code</span><strong className="font-mono tabular-nums">{addResult.referralCode}</strong></div>
                  {addResult.tempPassword ? (
                    <div className="mt-2">
                      <div className="mb-1 text-[11px] text-muted-foreground/70">Temporary password (share it with them — shown only once):</div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-emerald-400">{addResult.tempPassword}</span>
                        <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(addResult.tempPassword!).then(() => showToast('Copied ✓')).catch(() => {}); }}>Copy</Button>
                      </div>
                    </div>
                  ) : <div className="mt-2 text-xs text-muted-foreground/70">This email already exists — the person signs in with their existing password (a new membership was added).</div>}
                </div>
                <div className="mt-3.5 flex justify-end gap-2.5">
                  <Button type="button" variant="ghost" onClick={() => { setAddResult(null); setAddName(''); setAddEmail(''); setAddSponsor(''); }}>Add another</Button>
                  <Button type="button" onClick={() => setShowAdd(false)}>Done</Button>
                </div>
              </div>
            ) : (
              <form onSubmit={createMember}>
                <div className="mb-3">
                  <label className="mb-1.5 block text-xs text-muted-foreground">Full name</label>
                  <input value={addName} onChange={(e) => setAddName(e.target.value)} required minLength={2} autoFocus placeholder="e.g. Jane Smith" className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                </div>
                <div className="mb-3">
                  <label className="mb-1.5 block text-xs text-muted-foreground">Email</label>
                  <input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} required placeholder="name@company.com" className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                </div>
                <div className="flex gap-3">
                  <div className="flex-[2]">
                    <label className="mb-1.5 block text-xs text-muted-foreground">Sponsor code {addAsLeader ? '(leader — no sponsor)' : '(blank = owner)'}</label>
                    <input value={addSponsor} onChange={(e) => setAddSponsor(e.target.value)} placeholder="e.g. ALICE1" disabled={addAsLeader} className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50" />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1.5 block text-xs text-muted-foreground">Role</label>
                    <select value={addRole} onChange={(e) => setAddRole(e.target.value)} className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary">
                      {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                    </select>
                  </div>
                </div>
                <label className="my-2 flex cursor-pointer items-center gap-2 text-[13px]">
                  <input type="checkbox" className="accent-primary" checked={addAsLeader} onChange={(e) => setAddAsLeader(e.target.checked)} />
                  🎖 Add as a new team leader (top of the tree, no sponsor)
                </label>
                <div className="text-xs text-muted-foreground/70">A temporary password is generated; the person signs in with it and changes it. (Placement is permanent.)</div>
                {error && <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
                <div className="mt-3.5 flex justify-end gap-2.5">
                  <Button type="button" variant="ghost" onClick={() => setShowAdd(false)} disabled={busy}>Cancel</Button>
                  <Button type="submit" disabled={busy}>{busy ? 'Adding…' : '＋ Add member'}</Button>
                </div>
              </form>
            )}
          </div>
        </Modal>
      )}

      {editM && (
        <Modal title={`Edit profile — ${editM.fullName}`} onClose={() => setEditM(null)}>
          <form onSubmit={saveProfile} className="w-[min(420px,100%)]">
            <div className="mb-3">
              <label className="mb-1.5 block text-xs text-muted-foreground">Full name</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} required minLength={2} autoFocus className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
            </div>
            <div className="mb-3">
              <label className="mb-1.5 block text-xs text-muted-foreground">Email</label>
              <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
            </div>
            <div className="text-xs text-muted-foreground/70">Changing the email requires the person to re-verify. Placement (sponsor) does not change.</div>
            {error && <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            <div className="mt-3.5 flex justify-end gap-2.5">
              <Button type="button" variant="ghost" onClick={() => setEditM(null)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
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

      {pendingBulk && preview && (
        <Modal title="Review bulk change" onClose={() => { setPendingBulk(null); setPreview(null); }}>
          <div className="w-[min(420px,88vw)]">
            <p className="mt-0 text-sm text-muted-foreground">
              {pendingBulk.action === 'set_role' ? `Set role to "${pendingBulk.role}" for selected members.`
                : pendingBulk.action === 'activate' ? 'Activate selected members.' : 'Deactivate selected members.'}
            </p>
            <div className="my-3 grid gap-2 rounded-xl border border-border bg-muted/40 p-3">
              <div className="flex items-center justify-between"><span className="text-[13px] text-muted-foreground">Selected</span><b className="tabular-nums">{preview.total}</b></div>
              <div className="flex items-center justify-between"><span className="text-[13px] text-muted-foreground">Will change</span><b className="tabular-nums text-emerald-400">{preview.willChange}</b></div>
              <div className="flex items-center justify-between"><span className="text-[13px] text-muted-foreground">Skipped (no-op / protected)</span><b className="tabular-nums text-muted-foreground/70">{preview.skipped.length}</b></div>
              {preview.openPayoutRequests > 0 && (
                <div className="flex items-center justify-between text-amber-400"><span className="text-[13px]">⚠ In open payout request</span><b className="tabular-nums">{preview.openPayoutRequests}</b></div>
              )}
            </div>
            <div className="mt-3.5 flex justify-end gap-2.5">
              <Button variant="ghost" onClick={() => { setPendingBulk(null); setPreview(null); }} disabled={busy}>Cancel</Button>
              <Button variant={pendingBulk.action === 'deactivate' ? 'destructive' : 'default'} onClick={applyBulk} disabled={busy || preview.willChange === 0}>
                {busy ? 'Applying…' : `Apply to ${preview.willChange}`}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {rowDetail && (
        <MemberRowDrawer
          member={rowDetail}
          onClose={() => setRowDetail(null)}
          onEdit={(m) => { setRowDetail(null); setError(''); setEditM(m); setEditName(m.fullName); setEditEmail(m.email); }}
          onDeactivate={(m) => { setRowDetail(null); setConfirmM(m); }}
        />
      )}

      {detailId && <MemberDrawer id={detailId} onClose={() => setDetailId(null)} onNavigate={setDetailId} onChanged={load} onToast={showToast} />}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-popover px-4 py-2 text-sm text-foreground shadow-lg" role="status">{toast}</div>
      )}
    </div>
  );
}

/* --------------------------------------------------- uye 360 cekmecesi */
interface MemberDetail {
  profile: {
    id: string; fullName: string; email: string; emailVerified: boolean; referralCode: string;
    role: string; status: 'active' | 'inactive'; depth: number; joinedAt: string;
    sponsor: { membershipId: string; name: string; code: string } | null;
  };
  stats: {
    directs: number;
    sales: { allTime: { count: number; cents: string }; thisMonth: { count: number; cents: string } };
    commission: { pendingCents: string; payableCents: string; paidCents: string };
    invites: { total: number; used: number; pending: number };
  };
  recentSales: { id: string; saleDate: string; amountCents: string; status: string }[];
  recentLedger: { id: string; saleId: string; level: number; type: string; status: string; amountCents: string; createdAt: string }[];
}

function MemberDrawer({ id, onClose, onNavigate, onChanged, onToast }: {
  id: string; onClose: () => void; onNavigate: (id: string) => void; onChanged: () => void; onToast: (m: string) => void;
}) {
  const [d, setD] = useState<MemberDetail | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [tab, setTab] = useState('overview');
  const tenantName = (() => { const s = getSession(); return (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn'; })();
  const meIsAdmin = (() => { const s = getSession(); return s ? isAdminRole(activeMembership(s)?.role) : false; })();

  async function exportData() {
    try {
      const data = await api.get<unknown>(`/admin/members/${id}/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `member-${id}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(String((e as ApiError).message)); }
  }

  async function viewAsMember() {
    if (!d) return;
    try {
      const res = await api.post<{ accessToken: string; member: { membershipId: string; userId: string; fullName: string; email: string; referralCode: string; role: string; tenantId: string; tenantName: string } }>(`/admin/members/${id}/impersonate`);
      const m = res.member;
      const impSession: Session = {
        accessToken: res.accessToken,
        refreshToken: '',
        user: { id: m.userId, email: m.email, fullName: m.fullName, locale: 'en', emailVerified: true },
        activeMembershipId: m.membershipId,
        memberships: [{ id: m.membershipId, tenantId: m.tenantId, tenantSlug: '', tenantName: m.tenantName, role: m.role, referralCode: m.referralCode, depth: 0 }],
      };
      startImpersonation(impSession);
      window.location.href = '/app';
    } catch (e) { setErr(String((e as ApiError).message)); }
  }

  const load = useCallback(() => {
    setD(null);
    api.get<MemberDetail>(`/admin/members/${id}`).then(setD).catch((e) => setErr(String((e as ApiError).message)));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function setStatus(next: 'activate' | 'deactivate') {
    setBusy(true);
    try { await api.post(`/admin/members/${id}/${next}`); onToast(next === 'activate' ? 'Activated' : 'Deactivated'); load(); onChanged(); }
    catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }
  async function changeRole(role: string) {
    if (busy) return;
    setBusy(true);
    try { await api.post(`/admin/members/${id}/role`, { role }); onToast('Role updated'); load(); onChanged(); }
    catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  const cur = 'USD';
  const p = d?.profile;

  return (
    <Drawer
      title={p ? p.fullName : 'Member'}
      subtitle={p ? `${p.referralCode} · ${p.email}` : undefined}
      onClose={onClose}
      footer={p && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setPrinting(true)}>🖶 Print</Button>
          {meIsAdmin && <Button variant="outline" size="sm" disabled={busy} onClick={exportData}>⇩ Export</Button>}
          {meIsAdmin && p.role !== 'tenant_owner' && p.role !== 'tenant_admin' && (
            <Button variant="outline" size="sm" disabled={busy} onClick={viewAsMember}>👁 View as member</Button>
          )}
          <div className="flex-1" />
          {p.role !== 'tenant_owner' && (
            <select
              value={p.role}
              disabled={busy}
              onChange={(e) => changeRole(e.target.value)}
              className="h-8 w-[140px] rounded-md border border-input bg-card px-2 text-xs text-foreground outline-none focus:border-primary disabled:opacity-50"
            >
              {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          )}
          {p.role !== 'tenant_owner' && (
            <Button
              variant={p.status === 'active' ? 'destructive' : 'default'}
              size="sm"
              disabled={busy}
              onClick={() => setStatus(p.status === 'active' ? 'deactivate' : 'activate')}
            >
              {p.status === 'active' ? 'Deactivate' : 'Activate'}
            </Button>
          )}
        </div>
      )}
    >
      {err && <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
      {!d || !p ? (
        err ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <div className="text-sm text-muted-foreground">Couldn’t load this member.</div>
            <Button variant="outline" size="sm" onClick={() => { setErr(''); load(); }}>Try again</Button>
          </div>
        ) : <Loading rows={4} />
      ) : (
        <div className="flex flex-col gap-[18px]">
          {/* status / role chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status={p.status} />
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">{roleLabel(p.role)}</Badge>
            {p.emailVerified && <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">email verified</Badge>}
            <span className="text-xs text-muted-foreground/70">· level {p.depth} · joined {dateShort(p.joinedAt)}</span>
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full justify-start">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="sales">Sales</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-3 flex flex-col gap-[18px]">
              {/* 4 mini stat */}
              <div className="grid grid-cols-2 gap-3">
                <Mini label="Direct referrals" value={String(d.stats.directs)} hint={`${d.stats.invites.used}/${d.stats.invites.total} invites used`} />
                <Mini label="Sales this month" value={String(d.stats.sales.thisMonth.count)} hint={money(d.stats.sales.thisMonth.cents, cur)} />
                <Mini label="All-time revenue" value={money(d.stats.sales.allTime.cents, cur)} hint={`${d.stats.sales.allTime.count} approved`} />
                <Mini label="Commission paid" value={money(d.stats.commission.paidCents, cur)} hint="lifetime" />
              </div>

              {/* bakiye cipleri */}
              <div className="flex flex-wrap gap-2">
                <Chip label="Pending" value={money(d.stats.commission.pendingCents, cur)} tone="pending" />
                <Chip label="Payable" value={money(d.stats.commission.payableCents, cur)} tone="payable" />
                <Chip label="Paid" value={money(d.stats.commission.paidCents, cur)} tone="paid" />
              </div>

              {p.sponsor && (
                <div>
                  <div className="mb-1.5 text-[11px] text-muted-foreground/70">Sponsor</div>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-[12.5px] font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
                    onClick={() => onNavigate(p.sponsor!.membershipId)}
                  >
                    {p.sponsor.name} · {p.sponsor.code} ↗
                  </button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="sales" className="mt-3">
              <strong className="mb-2.5 block text-[13px]">Recent sales</strong>
              {d.recentSales.length === 0 ? <Empty /> : (
                <table className="w-full border-collapse text-[12.5px]">
                  <thead><tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 font-medium">Date</th><th className="py-2 font-medium">Amount</th><th className="py-2 font-medium">Status</th>
                  </tr></thead>
                  <tbody>
                    {d.recentSales.map((s) => (
                      <tr key={s.id} className="border-t border-border">
                        <td className="py-2 text-muted-foreground/70">{dateShort(s.saleDate)}</td>
                        <td className="py-2 tabular-nums text-foreground">{money(s.amountCents, cur)}</td>
                        <td className="py-2"><LedgerBadge status={s.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TabsContent>

            <TabsContent value="activity" className="mt-3">
              <strong className="mb-2.5 block text-[13px]">Recent activity</strong>
              {d.recentLedger.length === 0 ? <Empty /> : (
                <table className="w-full border-collapse text-[12.5px]">
                  <thead><tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 font-medium">Date</th><th className="py-2 font-medium">Lvl</th><th className="py-2 font-medium">Type</th><th className="py-2 font-medium">Status</th><th className="py-2 text-right font-medium">Amount</th>
                  </tr></thead>
                  <tbody>
                    {d.recentLedger.map((e) => (
                      <tr key={e.id} className="border-t border-border">
                        <td className="py-2 text-muted-foreground/70">{dateShort(e.createdAt)}</td>
                        <td className="py-2 tabular-nums text-muted-foreground">{e.level}</td>
                        <td className="py-2 text-muted-foreground/70">{e.type}</td>
                        <td className="py-2"><LedgerBadge status={e.status} /></td>
                        <td className={cn('py-2 text-right tabular-nums', e.type === 'reversal' ? 'text-destructive' : 'text-foreground')}>{money(e.amountCents, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}

      {printing && d && p && (
        <PrintSheet onDone={() => setPrinting(false)}>
          <PrintHeader tenantName={tenantName} title="Member Statement" subtitle={`${p.fullName} · ${p.referralCode}`} />
          <table style={{ marginBottom: 16 }}>
            <tbody>
              <tr><td style={{ fontWeight: 700, width: 160 }}>Email</td><td>{p.email}</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Role / Status</td><td>{p.role} · {p.status}</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Level</td><td>{p.depth}</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Joined</td><td>{dateShort(p.joinedAt)}</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Direct referrals</td><td>{d.stats.directs}</td></tr>
            </tbody>
          </table>
          <div style={{ fontWeight: 700, margin: '8px 0' }}>Balance summary</div>
          <table style={{ marginBottom: 16 }}>
            <tbody>
              <tr><td>Pending</td><td style={{ textAlign: 'right' }}>{money(d.stats.commission.pendingCents, cur)}</td></tr>
              <tr><td>Payable</td><td style={{ textAlign: 'right' }}>{money(d.stats.commission.payableCents, cur)}</td></tr>
              <tr><td>Paid</td><td style={{ textAlign: 'right' }}>{money(d.stats.commission.paidCents, cur)}</td></tr>
            </tbody>
          </table>
          {d.recentLedger.length > 0 && (
            <>
              <div style={{ fontWeight: 700, margin: '8px 0' }}>Recent activity</div>
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {d.recentLedger.map((e) => (
                    <tr key={e.id}><td>{dateShort(e.createdAt)}</td><td>{e.type}</td><td>{e.status}</td><td style={{ textAlign: 'right' }}>{money(e.amountCents, cur)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </PrintSheet>
      )}
    </Drawer>
  );
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <div className="text-[11px] text-muted-foreground/70">{label}</div>
      <div className="mt-1 font-display text-lg font-bold tabular-nums text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground/70">{hint}</div>}
    </div>
  );
}

function Chip({ label, value, tone }: { label: string; value: string; tone: 'pending' | 'payable' | 'paid' }) {
  const cls = tone === 'pending'
    ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
    : tone === 'payable'
      ? 'border-primary/30 bg-primary/10 text-primary'
      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400';
  return <span className={cn('rounded-lg border px-2.5 py-1 text-xs font-semibold tabular-nums', cls)}>{label}: {value}</span>;
}

function LedgerBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    paid: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    payable: 'border-primary/30 bg-primary/10 text-primary',
    pending: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    draft: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    void: 'border-destructive/30 bg-destructive/10 text-destructive',
    reversed: 'border-destructive/30 bg-destructive/10 text-destructive',
  };
  const cls = map[status] ?? 'border-border bg-muted text-muted-foreground';
  return <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold', cls)}>{status}</span>;
}

function Empty() { return <div className="text-[13px] text-muted-foreground">Nothing yet.</div>; }
