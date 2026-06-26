'use client';

/**
 * Gizlilik korumali "My Network" radial gorseli (SPEC 9): merkez = sen, her halka bir
 * alt-seviye, noktalar = uyeler (aktif/pasif renk). BIREYSEL ISIM YOK — yalnizca sayilar.
 */
interface Level { level: number; memberCount: number; activeCount: number }

const SIZE = 440;
const C = SIZE / 2;
const CENTER_R = 30;
const MAX_R = 196;
const DOT_CAP = 28; // halka basina gosterilecek azami nokta (kalani "+N")

export function RadialNetwork({ levels, totalMembers }: { levels: Level[]; totalMembers: number }) {
  const active = levels.filter((l) => l.memberCount > 0);
  const maxLevel = Math.max(1, ...levels.map((l) => l.level));
  const gap = (MAX_R - CENTER_R) / maxLevel;

  if (totalMembers === 0) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: 280 }}>
        <div className="faint" style={{ textAlign: 'center', fontSize: 13 }}>
          Your network is empty.<br />Invite your first member to grow your tree.
        </div>
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" style={{ maxWidth: SIZE, display: 'block', margin: '0 auto' }}
      role="img" aria-label={`Network radial: ${totalMembers} members across ${active.length} levels`}>
      <defs>
        {/* merkez gradyani: --foil rampasini izler (acik->primary), boylece tema-uyumlu */}
        <radialGradient id="rn-core" cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor="color-mix(in srgb, hsl(var(--primary)) 55%, white)" />
          <stop offset="100%" stopColor="hsl(var(--primary))" />
        </radialGradient>
        <radialGradient id="rn-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--gold-500)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--gold-500)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx={C} cy={C} r={MAX_R + 20} fill="url(#rn-glow)" />

      {/* halka izleri + radyal kilavuzlar */}
      {Array.from({ length: maxLevel }).map((_, i) => {
        const r = CENTER_R + (i + 1) * gap;
        return <circle key={`ring-${i}`} cx={C} cy={C} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={1} strokeDasharray="2 4" />;
      })}

      {/* her seviyenin noktalari */}
      {levels.map((lvl) => {
        if (lvl.memberCount === 0) return null;
        const r = CENTER_R + lvl.level * gap;
        const shown = Math.min(lvl.memberCount, DOT_CAP);
        const activeShown = Math.round((lvl.activeCount / lvl.memberCount) * shown);
        const offset = (lvl.level % 2) * (Math.PI / shown); // halkalar arasi hafif kayma
        return (
          <g key={`lvl-${lvl.level}`}>
            {Array.from({ length: shown }).map((_, i) => {
              const a = (i / shown) * Math.PI * 2 - Math.PI / 2 + offset;
              const x = C + r * Math.cos(a);
              const y = C + r * Math.sin(a);
              const isActive = i < activeShown;
              return (
                <g key={i}>
                  <line x1={C} y1={C} x2={x} y2={y} stroke="hsl(var(--border))" strokeWidth={0.6} opacity={0.5} />
                  <circle cx={x} cy={y} r={6} fill={isActive ? 'var(--emerald)' : 'hsl(var(--muted-foreground))'}
                    stroke="var(--panel)" strokeWidth={1.5} />
                </g>
              );
            })}
            {/* seviye etiketi (sayilar) */}
            <text x={C} y={C - r - 4} textAnchor="middle" fontSize={10} fill="var(--faint)"
              fontFamily="ui-monospace, monospace">L{lvl.level} · {lvl.memberCount}</text>
          </g>
        );
      })}

      {/* merkez: sen */}
      <circle cx={C} cy={C} r={CENTER_R} fill="url(#rn-core)" />
      <text x={C} y={C + 4} textAnchor="middle" fontSize={12} fontWeight={800} fill="var(--on-gold)"
        fontFamily="var(--font-display)">You</text>
    </svg>
  );
}
