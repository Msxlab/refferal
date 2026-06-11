'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Bars, CountUp, Loading, StatCard } from '@/components/ui';
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

  return (
    <div>
      <div className="eyebrow fade-in">{t('anav.team')}</div>
      <h1 className="h1 fade-in">{t('me.teamTitle')}</h1>
      <p className="sub fade-in">Gizlilik geregi yalnizca seviye basina ozet gosterilir.</p>

      <div className="stat-grid fade-in delay-1" style={{ marginBottom: 16 }}>
        <StatCard label={t('me.members')} value={<CountUp value={team.totalMembers} />} icon="⬡" grad="var(--grad-primary)" />
        <StatCard label={t('me.activeMembers')} value={<CountUp value={team.totalActive} />} icon="✓" grad="var(--grad-emerald)" />
      </div>

      <div className="card fade-in delay-2">
        <div className="spread" style={{ marginBottom: 14 }}>
          <strong>Seviye dagilimi</strong>
          <span className="faint" style={{ fontSize: 12 }}>Her seviyedeki kisi sayisi</span>
        </div>
        {team.levels.length > 0 ? (
          <Bars data={team.levels.map((l) => ({ label: `Seviye ${l.level}`, value: l.memberCount }))} />
        ) : (
          <div className="muted">{t('me.noData')}</div>
        )}
      </div>

      <div className="faint fade-in" style={{ fontSize: 11, marginTop: 16 }}>
        Bireysel uye veya satis bilgisi paylasilmaz; yalnizca toplam sayilar gosterilir.
      </div>
    </div>
  );
}
