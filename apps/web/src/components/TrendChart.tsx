'use client';

/**
 * Gelir + komisyon zaman serisi (tek olcek): gelir barlari (altin) + komisyon cizgisi (emerald).
 * Komisyon ~gelirin %9'u oldugundan cizgi altta seyreder — bu DOGRU ve anlatici.
 */
interface Point { month: string; revenueCents: string; commissionCents: string; approvedSales: number }

const W = 760;
const H = 240;
const PAD = { l: 14, r: 14, t: 16, b: 28 };

function fmtMonth(m: string): string {
  const [y, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString('en-US', { month: 'short' });
}
function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
}

export function TrendChart({ series, currency }: { series: Point[]; currency: string }) {
  const n = series.length;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const rev = series.map((p) => Number(p.revenueCents));
  const com = series.map((p) => Number(p.commissionCents));
  const maxRev = Math.max(1, ...rev);

  const slot = innerW / n;
  const barW = Math.min(46, slot * 0.5);
  const x = (i: number) => PAD.l + slot * i + slot / 2;
  const y = (v: number) => PAD.t + innerH - (v / maxRev) * innerH;

  const linePts = com.map((v, i) => `${x(i)},${y(v)}`).join(' ');

  // gradient area fill: cizgiyi izle → baseline'a in → basa don (cizginin arkasinda derinlik)
  const baseline = PAD.t + innerH;
  const areaPath =
    n > 1
      ? `M ${x(0)},${baseline} ` +
        com.map((v, i) => `L ${x(i)},${y(v)}`).join(' ') +
        ` L ${x(n - 1)},${baseline} Z`
      : '';

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Revenue and commission trend">
        <defs>
          <linearGradient id="tc-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gold-500)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--gold-600)" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="tc-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.28" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* yatay kilavuzlar */}
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + innerH * (1 - g)} y2={PAD.t + innerH * (1 - g)}
            stroke="hsl(var(--border))" strokeWidth={1} strokeDasharray="2 5" />
        ))}

        {series.map((p, i) => {
          const h = (rev[i] / maxRev) * innerH;
          return (
            <g key={p.month}>
              <rect x={x(i) - barW / 2} y={PAD.t + innerH - h} width={barW} height={Math.max(0, h)} rx={5} fill="url(#tc-bar)">
                <title>{`${fmtMonth(p.month)} · revenue ${money(rev[i], currency)} · commission ${money(com[i], currency)} · ${p.approvedSales} sales`}</title>
              </rect>
              <text x={x(i)} y={H - 9} textAnchor="middle" fontSize={11} fill="var(--faint)">{fmtMonth(p.month)}</text>
            </g>
          );
        })}

        {/* komisyon cizgisi altinda yumusak gradient alan (cizginin arkasinda derinlik) */}
        {n > 1 && <path d={areaPath} fill="url(#tc-area)" stroke="none" />}

        {/* komisyon cizgisi + noktalar */}
        {n > 1 && <polyline points={linePts} fill="none" stroke="var(--emerald)" strokeWidth={2} strokeLinejoin="round" />}
        {com.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={3.5} fill="var(--emerald)" stroke="var(--panel)" strokeWidth={1.5}>
            <title>{`${fmtMonth(series[i].month)} commission ${money(v, currency)}`}</title>
          </circle>
        ))}
      </svg>

      <div className="row" style={{ gap: 18, fontSize: 12, marginTop: 4, justifyContent: 'center' }}>
        <span className="row" style={{ gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--gold-500)' }} /> Revenue</span>
        <span className="row" style={{ gap: 6 }}><i style={{ width: 14, height: 3, borderRadius: 2, background: 'var(--emerald)' }} /> Commission</span>
      </div>
    </div>
  );
}
