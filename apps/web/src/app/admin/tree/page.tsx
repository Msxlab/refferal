'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui';
import { NetworkExplorer, type ApiNode, type RankTierLite } from '@/components/NetworkExplorer';
import { money } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { ArrowLeft, AlertTriangle, Users, Circle, Network, Star, TrendingUp, TrendingDown, LayoutGrid, List, Award, ArrowRight } from 'lucide-react';

interface Leader {
  id: string; fullName: string; referralCode: string; role: string;
  isTeamLeader: boolean; isOwnerRoot: boolean; teamSize: number;
  activeCount: number; trend: string[];
  monthlyGroupVolumeCents: string; monthlyGroupCommissionCents: string;
}

const ALL = '__all__';

type LeaderStatus = 'healthy' | 'cooling' | 'dormant';
type SortKey = 'volume' | 'team' | 'growth' | 'active';

/** Durum -> indigo temasinda Tailwind sinif eslesmesi (pill + ilerleme cubugu + sparkline). */
const STATUS_META: Record<LeaderStatus, { label: string; pill: string; bar: string; barIndicator: string; spark: string }> = {
  healthy: { label: 'healthy', pill: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', bar: 'bg-emerald-400', barIndicator: '[&>div]:bg-emerald-400', spark: 'var(--emerald)' },
  cooling: { label: 'cooling', pill: 'text-amber-400 bg-amber-400/10 border-amber-400/30', bar: 'bg-amber-400', barIndicator: '[&>div]:bg-amber-400', spark: 'var(--amber)' },
  dormant: { label: 'dormant', pill: 'text-destructive bg-destructive/10 border-destructive/30', bar: 'bg-destructive', barIndicator: '[&>div]:bg-destructive', spark: 'var(--rose)' },
};

/** Lider durumu: bu-ay grup cirosu + trend yonu + aktif oranindan turetilir. */
function leaderStatus(l: Leader): LeaderStatus {
  const vol = Number(l.monthlyGroupVolumeCents);
  const tr = l.trend.map(Number);
  const cur = tr[tr.length - 1] ?? vol;
  const prev = tr[tr.length - 2] ?? 0;
  const total = l.teamSize + 1;
  const activeRatio = total > 0 ? l.activeCount / total : 0;
  if (vol <= 0) return 'dormant';
  if (cur < prev || activeRatio < 0.5) return 'cooling';
  return 'healthy';
}
function growthOf(l: Leader): number {
  const tr = l.trend.map(Number);
  return (tr[tr.length - 1] ?? 0) - (tr[tr.length - 2] ?? 0);
}
function activeRatioOf(l: Leader): number {
  const total = l.teamSize + 1;
  return total > 0 ? l.activeCount / total : 0;
}

/** Kompakt para etiketi: $12.3k / $1.2M. */
function compactMoney(cents: string | number): string {
  const d = Number(cents) / 100;
  const a = Math.abs(d);
  if (a >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (a >= 1000) return `$${(d / 1000).toFixed(1)}k`;
  return `$${d.toFixed(0)}`;
}

/** Mini sparkline (cent string serisinden). Tum-sifir ise kesik taban cizgisi. */
function Sparkline({ data, color = 'hsl(var(--muted-foreground))', w = 84, h = 22 }: { data: string[]; color?: string; w?: number; h?: number }) {
  const nums = data.map(Number);
  const max = Math.max(1, ...nums);
  const allZero = nums.every((v) => v === 0);
  const pts = nums.map((v, i) => {
    const x = nums.length > 1 ? (i / (nums.length - 1)) * (w - 2) + 1 : w / 2;
    const y = h - 2 - (v / max) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="block">
      {allZero
        ? <line x1="1" y1={h - 2} x2={w - 1} y2={h - 2} stroke="hsl(var(--border))" strokeWidth="1.5" strokeDasharray="2 3" />
        : <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
  );
}

function StatusPill({ s }: { s: LeaderStatus }) {
  const m = STATUS_META[s];
  return (
    <span className={cn('inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap', m.pill)}>
      {m.label}
    </span>
  );
}

interface LeadersMeta { totalLeaders: number; shownLeaders: number; truncated: boolean }

interface DormantCluster { leaderId: string; leaderName: string; referralCode: string; teamSize: number }
interface NetworkHealth {
  month: string;
  totals: { members: number; active: number; inactive: number };
  noSaleActive: { count: number; total: number; pct: number };
  dormantClusters: DormantCluster[];
}

export default function NetworkPage() {
  const [leaders, setLeaders] = useState<Leader[] | null>(null);
  const [meta, setMeta] = useState<LeadersMeta | null>(null);
  const [health, setHealth] = useState<NetworkHealth | null>(null);
  const [tiers, setTiers] = useState<RankTierLite[]>([]);
  const [root, setRoot] = useState<{ id: string; name: string } | null>(null); // null = liderler landing
  const [nodes, setNodes] = useState<ApiNode[] | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  // leaderboard kontrolleri
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [view, setView] = useState<'cards' | 'table'>('cards');

  const q = query.trim().toLowerCase();
  const sortedLeaders = useMemo(() => {
    const arr = (leaders ?? []).filter((l) => !q || l.fullName.toLowerCase().includes(q) || l.referralCode.toLowerCase().includes(q));
    arr.sort((a, b) => {
      if (sortKey === 'team') return b.teamSize - a.teamSize;
      if (sortKey === 'growth') return growthOf(b) - growthOf(a);
      if (sortKey === 'active') return activeRatioOf(b) - activeRatioOf(a);
      return Number(b.monthlyGroupVolumeCents) - Number(a.monthlyGroupVolumeCents);
    });
    return arr;
  }, [leaders, q, sortKey]);
  // spotlight: en iyi SAHA lideri (owner-root haric), ciroya gore; arama yokken gosterilir
  const spotlight = useMemo(() => {
    const perf = (leaders ?? []).filter((l) => !l.isOwnerRoot);
    if (perf.length === 0) return null;
    return [...perf].sort((a, b) => Number(b.monthlyGroupVolumeCents) - Number(a.monthlyGroupVolumeCents) || b.teamSize - a.teamSize)[0];
  }, [leaders]);

  const loadLeaders = useCallback(() => {
    api.get<{ leaders: Leader[] } & Partial<LeadersMeta>>('/admin/members/leaders')
      .then((r) => {
        setLeaders(r.leaders);
        if (r.totalLeaders !== undefined) setMeta({ totalLeaders: r.totalLeaders, shownLeaders: r.shownLeaders ?? r.leaders.length, truncated: !!r.truncated });
      })
      .catch((e) => setError(String((e as ApiError).message)));
  }, []);

  useEffect(() => {
    loadLeaders();
    api.get<{ tiers: RankTierLite[] }>('/admin/ranks').then((r) => setTiers(r.tiers)).catch(() => { /* opsiyonel */ });
    api.get<NetworkHealth>('/admin/members/network-health').then(setHealth).catch(() => { /* opsiyonel */ });
  }, [loadLeaders]);

  const openTree = useCallback((rootId: string | null, name: string) => {
    setNodes(null);
    setRoot({ id: rootId ?? ALL, name });
    const q = rootId ? `?root=${rootId}` : '';
    api.get<ApiNode[]>(`/admin/members/tree${q}`).then(setNodes).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  const toggleLeader = useCallback(async (n: ApiNode) => {
    try {
      await api.post(`/admin/members/${n.id}/leader`, { isTeamLeader: !n.isTeamLeader });
      showToast(n.isTeamLeader ? 'Removed as leader' : 'Marked as leader 🎖');
      loadLeaders();
      if (root) openTree(root.id === ALL ? null : root.id, root.name);
    } catch (e) { setError(String((e as ApiError).message)); }
  }, [root, openTree, loadLeaders, showToast]);

  if (error) {
    return (
      <div className="mx-auto max-w-[1160px] px-7 py-7">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // ---- bir lider/ağ seçiliyse: o ağacı göster ----
  if (root) {
    return (
      <div className="mx-auto max-w-[1160px] px-7 py-7">
        <div className="mb-4 flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => { setRoot(null); setNodes(null); }}>
            <ArrowLeft className="size-4" aria-hidden /> Leaders
          </Button>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.13em] text-muted-foreground/70">
              {root.id === ALL ? 'Whole network' : 'Team tree'}
            </div>
            <h1 className="mt-0.5 font-display text-[22px] font-extrabold tracking-tight text-foreground">{root.name}</h1>
          </div>
        </div>
        {!nodes ? (
          <div className="space-y-2.5" role="status" aria-label="Loading">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : <NetworkExplorer nodes={nodes} tiers={tiers} title={root.name} onToggleLeader={toggleLeader} />}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    );
  }

  // ---- liderler landing'i ----
  return (
    <div className="mx-auto max-w-[1160px] px-7 py-7">
      <div className="fade-in text-[11px] font-bold uppercase tracking-[0.15em] text-primary">{t('nav.tree')}</div>
      <h1 className="fade-in mt-1.5 font-display text-[27px] font-extrabold tracking-tight text-foreground">Team leaders</h1>
      <p className="fade-in mt-1 max-w-[640px] text-[13.5px] text-muted-foreground">
        Open each leader as its own tree — see their team, sales and <strong className="text-foreground">this month&apos;s commission</strong> live. Open any member in the tree and use <em>“Make leader”</em> to mark them a leader.
      </p>

      {meta?.truncated && (
        <Alert className="fade-in mt-4 flex items-center gap-2 border-amber-400/30 bg-amber-400/10 py-2 text-[13px] text-foreground">
          <AlertTriangle className="size-4 text-amber-400" aria-hidden />
          <AlertDescription className="text-[13px] text-foreground">
            Showing the first <strong>{meta.shownLeaders}</strong> of <strong>{meta.totalLeaders}</strong> leaders. Search &amp; pagination are coming soon.
          </AlertDescription>
        </Alert>
      )}

      {/* ---- ag saglik seridi ---- */}
      {health && (
        <Card className="fade-in mt-[18px] p-4 shadow-lg sm:px-[18px]">
          <div className={cn('grid grid-cols-2 gap-4 sm:grid-cols-4', health.dormantClusters.length > 0 && 'mb-3.5')}>
            <div>
              <div className="text-[11px] text-muted-foreground/70">Members</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[18px] font-bold tabular-nums text-foreground"><Users className="size-4 text-muted-foreground/70" aria-hidden /> {health.totals.members}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground/70">Active</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[18px] font-bold tabular-nums text-foreground">
                <Circle className="size-2.5 fill-emerald-400 text-emerald-400" aria-hidden /> {health.totals.active}
                <span className="text-[11px] font-normal text-muted-foreground/70"> / {health.totals.inactive} inactive</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground/70">No sale this month</div>
              <div className={cn('mt-0.5 text-[18px] font-bold tabular-nums', health.noSaleActive.pct >= 50 ? 'text-amber-400' : 'text-foreground')}>
                {health.noSaleActive.pct}%
                <span className="text-[11px] font-normal text-muted-foreground/70"> ({health.noSaleActive.count}/{health.noSaleActive.total} active)</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground/70">Dormant teams</div>
              <div className={cn('mt-0.5 text-[18px] font-bold tabular-nums', health.dormantClusters.length > 0 ? 'text-amber-400' : 'text-emerald-400')}>
                {health.dormantClusters.length}
              </div>
            </div>
          </div>
          {health.dormantClusters.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] text-muted-foreground/70">Teams with no group sales this month — open to investigate:</div>
              <div className="flex flex-wrap gap-2">
                {health.dormantClusters.map((d) => (
                  <Button key={d.leaderId} variant="outline" size="sm" className="h-auto gap-1.5 py-1.5"
                    onClick={() => openTree(d.leaderId, d.leaderName)} title={`${d.referralCode} · team of ${d.teamSize}`}>
                    {d.leaderName} <span className="inline-flex items-center gap-1 text-muted-foreground/70"><Users className="size-3.5" aria-hidden />{d.teamSize}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {!leaders ? (
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5" role="status" aria-label="Loading">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[148px] w-full rounded-xl" />)}
        </div>
      ) : (
        <>
          {/* tum ag girisi */}
          <button
            className="fade-in mt-3.5 w-full cursor-pointer rounded-xl border border-dashed border-input bg-card px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-muted"
            onClick={() => openTree(null, 'Whole network')}
          >
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-foreground"><Network className="size-4" aria-hidden /> Whole network</span>
            <span className="text-xs text-muted-foreground/70"> — see the entire company as one tree</span>
          </button>

          {/* spotlight: en iyi saha lideri (arama yokken) */}
          {!q && spotlight && (
            <>
              <div className="mt-[18px] mb-[7px] inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground/70"><Star className="size-3.5" aria-hidden /> Top performer this month</div>
              <button
                onClick={() => openTree(spotlight.id, spotlight.fullName)}
                className="w-full cursor-pointer rounded-2xl border border-primary bg-card px-[18px] py-4 text-left shadow-[0_0_0_1px_hsl(var(--primary)/0.4),0_18px_50px_-28px_hsl(var(--primary)/0.5)] transition-transform hover:-translate-y-0.5"
              >
                <div className="flex flex-wrap items-center gap-3.5">
                  <span className="grid size-[46px] shrink-0 place-items-center rounded-full bg-primary font-display text-[17px] font-extrabold text-primary-foreground">
                    {spotlight.fullName.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-[150px] flex-1">
                    <div className="flex items-center gap-2.5">
                      <span className="text-base font-bold text-foreground">{spotlight.fullName}</span>
                      <span className="font-mono text-[11px] text-muted-foreground/70">{spotlight.referralCode}</span>
                      <StatusPill s={leaderStatus(spotlight)} />
                    </div>
                    <div className="mt-1 inline-flex flex-wrap items-center gap-1 text-xs text-muted-foreground/70">
                      <Users className="size-3.5" aria-hidden /> {spotlight.teamSize} team · {Math.round(activeRatioOf(spotlight) * 100)}% active
                      {growthOf(spotlight) !== 0 && (
                        <span className={cn('inline-flex items-center gap-1', growthOf(spotlight) > 0 ? 'text-emerald-400' : 'text-destructive')}>
                          {' · '}{growthOf(spotlight) > 0 ? <TrendingUp className="size-3.5" aria-hidden /> : <TrendingDown className="size-3.5" aria-hidden />} {compactMoney(Math.abs(growthOf(spotlight)))} vs last mo
                        </span>
                      )}
                    </div>
                  </div>
                  <Sparkline data={spotlight.trend} color="hsl(var(--primary))" w={120} h={40} />
                  <div className="min-w-[120px] text-right">
                    <div className="text-[11px] text-muted-foreground/70">Group volume (mo)</div>
                    <div className="font-display text-[22px] font-extrabold tabular-nums text-foreground">{money(spotlight.monthlyGroupVolumeCents)}</div>
                    <div className="text-xs tabular-nums text-primary">{money(spotlight.monthlyGroupCommissionCents)} commission</div>
                  </div>
                </div>
              </button>
            </>
          )}

          {/* toolbar: arama + siralama + gorunum */}
          <div className="mt-5 mb-3.5 flex flex-wrap items-center gap-2.5">
            <Input
              aria-label="Search leaders by name or code"
              placeholder="Search leader or code…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 max-w-[300px] flex-1 sm:min-w-[180px]"
            />
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger aria-label="Sort leaders" className="h-9 w-auto text-[12.5px] text-muted-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="volume">Sort: group volume</SelectItem>
                <SelectItem value="team">Team size</SelectItem>
                <SelectItem value="growth">Growth</SelectItem>
                <SelectItem value="active">Activity</SelectItem>
              </SelectContent>
            </Select>
            <Tabs value={view} onValueChange={(v) => setView(v as 'cards' | 'table')}>
              <TabsList>
                <TabsTrigger value="cards" className="gap-1.5"><LayoutGrid className="size-4" aria-hidden /> Cards</TabsTrigger>
                <TabsTrigger value="table" className="gap-1.5"><List className="size-4" aria-hidden /> Table</TabsTrigger>
              </TabsList>
            </Tabs>
            <span className="text-[12.5px] text-muted-foreground/70">{sortedLeaders.length} {sortedLeaders.length === 1 ? 'leader' : 'leaders'}</span>
          </div>

          {/* leaderboard: kart ya da tablo */}
          {sortedLeaders.length === 0 ? (
            <div className="py-[18px] text-sm text-muted-foreground">No leaders match “{query}”.</div>
          ) : view === 'cards' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5">
              {sortedLeaders.map((l) => {
                const st = leaderStatus(l);
                return (
                  <button
                    key={l.id}
                    onClick={() => openTree(l.id, l.fullName)}
                    className="cursor-pointer text-left transition-transform hover:-translate-y-0.5"
                  >
                    <Card className="h-full p-4 shadow-lg transition-colors hover:border-primary/40">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className={cn(
                            'grid size-[34px] shrink-0 place-items-center rounded-[9px] font-display text-[13px] font-extrabold',
                            l.isOwnerRoot ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                          )}>
                            {l.fullName.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-[15px] font-bold text-foreground">{l.fullName}</div>
                            <div className="font-mono text-[11px] text-muted-foreground/70">{l.referralCode}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          {l.isOwnerRoot
                            ? <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[9px] font-semibold text-primary">owner</span>
                            : <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[9px] font-semibold text-primary" title="leader"><Award className="size-3" aria-hidden /></span>}
                          <StatusPill s={st} />
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <span className="inline-flex min-w-[38px] items-center gap-1 text-[10px] text-muted-foreground/70"><Users className="size-3" aria-hidden /> {l.teamSize}</span>
                        <Progress
                          value={Math.round(activeRatioOf(l) * 100)}
                          className={cn('h-1 flex-1 bg-muted', STATUS_META[st].barIndicator)}
                        />
                        <span className="text-[10px] text-muted-foreground/70">{Math.round(activeRatioOf(l) * 100)}%</span>
                      </div>
                      <div className="mt-3 flex items-end justify-between">
                        <div>
                          <div className="text-[10px] text-muted-foreground/70">Volume (mo)</div>
                          <div className="text-[15px] font-bold tabular-nums text-foreground">{money(l.monthlyGroupVolumeCents)}</div>
                          <div className="text-[11px] tabular-nums text-primary">{money(l.monthlyGroupCommissionCents)}</div>
                        </div>
                        <Sparkline data={l.trend} color={STATUS_META[st].spark} w={80} h={30} />
                      </div>
                    </Card>
                  </button>
                );
              })}
            </div>
          ) : (
            <Card className="overflow-x-auto p-0 shadow-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Leader</TableHead>
                    <TableHead className="text-right">Team</TableHead>
                    <TableHead className="text-right">Volume (mo)</TableHead>
                    <TableHead className="text-right">Commission (mo)</TableHead>
                    <TableHead>6-mo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedLeaders.map((l, i) => {
                    const st = leaderStatus(l);
                    return (
                      <TableRow key={l.id} className="cursor-pointer" onClick={() => openTree(l.id, l.fullName)}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="min-w-[16px] text-[11px] tabular-nums text-muted-foreground/70">{i + 1}</span>
                            <div>
                              <div className="text-[13px] font-semibold text-foreground">
                                {l.fullName}
                                {l.isOwnerRoot ? <span className="font-normal text-muted-foreground/70"> · owner</span> : l.isTeamLeader ? <Award className="ml-1 inline size-3.5 align-text-bottom text-primary" aria-hidden /> : ''}
                              </div>
                              <div className="font-mono text-[11px] text-muted-foreground/70">{l.referralCode}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {l.teamSize}
                          <div className="text-[10px] text-muted-foreground/70">{Math.round(activeRatioOf(l) * 100)}% act</div>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{money(l.monthlyGroupVolumeCents)}</TableCell>
                        <TableCell className="text-right tabular-nums text-primary">{money(l.monthlyGroupCommissionCents)}</TableCell>
                        <TableCell><Sparkline data={l.trend} color={STATUS_META[st].spark} w={70} h={20} /></TableCell>
                        <TableCell><StatusPill s={st} /></TableCell>
                        <TableCell className="text-right"><span className="inline-flex items-center gap-1 text-xs text-muted-foreground/70">Open <ArrowRight className="size-3.5" aria-hidden /></span></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
