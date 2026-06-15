'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { ColumnsMenu, Confirm, Loading, Modal, Pagination, SortableTh, SortDir, TableColumn, useTablePrefs, useToast } from '@/components/ui';
import { Drawer } from '@/components/Drawer';
import { PrintSheet, PrintHeader } from '@/components/PrintSheet';
import { activeMembership, getSession, isAdminRole, startImpersonation, type Session } from '@/lib/auth';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';

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
  { key: 'role', label: 'Role' },
  { key: 'status', label: 'Status' },
  { key: 'joined', label: 'Joined' },
];

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
    try { await api.post(`/admin/members/${m.id}/role`, { role }); showToast('Role updated'); await load(); }
    catch (e) { setError(String((e as ApiError).message)); }
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

  return (
    <div>
      <div className="spread">
        <div>
          <div className="eyebrow fade-in">{t('nav.members')}</div>
          <h1 className="h1 fade-in">Member Management</h1>
          <p className="sub fade-in">Invite members, assign roles, deactivate. Placement is permanent.
            {nps && nps.total > 0 && nps.nps != null && <span className="badge active" style={{ marginLeft: 8 }}>NPS {nps.nps} · {nps.total} responses</span>}
            {funnel && funnel.views > 0 && <span className="badge payable" style={{ marginLeft: 8 }}>Invite funnel: {funnel.views} views → {funnel.signups} signups{funnel.conversionPct != null ? ` (${funnel.conversionPct}%)` : ''}</span>}
          </p>
        </div>
        <div className="row fade-in no-print" style={{ gap: 8 }}>
          <button className="btn ghost" onClick={exportCsv}>⇩ Export CSV</button>
          <button className="btn ghost" onClick={() => { setError(''); setAddName(''); setAddEmail(''); setAddSponsor(''); setAddRole('member'); setAddAsLeader(false); setAddResult(null); setShowAdd(true); }}>＋ Add member</button>
          <button className="btn" onClick={() => { setLatest(null); setShowInvite(true); }}>✦ {t('members.invite')}</button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="row fade-in delay-1 no-print" style={{ margin: '14px 0', gap: 10, flexWrap: 'wrap' }}>
        <input placeholder="🔍  Search name, email or code…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ flex: 1, maxWidth: 320 }} />
        <div className="seg-tabs">
          {STATUS_TABS.map(([v, lbl]) => (
            <button key={v} className={`seg-tab ${status === v ? 'on' : ''}`} onClick={() => { setStatus(v); setPage(1); }}>{lbl}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <ColumnsMenu prefs={cols} />
      </div>

      <div className="card fade-in delay-2">
        <div className="spread" style={{ marginBottom: 12 }}>
          <strong>Members {list && <span className="faint">({list.total})</span>}</strong>
        </div>
        {!list ? <Loading rows={4} /> : (
          <table className={cols.density === 'compact' ? 'dense' : undefined}>
            <thead><tr>
              <th className="no-print" style={{ width: 30 }}><input type="checkbox" checked={selected.size > 0 && selected.size === list.items.length} onChange={toggleAll} aria-label="Select all" /></th>
              {cols.isVisible('member') && <SortableTh label="Member" field="fullName" sort={sort} dir={dir} onSort={onSort} />}
              {cols.isVisible('code') && <th>Code</th>}
              {cols.isVisible('sponsor') && <th>Sponsor</th>}
              {cols.isVisible('level') && <SortableTh label="Lvl." field="depth" sort={sort} dir={dir} onSort={onSort} />}
              {cols.isVisible('role') && <th>{t('members.role')}</th>}
              {cols.isVisible('status') && <th>Status</th>}
              {cols.isVisible('joined') && <SortableTh label="Joined" field="joinedAt" sort={sort} dir={dir} onSort={onSort} />}
              <th className="no-print" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
            </tr></thead>
            <tbody>
              {list.items.map((m) => (
                <tr key={m.id} style={{ cursor: 'pointer', background: selected.has(m.id) ? 'var(--panel-2)' : undefined }} onClick={() => setDetailId(m.id)}>
                  <td className="no-print" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Select ${m.fullName}`} />
                  </td>
                  {cols.isVisible('member') && <td>{m.fullName}<div className="faint" style={{ fontSize: 12 }}>{m.email}</div></td>}
                  {cols.isVisible('code') && <td style={{ fontFamily: 'ui-monospace, monospace' }} onClick={(e) => e.stopPropagation()}><span className="row" style={{ gap: 4 }}>{m.referralCode}<button className="btn ghost sm" title="Copy code" style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => { navigator.clipboard.writeText(m.referralCode).then(() => showToast('Copied ✓')).catch(() => {}); }}>⧉</button></span></td>}
                  {cols.isVisible('sponsor') && (
                    <td onClick={(e) => e.stopPropagation()}>
                      {m.sponsorReferralCode
                        ? <button className="btn ghost sm" style={{ fontFamily: 'ui-monospace, monospace', padding: '3px 8px' }} onClick={() => openSponsor(m.sponsorReferralCode!)}>{m.sponsorReferralCode}</button>
                        : <span className="faint">—</span>}
                    </td>
                  )}
                  {cols.isVisible('level') && <td>{m.depth}</td>}
                  {cols.isVisible('role') && (
                    <td onClick={(e) => e.stopPropagation()}>
                      {m.role === 'tenant_owner' ? <span className="faint">Owner</span> : (
                        <select value={m.role} onChange={(e) => changeRole(m, e.target.value)} style={{ width: 134 }}>
                          {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                        </select>
                      )}
                    </td>
                  )}
                  {cols.isVisible('status') && <td><span className={`badge ${m.status}`}>{m.status}</span></td>}
                  {cols.isVisible('joined') && <td className="muted">{dateShort(m.joinedAt)}</td>}
                  <td className="no-print" style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <button className="btn ghost sm" title="Edit profile" onClick={() => { setError(''); setEditM(m); setEditName(m.fullName); setEditEmail(m.email); }}>✎</button>
                      {m.role !== 'tenant_owner' && (
                        <button className="btn ghost sm" onClick={() => setConfirmM(m)}>
                          {m.status === 'active' ? t('members.deactivate') : t('members.activate')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {list.items.length === 0 && <tr><td colSpan={colCount} className="muted">No members found.</td></tr>}
            </tbody>
          </table>
        )}

        {list && <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={setPage} />}

        {selected.size > 0 && (
          <div className="bulkbar no-print">
            <strong style={{ fontSize: 13 }}>{selected.size} selected</strong>
            <span style={{ flex: 1 }} />
            <button className="btn sm" disabled={selActivatable === 0} onClick={() => openBulk('activate')}>Activate {selActivatable || ''}</button>
            <button className="btn sm danger" disabled={selDeactivatable === 0} onClick={() => openBulk('deactivate')}>Deactivate {selDeactivatable || ''}</button>
            <span className="row" style={{ gap: 4 }}>
              <select value={bulkRole} onChange={(e) => setBulkRole(e.target.value)} style={{ width: 'auto' }} aria-label="Bulk role">
                {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
              <button className="btn sm ghost" onClick={() => openBulk('set_role')}>Set role</button>
            </span>
            <button className="btn ghost sm" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
      </div>

      {showInvite && (
        <Modal title="Invite a member" onClose={() => setShowInvite(false)}>
          <form onSubmit={invite} style={{ width: 'min(440px, 88vw)' }}>
            <div className="field">
              <label>Sponsor referral code (blank = yourself)</label>
              <input value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder="e.g. ALICE1" autoFocus />
            </div>
            {error && <div className="error">{error}</div>}
            {latest ? (
              <div className="card" style={{ background: 'rgba(124,139,255,.08)', padding: 12, marginTop: 4 }}>
                <div className="faint" style={{ fontSize: 11, marginBottom: 6 }}>Invite link — share it:</div>
                <div className="row spread" style={{ gap: 8 }}>
                  <span style={{ color: 'var(--sky)', wordBreak: 'break-all', fontSize: 12.5 }}>{inviteUrl}</span>
                  <button type="button" className="btn ghost sm" onClick={() => { navigator.clipboard.writeText(inviteUrl); showToast('Copied ✓'); }}>Copy</button>
                </div>
              </div>
            ) : null}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn ghost" onClick={() => setShowInvite(false)}>{latest ? 'Done' : 'Cancel'}</button>
              <button className="btn">✦ {latest ? 'New invite' : t('members.invite')}</button>
            </div>
          </form>
        </Modal>
      )}

      {showAdd && (
        <Modal title="Add member" onClose={() => setShowAdd(false)}>
          <div style={{ width: 'min(460px, 90vw)' }}>
            {addResult ? (
              <div>
                <div className="card" style={{ background: 'color-mix(in srgb, var(--emerald) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--emerald) 30%, transparent)', padding: 14 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>✓ Member added</div>
                  <div className="row spread" style={{ fontSize: 13 }}><span className="muted">Referral code</span><strong className="tnum">{addResult.referralCode}</strong></div>
                  {addResult.tempPassword ? (
                    <div style={{ marginTop: 8 }}>
                      <div className="faint" style={{ fontSize: 11, marginBottom: 4 }}>Temporary password (share it with them — shown only once):</div>
                      <div className="row spread" style={{ gap: 8 }}>
                        <span style={{ color: 'var(--gold-500)', fontFamily: 'var(--mono, monospace)', fontWeight: 700 }}>{addResult.tempPassword}</span>
                        <button className="btn ghost sm" onClick={() => { navigator.clipboard.writeText(addResult.tempPassword!).then(() => showToast('Copied ✓')).catch(() => {}); }}>Copy</button>
                      </div>
                    </div>
                  ) : <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>This email already exists — the person signs in with their existing password (a new membership was added).</div>}
                </div>
                <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                  <button type="button" className="btn ghost" onClick={() => { setAddResult(null); setAddName(''); setAddEmail(''); setAddSponsor(''); }}>Add another</button>
                  <button type="button" className="btn" onClick={() => setShowAdd(false)}>Done</button>
                </div>
              </div>
            ) : (
              <form onSubmit={createMember}>
                <div className="field"><label>Full name</label><input value={addName} onChange={(e) => setAddName(e.target.value)} required minLength={2} autoFocus placeholder="e.g. Jane Smith" /></div>
                <div className="field"><label>Email</label><input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} required placeholder="name@company.com" /></div>
                <div className="row" style={{ gap: 12 }}>
                  <div className="field" style={{ flex: 2, margin: 0 }}><label>Sponsor code {addAsLeader ? '(leader — no sponsor)' : '(blank = owner)'}</label><input value={addSponsor} onChange={(e) => setAddSponsor(e.target.value)} placeholder="e.g. ALICE1" disabled={addAsLeader} /></div>
                  <div className="field" style={{ flex: 1, margin: 0 }}><label>Role</label><select value={addRole} onChange={(e) => setAddRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</select></div>
                </div>
                <label className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 13, margin: '4px 0 8px' }}>
                  <input type="checkbox" checked={addAsLeader} onChange={(e) => setAddAsLeader(e.target.checked)} style={{ width: 'auto' }} />
                  🎖 Add as a new team leader (top of the tree, no sponsor)
                </label>
                <div className="faint" style={{ fontSize: 12 }}>A temporary password is generated; the person signs in with it and changes it. (Placement is permanent.)</div>
                {error && <div className="error">{error}</div>}
                <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                  <button type="button" className="btn ghost" onClick={() => setShowAdd(false)} disabled={busy}>Cancel</button>
                  <button className="btn" disabled={busy}>{busy ? 'Adding…' : '＋ Add member'}</button>
                </div>
              </form>
            )}
          </div>
        </Modal>
      )}

      {editM && (
        <Modal title={`Edit profile — ${editM.fullName}`} onClose={() => setEditM(null)}>
          <form onSubmit={saveProfile} style={{ width: 'min(420px, 90vw)' }}>
            <div className="field"><label>Full name</label><input value={editName} onChange={(e) => setEditName(e.target.value)} required minLength={2} autoFocus /></div>
            <div className="field"><label>Email</label><input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required /></div>
            <div className="faint" style={{ fontSize: 12 }}>Changing the email requires the person to re-verify. Placement (sponsor) does not change.</div>
            {error && <div className="error">{error}</div>}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn ghost" onClick={() => setEditM(null)} disabled={busy}>Cancel</button>
              <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
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
          <div style={{ width: 'min(420px, 88vw)' }}>
            <p className="muted" style={{ marginTop: 0 }}>
              {pendingBulk.action === 'set_role' ? `Set role to "${pendingBulk.role}" for selected members.`
                : pendingBulk.action === 'activate' ? 'Activate selected members.' : 'Deactivate selected members.'}
            </p>
            <div className="grid" style={{ gap: 8, margin: '12px 0' }}>
              <div className="spread"><span className="muted" style={{ fontSize: 13 }}>Selected</span><b className="tnum">{preview.total}</b></div>
              <div className="spread"><span className="muted" style={{ fontSize: 13 }}>Will change</span><b className="tnum" style={{ color: 'var(--emerald)' }}>{preview.willChange}</b></div>
              <div className="spread"><span className="muted" style={{ fontSize: 13 }}>Skipped (no-op / protected)</span><b className="tnum faint">{preview.skipped.length}</b></div>
              {preview.openPayoutRequests > 0 && (
                <div className="spread" style={{ color: 'var(--amber)' }}><span style={{ fontSize: 13 }}>⚠ In open payout request</span><b className="tnum">{preview.openPayoutRequests}</b></div>
              )}
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button className="btn ghost" onClick={() => { setPendingBulk(null); setPreview(null); }} disabled={busy}>Cancel</button>
              <button className={`btn ${pendingBulk.action === 'deactivate' ? 'danger' : ''}`} onClick={applyBulk} disabled={busy || preview.willChange === 0}>
                {busy ? 'Applying…' : `Apply to ${preview.willChange}`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {detailId && <MemberDrawer id={detailId} onClose={() => setDetailId(null)} onNavigate={setDetailId} onChanged={load} onToast={showToast} />}

      {toast && <div className="toast" role="status">{toast}</div>}
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
    try { await api.post(`/admin/members/${id}/role`, { role }); onToast('Role updated'); load(); onChanged(); }
    catch (e) { setErr(String((e as ApiError).message)); }
  }

  const cur = 'USD';
  const p = d?.profile;

  return (
    <Drawer
      title={p ? p.fullName : 'Member'}
      subtitle={p ? `${p.referralCode} · ${p.email}` : undefined}
      onClose={onClose}
      footer={p && (
        <>
          <button className="btn ghost" disabled={busy} onClick={() => setPrinting(true)}>🖶 Print summary</button>
          {meIsAdmin && <button className="btn ghost" disabled={busy} onClick={exportData}>⇩ Export data</button>}
          {meIsAdmin && p.role !== 'tenant_owner' && p.role !== 'tenant_admin' && (
            <button className="btn ghost" disabled={busy} onClick={viewAsMember}>👁 View as member</button>
          )}
          {p.role !== 'tenant_owner' && (
            <select value={p.role} onChange={(e) => changeRole(e.target.value)} style={{ width: 140 }}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          {p.role !== 'tenant_owner' && (
            <button className={`btn ${p.status === 'active' ? 'danger' : ''}`} disabled={busy} onClick={() => setStatus(p.status === 'active' ? 'deactivate' : 'activate')}>
              {p.status === 'active' ? 'Deactivate' : 'Activate'}
            </button>
          )}
        </>
      )}
    >
      {err && <div className="error">{err}</div>}
      {!d || !p ? <Loading rows={4} /> : (
        <div className="grid" style={{ gap: 18 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className={`badge ${p.status}`}>{p.status}</span>
            <span className="badge active" style={{ background: 'color-mix(in srgb, var(--sky) 14%, transparent)', color: 'var(--sky)' }}>{p.role.replace('tenant_', '')}</span>
            {p.emailVerified && <span className="badge active">email verified</span>}
            <span className="faint" style={{ fontSize: 12 }}>· level {p.depth} · joined {dateShort(p.joinedAt)}</span>
          </div>

          {/* 4 mini stat */}
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Mini label="Direct referrals" value={String(d.stats.directs)} hint={`${d.stats.invites.used}/${d.stats.invites.total} invites used`} />
            <Mini label="Sales this month" value={String(d.stats.sales.thisMonth.count)} hint={money(d.stats.sales.thisMonth.cents, cur)} />
            <Mini label="All-time revenue" value={money(d.stats.sales.allTime.cents, cur)} hint={`${d.stats.sales.allTime.count} approved`} />
            <Mini label="Commission paid" value={money(d.stats.commission.paidCents, cur)} hint="lifetime" />
          </div>

          {/* bakiye cipleri */}
          <div className="row" style={{ gap: 8 }}>
            <Chip label="Pending" value={money(d.stats.commission.pendingCents, cur)} cls="pending" />
            <Chip label="Payable" value={money(d.stats.commission.payableCents, cur)} cls="payable" />
            <Chip label="Paid" value={money(d.stats.commission.paidCents, cur)} cls="paid" />
          </div>

          {p.sponsor && (
            <div>
              <div className="faint" style={{ fontSize: 11, marginBottom: 4 }}>Sponsor</div>
              <button className="btn ghost sm" onClick={() => onNavigate(p.sponsor!.membershipId)}>
                {p.sponsor.name} · {p.sponsor.code} ↗
              </button>
            </div>
          )}

          <Section title="Recent sales">
            {d.recentSales.length === 0 ? <Empty /> : (
              <table>
                <thead><tr><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {d.recentSales.map((s) => (
                    <tr key={s.id}><td className="muted">{dateShort(s.saleDate)}</td><td className="tnum">{money(s.amountCents, cur)}</td><td><span className={`badge ${s.status}`}>{s.status}</span></td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Recent activity">
            {d.recentLedger.length === 0 ? <Empty /> : (
              <table>
                <thead><tr><th>Date</th><th>Lvl</th><th>Type</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {d.recentLedger.map((e) => (
                    <tr key={e.id}>
                      <td className="muted">{dateShort(e.createdAt)}</td>
                      <td className="tnum">{e.level}</td>
                      <td className="faint">{e.type}</td>
                      <td><span className={`badge ${e.status}`}>{e.status}</span></td>
                      <td className="tnum" style={{ textAlign: 'right', color: e.type === 'reversal' ? 'var(--rose)' : undefined }}>{money(e.amountCents, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
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
    <div className="card" style={{ padding: 12 }}>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div className="tnum" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}
function Chip({ label, value, cls }: { label: string; value: string; cls: string }) {
  return <span className={`badge ${cls}`} style={{ fontSize: 12 }}>{label}: {value}</span>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>{title}</strong>
      {children}
    </div>
  );
}
function Empty() { return <div className="muted" style={{ fontSize: 13 }}>Nothing yet.</div>; }
