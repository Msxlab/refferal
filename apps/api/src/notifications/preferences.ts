import { NotificationChannel, Prisma } from '@prisma/client';

const CHANNELS = Object.values(NotificationChannel);

export type NotificationPrefs = Record<string, Partial<Record<NotificationChannel, boolean>>>;

export interface NotificationPreferenceRow {
  template: string;
  label: string;
  description: string;
  defaults: Record<NotificationChannel, boolean>;
  values: Record<NotificationChannel, boolean>;
  lockedChannels: NotificationChannel[];
}

const DEFAULTS: Record<string, Record<NotificationChannel, boolean>> = {
  commission_earned: { in_app: true, email: false, push: true },
  commission_reversed: { in_app: true, email: false, push: true },
  payout_sent: { in_app: true, email: true, push: true },
  team_member_joined: { in_app: true, email: false, push: true },
  verify_email: { in_app: false, email: true, push: false },
  password_reset: { in_app: false, email: true, push: false },
  security_alert: { in_app: true, email: true, push: false },
};

const LABELS: Record<string, { label: string; description: string }> = {
  commission_earned: { label: 'Commission earned', description: 'A commission was credited to your account.' },
  commission_reversed: { label: 'Commission adjusted', description: 'A sale was voided and a commission was reversed.' },
  payout_sent: { label: 'Payout sent', description: 'A payout was processed for your account.' },
  team_member_joined: { label: 'New team member', description: 'Someone joined under your referral tree.' },
  verify_email: { label: 'Email verification', description: 'Account activation and email verification links.' },
  password_reset: { label: 'Password reset', description: 'Password reset links and account recovery.' },
  security_alert: { label: 'Security alert', description: 'Important account security events.' },
};

const LOCKED: Record<string, NotificationChannel[]> = {
  verify_email: [NotificationChannel.email],
  password_reset: [NotificationChannel.email],
};

export function normalizeNotificationPrefs(value: unknown): NotificationPrefs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: NotificationPrefs = {};
  for (const [template, channels] of Object.entries(value as Record<string, unknown>)) {
    if (!DEFAULTS[template] || !channels || typeof channels !== 'object' || Array.isArray(channels)) continue;
    const next: Partial<Record<NotificationChannel, boolean>> = {};
    for (const channel of CHANNELS) {
      const raw = (channels as Record<string, unknown>)[channel];
      if (typeof raw === 'boolean') next[channel] = raw;
    }
    if (Object.keys(next).length > 0) out[template] = next;
  }
  return out;
}

export function notificationPreferenceRows(value: unknown): NotificationPreferenceRow[] {
  const prefs = normalizeNotificationPrefs(value);
  return Object.entries(DEFAULTS).map(([template, defaults]) => {
    const lockedChannels = LOCKED[template] ?? [];
    const values = { ...defaults };
    for (const channel of CHANNELS) {
      values[channel] = lockedChannels.includes(channel) ? true : prefs[template]?.[channel] ?? defaults[channel];
    }
    return {
      template,
      label: LABELS[template]?.label ?? template,
      description: LABELS[template]?.description ?? '',
      defaults,
      values,
      lockedChannels,
    };
  });
}

export function notificationPrefsJson(value: unknown): Prisma.InputJsonValue {
  return normalizeNotificationPrefs(value) as Prisma.InputJsonObject;
}

export function notificationEnabled(template: string, channel: NotificationChannel, value: unknown): boolean {
  if ((LOCKED[template] ?? []).includes(channel)) return true;
  const prefs = normalizeNotificationPrefs(value);
  return prefs[template]?.[channel] ?? DEFAULTS[template]?.[channel] ?? true;
}
