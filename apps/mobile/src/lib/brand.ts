export const APP_NAME = process.env.EXPO_PUBLIC_APP_NAME ?? 'Americana Earn';
export const APP_MONOGRAM = process.env.EXPO_PUBLIC_APP_MONOGRAM ?? 'A';
export const APP_TAGLINE =
  process.env.EXPO_PUBLIC_APP_TAGLINE ?? 'Grow your referral network. Earn from real product sales.';

export interface RuntimeBrand {
  name: string;
  monogram: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
}

export function normalizeRuntimeBrand(brand: Partial<RuntimeBrand> | null | undefined): RuntimeBrand {
  const primaryColor = brand?.primaryColor ?? '';
  const accentColor = brand?.accentColor ?? '';
  return {
    name: brand?.name?.trim() || APP_NAME,
    monogram: brand?.monogram?.trim().slice(0, 2) || APP_MONOGRAM,
    tagline: brand?.tagline?.trim() || APP_TAGLINE,
    primaryColor: /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : '#384BB8',
    accentColor: /^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : '#6F7ACA',
  };
}
