/**
 * Refearn tasarim token'lari — docs/DESIGN.md ile birebir (web globals.css esleri).
 * Mobilde tek dogruluk kaynagi budur; ekranlar renk/bosluk/font'u buradan alir.
 */
export const colors = {
  bg0: '#07080f',
  bg1: '#0c0e1a',
  panel: 'rgba(22, 25, 42, 0.92)', // mobilde blur yok → daha opak cam
  panelSolid: '#14172a',
  panel2: 'rgba(36, 40, 66, 0.85)',
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.16)',
  text: '#eef0f7',
  muted: '#97a0bd',
  faint: '#6b7392',
  primary: '#7c8bff',
  primary2: '#a06bff',
  emerald: '#2fe1a8',
  amber: '#ffcf6b',
  rose: '#ff7aa2',
  sky: '#6bc6ff',
} as const;

/** Gradient esleri (expo-linear-gradient eklemeden duz renk fallback) */
export const accents = {
  primary: colors.primary,
  emerald: colors.emerald,
  amber: colors.amber,
  rose: colors.rose,
  sky: colors.sky,
} as const;

export const space = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 20,
  s6: 24,
  s8: 32,
} as const;

export const text = {
  xs: 11,
  sm: 12,
  md: 13,
  lg: 16,
  xl: 22,
  xxl: 30,
  hero: 38,
} as const;

export const radius = {
  md: 12,
  lg: 18,
  pill: 999,
} as const;

/** Rozet renk eslemesi — API enum adlariyla birebir (DESIGN.md kurali) */
export const badgeColors: Record<string, string> = {
  draft: colors.muted,
  inactive: colors.muted,
  expired: colors.muted,
  approved: colors.emerald,
  active: colors.emerald,
  paid: colors.emerald,
  used: colors.emerald,
  void: colors.rose,
  failed: colors.rose,
  revoked: colors.rose,
  payable: colors.sky,
  pending: colors.amber,
  requested: colors.amber,
  processing: colors.amber,
  reversed: colors.muted,
};
