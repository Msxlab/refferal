'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Bars, Donut, Loading, MoneyCounter } from '@/components/ui';
import { dateShort, money, levelLabel } from '@/lib/format';
import { t } from '@/lib/i18n';

interface LevelRow {
  level: number;
  pendingCents: string;
  payableCents: string;
  paidCents: string;
}
interface Dashboard {
  month: string;
  currency: string;
  totals: { pendingCents: string; payableCents: string; paidCents: string };
  levels: LevelRow[];
}
interface EarningsPoint { month: string; totalCents: string }
interface Earnings { months: number; currency: string; series: EarningsPoint[] }
interface CampaignStanding { rank: number; membershipId: string; name: string; code: string; score: number; bonusCents: number }
interface MyCampaign {
  id: string; name: string; metric: string; endsAt: string;
  myRank: number | null; myScore: number; prizes: { rank: number; bonusCents: number }[]; leaderboard: CampaignStanding[];
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

export default function MemberDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [campaigns, setCampaigns] = useState<MyCampaign[]>([]);
  const [rankInfo, setRankInfo] = useState<{ rank: number | null; total: number; topPercent: number | null } | null>(null);
  const [onboarding, setOnboarding] = useState<{ steps: { key: string; label: string; done: boolean }[]; percent: number } | null>(null);
  const [rank, setRank] = useState<{ current: string | null; next: string | null; overallPct: number; overrideBps?: number; badges: { key: string; label: string; earned: boolean }[] } | null>(null);
  const [announcements, setAnnouncements] = useState<{ id: string; title: string; body: string; createdAt: string; read: boolean }[]>([]);
  const [npsPrompt, setNpsPrompt] = useState(false);
  const [npsScore, setNpsScore] = useState<number | null>(null);
  const [npsComment, setNpsComment] = useState('');
  const [npsDone, setNpsDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Dashboard>('/app/dashboard').then(setData).catch((e) => setError(String((e as ApiError).message)));
    api.get<Earnings>('/app/earnings?months=6').then(setEarnings).catch(() => { /* grafik opsiyonel */ });
    api.get<MyCampaign[]>('/app/campaigns').then(setCampaigns).catch(() => { /* opsiyonel */ });
    api.get<{ rank: number | null; total: number; topPercent: number | null }>('/app/leaderboard').then(setRankInfo).catch(() => { /* opsiyonel */ });
    api.get<{ shouldPrompt: boolean }>('/app/survey').then((s) => setNpsPrompt(s.shouldPrompt)).catch(() => { /* opsiyonel */ });
    api.get<{ steps: { key: string; label: string; done: boolean }[]; percent: number }>('/app/onboarding').then(setOnboarding).catch(() => { /* opsiyonel */ });
    api.get<{ current: string | null; next: string | null; overallPct: number; overrideBps?: number; badges: { key: string; label: string; earned: boolean }[] }>('/app/rank').then(setRank).catch(() => { /* opsiyonel */ });
    api.get<{ id: string; title: string; body: string; createdAt: string; read: boolean }[]>('/app/announcements').then(setAnnouncements).catch(() => { /* opsiyonel */ });
  }, []);

  async function dismissAnnouncement(id: string) {
    try { await api.post(`/app/announcements/${id}/read`); setAnnouncements((a) => a.map((x) => x.id === id ? { ...x, read: true } : x)); } catch { /* sessiz */ }
  }

  async function submitNps() {
    if (npsScore == null) return;
    try { await api.post('/app/survey', { score: npsScore, ...(npsComment.trim() ? { comment: npsComment.trim() } : {}) }); setNpsDone(true); }
    catch { /* sessiz */ }
  }

  if (error) return <div className="error">{error}</div>;
  if (!data) return <Loading />;

  const c = data.currency;
  const pending = Number(data.totals.pendingCents);
  const payable = Number(data.totals.payableCents);
  const paid = Number(data.totals.paidCents);
  const total = pending + payable + paid;

  const segs = [
    { label: t('me.pending'), value: Math.max(0, pending), color: 'var(--amber)' },
    { label: t('me.payable'), value: Math.max(0, payable), color: 'var(--sky)' },
    { label: t('me.paid'), value: Math.max(0, paid), color: 'var(--emerald)' },
  ];

  const levelBars = data.levels.map((l) => ({
    label: levelLabel(l.level),
    value: Number(l.payableCents) + Number(l.pendingCents) + Number(l.paidCents),
    color: 'var(--grad-primary)',
  }));

  return (
    <div>
      <div className="eyebrow fade-in">{t('anav.home')} · {data.month}</div>
      <h1 className="h1 fade-in">{t('me.title')}</h1>
      <p className="sub fade-in">{t('me.sub')}</p>

      {announcements.filter((a) => !a.read).length > 0 && (
        <div className="grid fade-in" style={{ gap: 10, marginBottom: 16 }}>
          {announcements.filter((a) => !a.read).map((a) => (
            <div key={a.id} className="card" style={{ borderColor: 'color-mix(in srgb, var(--gold-500) 35%, transparent)' }}>
              <div className="spread" style={{ marginBottom: 4 }}>
                <strong style={{ fontSize: 14 }}>📣 {a.title}</strong>
                <button className="faint" onClick={() => dismissAnnouncement(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>Mark read ✕</button>
              </div>
              <div className="muted" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{a.body}</div>
            </div>
          ))}
        </div>
      )}

      {onboarding && onboarding.percent < 100 && (
        <div className="card fade-in" style={{ marginBottom: 16 }}>
          <div className="spread" style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: 14 }}>Get started</strong>
            <span className="faint" style={{ fontSize: 12 }}>{onboarding.percent}% complete</span>
          </div>
          <div style={{ height: 8, borderRadius: 6, background: 'rgba(255,255,255,.06)', overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ height: '100%', width: `${onboarding.percent}%`, borderRadius: 6, background: 'var(--grad-primary)', transition: 'width .7s' }} />
          </div>
          <div className="grid" style={{ gap: 6 }}>
            {onboarding.steps.map((s) => (
              <div key={s.key} className="row" style={{ gap: 8, fontSize: 13 }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, background: s.done ? 'var(--grad-emerald, var(--emerald))' : 'var(--panel-2)', color: s.done ? '#03130d' : 'var(--faint)' }}>{s.done ? '✓' : ''}</span>
                <span style={{ color: s.done ? 'var(--muted)' : 'var(--text)', textDecoration: s.done ? 'line-through' : undefined }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {npsPrompt && !npsDone && (
        <div className="card fade-in" style={{ marginBottom: 16, borderColor: 'color-mix(in srgb, var(--sky) 30%, transparent)' }}>
          <div className="spread" style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: 14 }}>How likely are you to recommend us? (0–10)</strong>
            <button className="faint" onClick={() => setNpsPrompt(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>✕</button>
          </div>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {Array.from({ length: 11 }).map((_, n) => (
              <button key={n} onClick={() => setNpsScore(n)} className={`btn sm ${npsScore === n ? '' : 'ghost'}`} style={{ minWidth: 34, padding: '6px 0' }}>{n}</button>
            ))}
          </div>
          <input value={npsComment} onChange={(e) => setNpsComment(e.target.value)} placeholder="Any feedback? (optional)" style={{ marginTop: 10 }} />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn" disabled={npsScore == null} onClick={submitNps}>Submit</button>
          </div>
        </div>
      )}
      {npsDone && <div className="card fade-in" style={{ marginBottom: 16 }}><span className="muted">Thanks for your feedback! 🙏</span></div>}

      {/* hero + donut */}
      <div className="grid fade-in delay-1" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', alignItems: 'stretch' }}>
        <div className="card hero">
          <div className="faint" style={{ fontSize: 12 }}>{t('me.monthTotal')}</div>
          <div className="bignum gradient-text" style={{ marginTop: 6 }}>
            <MoneyCounter cents={total} currency={c} />
          </div>
          <div className="row" style={{ marginTop: 20, gap: 18 }}>
            <Chip color="var(--amber)" label={t('me.pending')} value={money(pending, c)} />
            <Chip color="var(--sky)" label={t('me.payable')} value={money(payable, c)} />
            <Chip color="var(--emerald)" label={t('me.paid')} value={money(paid, c)} />
          </div>
          {rankInfo?.rank && (
            <div className="row" style={{ marginTop: 14, gap: 8 }}>
              <span className="badge active" style={{ fontSize: 11, background: 'var(--foil)', color: 'var(--on-gold)' }}>🏆 Rank #{rankInfo.rank} of {rankInfo.total}</span>
              {rankInfo.topPercent != null && <span className="faint" style={{ fontSize: 11 }}>top {rankInfo.topPercent}% this month</span>}
            </div>
          )}
        </div>

        <div className="card" style={{ display: 'grid', placeItems: 'center' }}>
          <Donut
            segments={segs}
            center={
              <div>
                <div className="faint" style={{ fontSize: 11 }}>{t('me.balance')}</div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{money(payable, c)}</div>
                <div className="faint" style={{ fontSize: 10 }}>{t('me.payable')}</div>
              </div>
            }
          />
        </div>
      </div>

      {/* kariyer rutbesi + rozetler (#20) */}
      {rank && (rank.current || rank.badges.some((b) => b.earned)) && (
        <div className="card fade-in delay-2" style={{ marginTop: 16 }}>
          <div className="spread" style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: 14 }}>🏅 {rank.current ?? 'Unranked'}{rank.next && <span className="faint" style={{ fontWeight: 400 }}> → {rank.next}</span>}{rank.overrideBps ? <span className="badge active" style={{ fontSize: 10, marginLeft: 8 }}>+{(rank.overrideBps / 100).toFixed(rank.overrideBps % 100 ? 1 : 0)}% on your sales</span> : null}</strong>
            {rank.next && <span className="faint" style={{ fontSize: 12 }}>{rank.overallPct}% to {rank.next}</span>}
          </div>
          {rank.next && (
            <div style={{ height: 8, borderRadius: 6, background: 'rgba(255,255,255,.06)', overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ height: '100%', width: `${rank.overallPct}%`, borderRadius: 6, background: 'var(--foil)', transition: 'width .7s' }} />
            </div>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {rank.badges.map((b) => (
              <span key={b.key} className={`badge ${b.earned ? 'active' : 'draft'}`} style={{ fontSize: 11, opacity: b.earned ? 1 : 0.5 }}>{b.earned ? '✓ ' : ''}{b.label}</span>
            ))}
          </div>
        </div>
      )}

      {/* aktif kampanyalar — kendi siram */}
      {campaigns.length > 0 && (
        <div className="grid fade-in delay-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginTop: 16 }}>
          {campaigns.map((cp) => {
            const topPrize = cp.prizes.reduce((a, p) => Math.max(a, p.bonusCents), 0);
            return (
              <div key={cp.id} className="card" style={{ borderColor: 'color-mix(in srgb, var(--gold-500) 35%, transparent)' }}>
                <div className="spread">
                  <strong style={{ fontSize: 14 }}>⚑ {cp.name}</strong>
                  <span className="faint" style={{ fontSize: 11 }}>ends {dateShort(cp.endsAt)}</span>
                </div>
                <div className="row" style={{ gap: 16, margin: '12px 0' }}>
                  <div>
                    <div className="faint" style={{ fontSize: 11 }}>Your rank</div>
                    <div className="tnum" style={{ fontWeight: 800, fontSize: 22, color: cp.myRank === 1 ? 'var(--gold-500)' : undefined }}>
                      {cp.myRank ? `#${cp.myRank}` : '—'}
                    </div>
                  </div>
                  {topPrize > 0 && (
                    <div>
                      <div className="faint" style={{ fontSize: 11 }}>Top prize</div>
                      <div className="tnum" style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>{money(topPrize)}</div>
                    </div>
                  )}
                </div>
                {cp.leaderboard.length > 0 && (
                  <div className="grid" style={{ gap: 4 }}>
                    {cp.leaderboard.slice(0, 3).map((s) => (
                      <div key={s.membershipId} className="spread" style={{ fontSize: 12 }}>
                        <span className="row" style={{ gap: 6 }}>
                          <span style={{ width: 18, height: 18, borderRadius: 5, display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 800, background: s.rank === 1 ? 'var(--foil)' : 'var(--panel-2)', color: s.rank === 1 ? 'var(--on-gold)' : 'var(--muted)' }}>{s.rank}</span>
                          {s.name}
                        </span>
                        <span className="tnum faint">{cp.metric === 'revenue' ? money(s.score) : s.score.toLocaleString('en-US')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* son 6 ay kazanc trendi */}
      {earnings && earnings.series.some((p) => Number(p.totalCents) > 0) && (
        <div className="card fade-in delay-2" style={{ marginTop: 16 }}>
          <div className="spread" style={{ marginBottom: 14 }}>
            <strong>Last 6 months</strong>
            <span className="faint" style={{ fontSize: 12 }}>Your total commission per month</span>
          </div>
          <Bars
            data={earnings.series.map((p) => ({ label: monthLabel(p.month), value: Number(p.totalCents), color: 'var(--grad-primary)' }))}
            format={(v) => money(v, c)}
          />
        </div>
      )}

      {/* seviye dokumu */}
      <div className="card fade-in delay-2" style={{ marginTop: 16 }}>
        <div className="spread" style={{ marginBottom: 14 }}>
          <strong>{t('me.levelBreakdown')}</strong>
          <span className="faint" style={{ fontSize: 12 }}>{t('me.levelHint')}</span>
        </div>
        {levelBars.length > 0 ? (
          <Bars data={levelBars} format={(v) => money(v, c)} />
        ) : (
          <div className="muted">{t('me.noData')}</div>
        )}
      </div>

      <div className="faint fade-in" style={{ fontSize: 11, marginTop: 16, lineHeight: 1.5 }}>{t('me.incomeNote')}</div>
    </div>
  );
}

function Chip({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div>
      <div className="row" style={{ gap: 7 }}>
        <span style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
        <span className="faint" style={{ fontSize: 11 }}>{label}</span>
      </div>
      <div className="tnum" style={{ fontWeight: 700, marginTop: 3 }}>{value}</div>
    </div>
  );
}
