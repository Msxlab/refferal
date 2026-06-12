'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Confirm, Loading, useToast } from '@/components/ui';
import { dateShort } from '@/lib/format';
import { t } from '@/lib/i18n';

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
interface MembersList { total: number; items: MemberItem[] }
const ROLES = ['member', 'tenant_staff', 'tenant_admin'];

export default function MembersPage() {
  const [list, setList] = useState<MembersList | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [sponsor, setSponsor] = useState('');
  const [latest, setLatest] = useState<string | null>(null);
  const [confirmM, setConfirmM] = useState<MemberItem | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
      setList(await api.get<MembersList>(`/admin/members?pageSize=100${q}`));
    } catch (e) { setError(String((e as ApiError).message)); }
  }, [search]);

  useEffect(() => { void load(); }, [load]);

  async function invite(e: FormEvent) {
    e.preventDefault(); setError('');
    try {
      const res = await api.post<{ code: string }>('/admin/members/invite', sponsor.trim() ? { sponsorReferralCode: sponsor.trim() } : {});
      setLatest(res.code);
      showToast('Invitation created ✓');
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
    try { await api.post(`/admin/members/${m.id}/role`, { role }); showToast('Role updated'); await load(); }
    catch (e) { setError(String((e as ApiError).message)); }
  }

  const inviteUrl = latest ? `${typeof window !== 'undefined' ? window.location.origin : ''}/i/${latest}` : '';

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.members')}</div>
      <h1 className="h1 fade-in">Member Management</h1>
      <p className="sub fade-in">Invite members, assign roles, deactivate. Placement is permanent.</p>

      <form className="card fade-in delay-1" onSubmit={invite} style={{ marginBottom: 16 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label>Sponsor referral code (blank = yourself)</label>
            <input value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder="e.g. ALICE1" />
          </div>
          <button className="btn">✦ {t('members.invite')}</button>
        </div>
        {latest && (
          <div className="card" style={{ background: 'rgba(124,139,255,.08)', marginTop: 12, padding: 12 }}>
            <div className="row spread">
              <span style={{ color: 'var(--primary)', wordBreak: 'break-all' }}>{inviteUrl}</span>
              <button type="button" className="btn ghost sm" onClick={() => { navigator.clipboard.writeText(inviteUrl); showToast('Copied ✓'); }}>Copy</button>
            </div>
          </div>
        )}
      </form>

      {error && <div className="error">{error}</div>}

      <div className="card fade-in delay-2">
        <div className="spread" style={{ marginBottom: 12 }}>
          <strong>Members {list && <span className="faint">({list.total})</span>}</strong>
          <input placeholder="Search: name, email, code" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 240 }} />
        </div>
        {!list ? <Loading rows={4} /> : (
          <table>
            <thead><tr><th>Member</th><th>Code</th><th>Sponsor</th><th>Lvl.</th><th>{t('members.role')}</th><th>Status</th><th style={{ textAlign: 'right' }}>{t('common.actions')}</th></tr></thead>
            <tbody>
              {list.items.map((m) => (
                <tr key={m.id}>
                  <td>{m.fullName}<div className="faint" style={{ fontSize: 12 }}>{m.email}</div></td>
                  <td style={{ fontFamily: 'ui-monospace, monospace' }}>{m.referralCode}</td>
                  <td className="faint">{m.sponsorReferralCode ?? '—'}</td>
                  <td>{m.depth}</td>
                  <td>
                    {m.role === 'tenant_owner' ? <span className="faint">owner</span> : (
                      <select value={m.role} onChange={(e) => changeRole(m, e.target.value)} style={{ width: 134 }}>
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                  </td>
                  <td><span className={`badge ${m.status}`}>{m.status}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    {m.role !== 'tenant_owner' && (
                      <button className="btn ghost sm" onClick={() => setConfirmM(m)}>
                        {m.status === 'active' ? t('members.deactivate') : t('members.activate')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
