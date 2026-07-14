'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Bars, CountUp, Loading } from '@/components/ui';
import { RadialNetwork } from '@/components/RadialNetwork';
import { t } from '@/lib/i18n';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

  if (error) {
    return (
      <Alert variant="destructive" className="fade-in">
        <AlertCircle />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!team) return <Loading />;

  const inactive = team.totalMembers - team.totalActive;

  return (
    <div>
      <div className="eyebrow fade-in">{t('anav.team')}</div>
      <h1 className="h1 fade-in">My Network</h1>
      <p className="sub fade-in">Your downline at a glance, sized by level and shaded by activity.</p>

      <div className="mb-4 grid gap-4 fade-in delay-1 sm:grid-cols-2">
        <TeamStat label={t('me.members')} value={<CountUp value={team.totalMembers} />} Icon={Users} />
        <TeamStat label={t('me.activeMembers')} value={<CountUp value={team.totalActive} />} Icon={CheckCircle2} />
      </div>

      <div className="grid gap-4 fade-in delay-2 lg:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
        <Card>
          <CardContent className="grid min-h-[320px] place-items-center">
            <RadialNetwork levels={team.levels} totalMembers={team.totalMembers} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Level distribution</CardTitle></CardHeader>
          <CardContent className="flex min-h-[320px] flex-col">
            {team.levels.some((l) => l.memberCount > 0) ? <Bars data={team.levels.map((l) => ({ label: `Level ${l.level}`, value: l.memberCount }))} /> : <div className="text-sm text-muted-foreground">{t('me.noData')}</div>}
            <div className="mt-auto flex flex-wrap gap-4 pt-4 text-xs">
              <Legend color="var(--emerald)" label={`Active ${team.totalActive}`} />
              <Legend color="var(--muted)" label={`Inactive ${inactive}`} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 text-[11px] text-muted-foreground fade-in">For privacy, individual member or sales details are never shared; only aggregate counts per level.</div>
    </div>
  );
}

function TeamStat({ label, value, Icon }: { label: string; value: ReactNode; Icon: typeof Users }) {
  return (
    <Card>
      <CardContent className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span>
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-2"><i className="size-2.5 rounded-full" style={{ background: color }} />{label}</span>;
}