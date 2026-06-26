'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Bars, CountUp, Loading, MoneyCounter, StatCard, useToast } from '@/components/ui';
import { RadialNetwork } from '@/components/RadialNetwork';
import { EarningsSimulator } from '@/components/EarningsSimulator';
import { money, dateShort } from '@/lib/format';
import { t } from '@/lib/i18n';

/** 'YYYY-MM' → kisa ay etiketi (ör. 'Jun'). */
function monthShort(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short' });
}

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

interface EarnSummary { currency: string; earnedThisMonthCents: string; soldThisMonthCents: string; soldLifetimeCents: string }

interface Recruit {
  id: string; fullName: string; email: string; referralCode: string;
  status: string; joinedAt: string; salesThisMonth: number; soldThisMonthCents: string; needsNudge: boolean;
}
interface RecruitsResponse {
  month: string; currency: string; recruits: Recruit[];
  summary: { total: number; active: number; needsNudgeCount: number; joinedThisMonth: number };
  growthTrend: Array<{ month: string; joined: number }>;
}

export default function TeamPage() {
  const [team, setTeam] = useState<Team | null>(null);
  const [earn, setEarn] = useState<EarnSummary | null>(null);
  const [recruits, setRecruits] = useState<RecruitsResponse | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

  function nudge(r: Recruit) {
    // MVP: recruit e-postasini panoya kopyala (gercek bildirim gondermez — net mesaj).
    if (r.email && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(r.email).then(() => showToast(`${r.fullName}'s email copied — send them a message`)).catch(() => showToast('Could not copy'));
    }
  }

  useEffect(() => {
    api.get<Team>('/app/team').then(setTeam).catch((e) => setError(String((e as ApiError).message)));
    api.get<EarnSummary>('/app/dashboard').then(setEarn).catch(() => { /* optional */ });
    api.get<RecruitsResponse>('/app/team/recruits').then(setRecruits).catch(() => { /* optional */ });
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
        {earn && <StatCard label="Earned (this month)" value={<MoneyCounter cents={Number(earn.earnedThisMonthCents)} currency={earn.currency} />} icon="◆" grad="var(--foil)" hint={`${money(earn.soldThisMonthCents, earn.currency)} sold this month`} />}
        {earn && <StatCard label="Sold (lifetime)" value={<MoneyCounter cents={Number(earn.soldLifetimeCents)} currency={earn.currency} />} icon="◇" />}
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
            <div className="muted" style={{ textAlign: 'center', padding: '18px 0' }}>
              Your team is empty.<br />
              <span className="faint" style={{ fontSize: 12.5 }}>Invite people and you&apos;ll earn a share of their sales, too.</span>
            </div>
          )}
          <div className="row" style={{ gap: 16, marginTop: 'auto', paddingTop: 16, fontSize: 12 }}>
            <span className="row" style={{ gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--emerald)' }} /> Active {team.totalActive}</span>
            <span className="row" style={{ gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 999, background: 'hsl(var(--muted-foreground))' }} /> Inactive {inactive}</span>
          </div>
        </div>
      </div>

      {/* ---- Direkt recruit'ler: uyenin kendi davet ettikleri (isimli) ---- */}
      {recruits && (
        <div className="card fade-in delay-3" style={{ marginTop: 16 }}>
          <div className="spread" style={{ alignItems: 'flex-start', marginBottom: 4 }}>
            <div>
              <strong style={{ fontSize: 15 }}>Your direct recruits</strong>
              <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
                People you personally invited
                {recruits.summary.joinedThisMonth > 0 && <span style={{ color: 'var(--emerald)', fontWeight: 600 }}> · +{recruits.summary.joinedThisMonth} this month</span>}
              </div>
            </div>
            <Link href="/app/invite" className="btn sm">✦ Invite</Link>
          </div>

          {recruits.summary.needsNudgeCount > 0 && (
            <div className="row" style={{ gap: 8, padding: '8px 12px', borderRadius: 10, margin: '8px 0 12px', fontSize: 13,
              background: 'color-mix(in srgb, var(--amber) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 32%, transparent)' }}>
              <span aria-hidden>👋</span>
              <span><strong>{recruits.summary.needsNudgeCount}</strong> active teammate{recruits.summary.needsNudgeCount > 1 ? 's' : ''} haven&apos;t sold this month — a quick nudge can help them get started.</span>
            </div>
          )}

          {recruits.recruits.length > 0 && recruits.growthTrend.some((g) => g.joined > 0) && (
            <div style={{ margin: '8px 0 14px' }}>
              <div className="faint" style={{ fontSize: 11, marginBottom: 6 }}>New direct recruits — last 6 months</div>
              <Bars data={recruits.growthTrend.map((g) => ({ label: monthShort(g.month), value: g.joined }))} />
            </div>
          )}

          {recruits.recruits.length === 0 ? (
            <div className="muted" style={{ textAlign: 'center', padding: '22px 0' }}>
              You haven&apos;t invited anyone yet.<br />
              <Link href="/app/invite" className="btn sm" style={{ marginTop: 12, display: 'inline-block' }}>Send your first invite →</Link>
            </div>
          ) : (
            <table>
              <thead><tr><th>Member</th><th>Status</th><th>Joined</th><th style={{ textAlign: 'right' }}>Sales (mo)</th><th style={{ textAlign: 'right' }}>Sold (mo)</th><th></th></tr></thead>
              <tbody>
                {recruits.recruits.map((r) => (
                  <tr key={r.id} style={r.needsNudge ? { background: 'color-mix(in srgb, var(--amber) 6%, transparent)' } : undefined}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{r.fullName}</div>
                      <div className="faint" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{r.referralCode}</div>
                    </td>
                    <td><span className={`badge ${r.status === 'active' ? 'active' : 'inactive'}`} style={{ fontSize: 9 }}>{r.status}</span></td>
                    <td className="faint" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{dateShort(r.joinedAt)}</td>
                    <td className="tnum" style={{ textAlign: 'right' }}>{r.salesThisMonth || '—'}</td>
                    <td className="tnum" style={{ textAlign: 'right', fontWeight: 600, color: Number(r.soldThisMonthCents) > 0 ? 'var(--gold-500)' : 'var(--faint)' }}>
                      {Number(r.soldThisMonthCents) > 0 ? money(r.soldThisMonthCents, recruits.currency) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.needsNudge && <button className="btn ghost sm" onClick={() => nudge(r)} title={`Copy ${r.fullName}'s email`}>👋 Nudge</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <EarningsSimulator />

      <div className="faint fade-in" style={{ fontSize: 11, marginTop: 16 }}>
        Your <strong>direct recruits</strong> — the people you personally invited — are shown by name above.
        Deeper levels of your network are shared only as aggregate counts per level, never individual details.
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
