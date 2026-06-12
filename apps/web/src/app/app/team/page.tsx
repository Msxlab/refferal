'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Bars, CountUp, Loading, StatCard } from '@/components/ui';
import { RadialNetwork } from '@/components/RadialNetwork';
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
  if (!team) return <Loading />;

  const inactive = team.totalMembers - team.totalActive;

  return (
    <div>
      <div className="eyebrow fade-in">{t('anav.team')}</div>
      <h1 className="h1 fade-in">My Network</h1>
      <p className="sub fade-in">Your downline at a glance — sized by level, shaded by activity.</p>

      <div className="stat-grid fade-in delay-1" style={{ marginBottom: 16 }}>
        <StatCard label={t('me.members')} value={<CountUp value={team.totalMembers} />} icon="⬡" grad="var(--grad-primary)" />
        <StatCard label={t('me.activeMembers')} value={<CountUp value={team.totalActive} />} icon="✓" grad="var(--grad-emerald)" />
      </div>

      <div className="grid fade-in delay-2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,300px)', gap: 16, alignItems: 'stretch' }}>
        <div className="card" style={{ display: 'grid', placeItems: 'center', padding: 18 }}>
          <RadialNetwork levels={team.levels} totalMembers={team.totalMembers} />
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="spread" style={{ marginBottom: 14 }}>
            <strong>Level distribution</strong>
          </div>
          {team.levels.some((l) => l.memberCount > 0) ? (
            <Bars data={team.levels.map((l) => ({ label: `Level ${l.level}`, value: l.memberCount }))} />
          ) : (
            <div className="muted">{t('me.noData')}</div>
          )}
          <div className="row" style={{ gap: 16, marginTop: 'auto', paddingTop: 16, fontSize: 12 }}>
            <span className="row" style={{ gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--emerald)' }} /> Active {team.totalActive}</span>
            <span className="row" style={{ gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--muted)' }} /> Inactive {inactive}</span>
          </div>
        </div>
      </div>

      <div className="faint fade-in" style={{ fontSize: 11, marginTop: 16 }}>
        For privacy, individual member or sales details are never shared — only aggregate counts per level.
      </div>
    </div>
  );
}
