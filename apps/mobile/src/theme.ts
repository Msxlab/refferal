import { createContext, createElement, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';

export type ThemeScheme = 'light' | 'dark';

export interface ThemeColors {
  bg0: string;
  bg1: string;
  panel: string;
  panelSolid: string;
  panel2: string;
  panel3: string;
  input: string;
  control: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  faint: string;
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  brandAccent: string;
  money: string;
  emerald: string;
  amber: string;
  rose: string;
  sky: string;
  onEmerald: string;
  onAmber: string;
  onRose: string;
  onSky: string;
  infoSubtle: string;
  successSubtle: string;
  warningSubtle: string;
  dangerSubtle: string;
  qrSurface: string;
}

export const lightColors: ThemeColors = {
  bg0: '#F5F7FB',
  bg1: '#EDF2F8',
  panel: '#FFFFFF',
  panelSolid: '#FFFFFF',
  panel2: '#F7F9FD',
  panel3: '#EDF2F8',
  input: '#F4F6FA',
  control: '#EEF2F8',
  border: '#D9E0EB',
  borderStrong: '#B9C5D5',
  text: '#17233B',
  muted: '#53627A',
  faint: '#65718A',
  primary: '#384BB8',
  primaryPressed: '#2F43B1',
  onPrimary: '#FFFFFF',
  brandAccent: '#6F7ACA',
  money: '#98502E',
  emerald: '#0E7A5F',
  amber: '#9A570F',
  rose: '#B5364B',
  sky: '#3458C5',
  onEmerald: '#FFFFFF',
  onAmber: '#FFFFFF',
  onRose: '#FFFFFF',
  onSky: '#FFFFFF',
  infoSubtle: '#E8EDFF',
  successSubtle: '#E5F5F0',
  warningSubtle: '#FFF2E0',
  dangerSubtle: '#FCE9EC',
  qrSurface: '#FFFFFF',
};

export const darkColors: ThemeColors = {
  bg0: '#0B1324',
  bg1: '#101A2A',
  panel: '#131F31',
  panelSolid: '#152236',
  panel2: '#19283D',
  panel3: '#22334A',
  input: '#0E1835',
  control: '#19283D',
  border: '#2B3C55',
  borderStrong: '#415776',
  text: '#F0F4FF',
  muted: '#B3C0D7',
  faint: '#8394B0',
  primary: '#A9B8FF',
  primaryPressed: '#C3CCFF',
  onPrimary: '#0E1835',
  brandAccent: '#8C99D6',
  money: '#E0A071',
  emerald: '#55D4AD',
  amber: '#F0B46A',
  rose: '#FF9AA7',
  sky: '#AABAFF',
  onEmerald: '#062E26',
  onAmber: '#352109',
  onRose: '#2C1020',
  onSky: '#0E1835',
  infoSubtle: '#1A2853',
  successSubtle: '#10352E',
  warningSubtle: '#3A2A15',
  dangerSubtle: '#3B1D2A',
  qrSurface: '#FFFFFF',
};

export interface MobileTheme {
  scheme: ThemeScheme;
  colors: ThemeColors;
  reducedMotion: boolean;
  statusBarStyle: 'light' | 'dark';
  shadows: {
    card: string;
  };
}

function themeForScheme(scheme: ThemeScheme, reducedMotion: boolean): MobileTheme {
  const isDark = scheme === 'dark';
  return {
    scheme,
    colors: isDark ? darkColors : lightColors,
    reducedMotion,
    statusBarStyle: isDark ? 'light' : 'dark',
    shadows: {
      card: isDark ? '0 12px 28px -20px rgba(0, 0, 0, 0.90)' : '0 12px 26px -20px rgba(28, 42, 68, 0.24)',
    },
  };
}

const ThemeContext = createContext<MobileTheme | null>(null);

/** System-preference theme boundary. Runtime tenant color never enters this semantic palette. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const scheme: ThemeScheme = systemScheme === 'light' ? 'light' : 'dark';
  const reducedMotion = useSystemReducedMotion();
  const theme = useMemo(() => themeForScheme(scheme, reducedMotion), [reducedMotion, scheme]);
  return createElement(ThemeContext.Provider, { value: theme }, children);
}

export function useTheme(): MobileTheme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside ThemeProvider.');
  return theme;
}

/** User accessibility preference is sampled once at the theme boundary, not per control. */
function useSystemReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReducedMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

/** User accessibility preference used only for non-essential visual motion. */
export function useReducedMotion(): boolean {
  return useTheme().reducedMotion;
}

/** Returns a translucent version of a semantic hex token for local decoration only. */
export function alpha(color: string, opacity: number): string {
  const hex = color.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return color;
  const channel = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16);
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${Math.max(0, Math.min(1, opacity))})`;
}

/** Status is semantic; screens must not choose a different color for the same state. */
export function badgeColor(colors: ThemeColors, value: string): string {
  switch (value) {
    case 'approved':
    case 'active':
    case 'paid':
    case 'used':
      return colors.emerald;
    case 'void':
    case 'failed':
    case 'revoked':
      return colors.rose;
    case 'payable':
      return colors.sky;
    case 'pending':
    case 'requested':
    case 'processing':
      return colors.amber;
    case 'draft':
    case 'inactive':
    case 'expired':
    case 'reversed':
    default:
      return colors.muted;
  }
}

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
  hero: 34,
} as const;

export const radius = {
  md: 12,
  lg: 18,
  pill: 999,
} as const;
