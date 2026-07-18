export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'Americana Earn';
export const APP_MONOGRAM = process.env.NEXT_PUBLIC_APP_MONOGRAM ?? 'A';

export interface RuntimeBrand {
  name: string;
  monogram: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
}

export const DEFAULT_RUNTIME_BRAND: RuntimeBrand = {
  name: APP_NAME,
  monogram: APP_MONOGRAM,
  tagline: 'Grow your referral network. Earn from real product sales.',
  primaryColor: '#384BB8',
  accentColor: '#6F7ACA',
};

export function normalizeRuntimeBrand(brand: Partial<RuntimeBrand> | null | undefined): RuntimeBrand {
  const primaryColor = brand?.primaryColor ?? '';
  const accentColor = brand?.accentColor ?? '';
  return {
    name: brand?.name?.trim() || DEFAULT_RUNTIME_BRAND.name,
    monogram: brand?.monogram?.trim().slice(0, 2) || DEFAULT_RUNTIME_BRAND.monogram,
    tagline: brand?.tagline?.trim() || DEFAULT_RUNTIME_BRAND.tagline,
    primaryColor: /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : DEFAULT_RUNTIME_BRAND.primaryColor,
    accentColor: /^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : DEFAULT_RUNTIME_BRAND.accentColor,
  };
}
