'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';

interface TeamLevel {
  level: number;
  memberCount: number;
  activeCount: number;
}
interface Team {
  totalMembers: number;
  totalActive: number;
  levels: TeamLevel[];
}

export default function TeamPage() {
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Team>('/app/team').then(setTeam).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!team) return <div className="muted">{t('common.loading')}</div>;

  return (
    <div>
      <h1 className="h1">{t('me.teamTitle')}</h1>

      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <div className="card stat">
          <div className="k">{t('me.members')}</div>
          <div className="v">{team.totalMembers}</div>
        </div>
        <div className="card stat">
          <div className="k">{t('me.activeMembers')}</div>
          <div className="v">{team.totalActive}</div>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>{t('me.level')}</th><th>{t('me.members')}</th><th>{t('me.activeMembers')}</th></tr>
          </thead>
          <tbody>
            {team.levels.map((l) => (
              <tr key={l.level}>
                <td>L{l.level}</td>
                <td>{l.memberCount}</td>
                <td>{l.activeCount}</td>
              </tr>
            ))}
            {team.levels.length === 0 && <tr><td colSpan={3} className="muted">{t('me.noData')}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 14 }}>
        Gizlilik: yalnizca seviye basina ozet gosterilir; bireysel uye satis bilgisi paylasilmaz.
      </div>
    </div>
  );
}
