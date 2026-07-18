import { sha256 } from '../common/crypto';

export const INVITE_DISCLAIMER_VERSION = '2026-07-16' as const;

// Registry entries are immutable acceptance bytes. Publish a new version instead of editing or removing an old entry.
export const INVITE_DISCLAIMER_REGISTRY = {
  '2026-07-16': {
    en: 'Earnings are not guaranteed. Commissions are calculated only from eligible, verified sales under the current program rules.',
    tr: 'Kazanç garanti edilmez. Komisyonlar yalnızca güncel program kuralları kapsamındaki uygun ve doğrulanmış satışlar üzerinden hesaplanır.',
  },
} as const;

export type InviteDisclaimerVersion = keyof typeof INVITE_DISCLAIMER_REGISTRY;
export type InviteDisclaimerLocale = 'en' | 'tr';

export interface InviteConsentSnapshot {
  disclaimerVersion: InviteDisclaimerVersion;
  locale: InviteDisclaimerLocale;
  disclaimerContentHash: string;
  tenantDisplayName: string;
  programSummary: string;
  programSummaryHash: string;
  acceptedAt: Date;
}

interface StoredInviteConsentSnapshot {
  disclaimerVersion: string | null;
  locale: string | null;
  disclaimerContentHash: string | null;
  tenantDisplayName: string | null;
  programSummary: string | null;
  programSummaryHash: string | null;
  acceptedAt: Date | null;
}

function disclaimerBody(version: string, locale: string): string | null {
  const registry = INVITE_DISCLAIMER_REGISTRY as Readonly<Record<string, Readonly<Record<string, string>>>>;
  return registry[version]?.[locale] ?? null;
}

function formatBasisPoints(poolRateBps: number): string {
  const sign = poolRateBps < 0 ? '-' : '';
  const absolute = Math.abs(poolRateBps);
  const whole = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  if (remainder === 0) return `${sign}${whole}`;
  if (remainder % 10 === 0) return `${sign}${whole}.${remainder / 10}`;
  return `${sign}${whole}.${remainder.toString().padStart(2, '0')}`;
}

export function createInviteConsentSnapshot(params: {
  disclaimerVersion: InviteDisclaimerVersion;
  locale: InviteDisclaimerLocale;
  tenantDisplayName: string;
  plan: { name: string; poolRateBps: number; depth: number; effectiveFrom: Date };
  acceptedAt: Date;
}): InviteConsentSnapshot {
  const body = disclaimerBody(params.disclaimerVersion, params.locale);
  if (!body) throw new Error('unsupported invite disclaimer');

  const percent = formatBasisPoints(params.plan.poolRateBps);
  const programSummary =
    params.locale === 'en'
      ? `${params.tenantDisplayName} · ${params.plan.name}: eligible, verified sales can reward up to ${params.plan.depth} referral levels within a ${percent}% commission pool.`
      : `${params.tenantDisplayName} · ${params.plan.name}: uygun ve doğrulanmış satışlar, %${percent} komisyon havuzu içinde en fazla ${params.plan.depth} referans seviyesini ödüllendirebilir.`;

  return {
    disclaimerVersion: params.disclaimerVersion,
    locale: params.locale,
    disclaimerContentHash: sha256(body),
    tenantDisplayName: params.tenantDisplayName,
    programSummary,
    programSummaryHash: sha256(programSummary),
    acceptedAt: params.acceptedAt,
  };
}

export function verifyStoredInviteConsentSnapshot(snapshot: StoredInviteConsentSnapshot): InviteConsentSnapshot | null {
  if (
    !snapshot.disclaimerVersion?.trim() ||
    !snapshot.locale?.trim() ||
    !snapshot.disclaimerContentHash?.trim() ||
    !snapshot.tenantDisplayName?.trim() ||
    !snapshot.programSummary?.trim() ||
    !snapshot.programSummaryHash?.trim() ||
    !snapshot.acceptedAt ||
    Number.isNaN(snapshot.acceptedAt.getTime())
  ) {
    return null;
  }

  const body = disclaimerBody(snapshot.disclaimerVersion, snapshot.locale);
  if (!body || sha256(body) !== snapshot.disclaimerContentHash || sha256(snapshot.programSummary) !== snapshot.programSummaryHash) {
    return null;
  }

  return {
    disclaimerVersion: snapshot.disclaimerVersion as InviteDisclaimerVersion,
    locale: snapshot.locale as InviteDisclaimerLocale,
    disclaimerContentHash: snapshot.disclaimerContentHash,
    tenantDisplayName: snapshot.tenantDisplayName,
    programSummary: snapshot.programSummary,
    programSummaryHash: snapshot.programSummaryHash,
    acceptedAt: snapshot.acceptedAt,
  };
}
