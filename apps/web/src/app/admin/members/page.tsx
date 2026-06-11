'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { dateShort } from '@/lib/format';
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
interface MembersList {
  total: number;
  items: MemberItem[];
}

const ROLES = ['member', 'tenant_staff', 'tenant_admin'];

export default function MembersPage() {
  const [list, setList] = useState<MembersList | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [sponsor, setSponsor] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api.get<MembersList>('/admin/members?pageSize=100'));
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const res = await api.post<{ code: string }>('/admin/members/invite', sponsor.trim() ? { sponsorReferralCode: sponsor.trim() } : {});
      setInviteCode(res.code);
      flash('Davet olusturuldu');
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }

  async function toggleStatus(m: MemberItem) {
    try {
      await api.post(`/admin/members/${m.id}/${m.status === 'active' ? 'deactivate' : 'activate'}`);
      await load();
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }

  async function changeRole(m: MemberItem, role: string) {
    try {
      await api.post(`/admin/members/${m.id}/role`, { role });
      flash('Rol guncellendi');
      await load();
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }

  const inviteUrl = inviteCode ? `${typeof window !== 'undefined' ? window.location.origin : ''}/i/${inviteCode}` : '';

  return (
    <div>
      <h1 className="h1">{t('nav.members')}</h1>

      <form className="card" onSubmit={invite} style={{ marginBottom: 18 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label>Sponsor referral kodu (bos = kendiniz)</label>
            <input value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder="ORN: ALICE1" />
          </div>
          <button className="btn">{t('members.invite')}</button>
        </div>
        {inviteCode && (
          <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
            Davet linki: <span style={{ color: 'var(--accent)' }}>{inviteUrl}</span>
          </div>
        )}
      </form>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Uye</th>
              <th>Kod</th>
              <th>Sponsor</th>
              <th>Sev.</th>
              <th>{t('members.role')}</th>
              <th>Durum</th>
              <th>Katilim</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {list?.items.map((m) => (
              <tr key={m.id}>
                <td>{m.fullName}<div className="muted" style={{ fontSize: 12 }}>{m.email}</div></td>
                <td>{m.referralCode}</td>
                <td className="muted">{m.sponsorReferralCode ?? '—'}</td>
                <td>{m.depth}</td>
                <td>
                  {m.role === 'tenant_owner' ? (
                    <span className="muted">owner</span>
                  ) : (
                    <select value={m.role} onChange={(e) => changeRole(m, e.target.value)} style={{ width: 130 }}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}
                </td>
                <td><span className={`badge ${m.status}`}>{m.status}</span></td>
                <td>{dateShort(m.joinedAt)}</td>
                <td>
                  {m.role !== 'tenant_owner' && (
                    <button className="btn sm ghost" onClick={() => toggleStatus(m)}>
                      {m.status === 'active' ? t('members.deactivate') : t('members.activate')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
