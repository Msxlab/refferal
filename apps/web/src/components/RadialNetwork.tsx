'use client';

/**
 * Privacy-preserving "My Network" radial visual (SPEC 9): center is the current member,
 * each ring is one downline level, and dots represent active/inactive aggregate counts.
 */
interface Level { level: number; memberCount: number; activeCount: number }

const SIZE = 440;
const C = SIZE / 2;
const CENTER_R = 30;
const MAX_R = 196;
const DOT_CAP = 28; // maximum dots shown per ring

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
      <circle cx={C} cy={C} r={MAX_R + 20} fill="var(--primary)" opacity={0.08} />

      {/* ring traces plus radial guides */}
      {Array.from({ length: maxLevel }).map((_, i) => {
        const r = CENTER_R + (i + 1) * gap;
        return <circle key={`ring-${i}`} cx={C} cy={C} r={r} fill="none" stroke="var(--border)" strokeWidth={1} strokeDasharray="2 4" />;
      })}

      {/* points for each level */}
      {levels.map((lvl) => {
        if (lvl.memberCount === 0) return null;
        const r = CENTER_R + lvl.level * gap;
        const shown = Math.min(lvl.memberCount, DOT_CAP);
        const activeShown = Math.round((lvl.activeCount / lvl.memberCount) * shown);
        const offset = (lvl.level % 2) * (Math.PI / shown); // slight offset between rings
        return (
          <g key={`lvl-${lvl.level}`}>
            {Array.from({ length: shown }).map((_, i) => {
              const a = (i / shown) * Math.PI * 2 - Math.PI / 2 + offset;
              const x = C + r * Math.cos(a);
              const y = C + r * Math.sin(a);
              const isActive = i < activeShown;
              return (
                <g key={i}>
                  <line x1={C} y1={C} x2={x} y2={y} stroke="var(--border)" strokeWidth={0.6} opacity={0.5} />
                  <circle cx={x} cy={y} r={6} fill={isActive ? 'var(--emerald)' : 'var(--muted)'}
                    stroke="var(--panel)" strokeWidth={1.5} />
                </g>
              );
            })}
            {/* level label with aggregate count */}
            <text x={C} y={C - r - 4} textAnchor="middle" fontSize={10} fill="var(--faint)"
              fontFamily="ui-monospace, monospace">L{lvl.level} - {lvl.memberCount}</text>
          </g>
        );
      })}

      {/* center: current member */}
      <circle cx={C} cy={C} r={CENTER_R} fill="var(--primary)" />
      <text x={C} y={C + 4} textAnchor="middle" fontSize={12} fontWeight={800} fill="var(--on-primary)"
        fontFamily="var(--font-display)">You</text>
    </svg>
  );
}
