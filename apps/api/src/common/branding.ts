import { Prisma } from '@prisma/client';

export interface PublicBrand {
  name: string;
  monogram: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
}

const DEFAULT_TAGLINE = 'Grow your referral network. Earn from real product sales.';
const DEFAULT_PRIMARY = '#D4AF37';
const DEFAULT_ACCENT = '#5B7CFA';

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, fallback: string, max: number): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function publicBrandFromTenant(tenant: { name: string; branding: Prisma.JsonValue | null }): PublicBrand {
  const branding = asRecord(tenant.branding);
  return {
    name: tenant.name,
    monogram: text(branding.logoText, tenant.name.slice(0, 1).toUpperCase(), 2),
    tagline: text(branding.tagline, DEFAULT_TAGLINE, 120),
    primaryColor: color(branding.primaryColor, DEFAULT_PRIMARY),
    accentColor: color(branding.accentColor, DEFAULT_ACCENT),
  };
}
