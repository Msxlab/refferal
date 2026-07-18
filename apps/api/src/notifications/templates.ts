/**
 * Notification templates. Default language is English; locale support can be layered later.
 * Money amounts arrive in payloads as string cents.
 */
const WEB_URL = (): string => process.env.WEB_URL ?? 'http://localhost:3000';
const APP_NAME = (): string => process.env.APP_NAME ?? 'Americana Earn';

function currencyFrom(payload: Record<string, unknown>, fallbackCurrency: string): string {
  const currency = typeof payload.currency === 'string' ? payload.currency : fallbackCurrency;
  return /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
}

function money(cents: unknown, currency: string): string {
  const n = Number(cents ?? 0) / 100;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
}

export interface Rendered {
  subject: string;
  body: string;
}

export function render(template: string, payload: Record<string, unknown>, fallbackCurrency = 'USD'): Rendered {
  const currency = currencyFrom(payload, fallbackCurrency);
  switch (template) {
    case 'verify_email':
      return {
        subject: `${APP_NAME()} - Verify your email address`,
        body: `To activate your account, use this verification link:\n${WEB_URL()}/verify-email?token=${payload.token}\n\nIf you didn't request this, you can safely ignore it.`,
      };
    case 'password_reset':
      return {
        subject: `${APP_NAME()} - Password reset`,
        body: `Use this link to reset your password (valid for 1 hour):\n${WEB_URL()}/reset-password?token=${payload.token}\n\nIf you didn't request this, you can safely ignore it.`,
      };
    case 'commission_earned':
      return {
        subject: 'You earned a new commission',
        body: `Congratulations! ${money(payload.amountCents, currency)} in commission was credited to your account (level ${payload.level}).`,
      };
    case 'commission_reversed':
      return {
        subject: 'Commission adjustment',
        body: `A sale was voided, so a ${money(payload.amountCents, currency)} adjustment was applied to your account (level ${payload.level}).`,
      };
    case 'payout_sent':
      if (typeof payload.batchId === 'string' && payload.batchId.length > 0) {
        return {
          subject: 'Payout settled',
          body: `Payout settled for the ${payload.period} period (${money(payload.totalCents, currency)}).`,
        };
      }
      return {
        subject: 'Payout status update',
        body: `Payout status update for the ${payload.period} period (${money(payload.totalCents, currency)}).`,
      };
    case 'payout_auto_requested':
      // Faz A3: esik dolunca otomatik talep acildi — para henuz cikmadi (onay bekler).
      return {
        subject: 'Your commission check is being prepared',
        body: `Good news! Your balance reached the payout threshold, so a check for ${money(payload.totalCents, currency)} is being prepared for the ${payload.period} period. It's pending review and will be mailed to your address on file once approved. Make sure your mailing address is up to date in your account.`,
      };
    case 'team_member_joined':
      return {
        subject: 'New member joined your team',
        body: payload.memberName ? `${payload.memberName} joined your team.` : 'A new member joined your team.',
      };
    case 'rank_up':
      // Faz D5: rutbe atlama kutlamasi
      return {
        subject: `You reached ${payload.rankName ?? 'a new rank'}! 🏆`,
        body: `Congratulations! You've climbed to the ${payload.rankName ?? 'next'} rank. Keep selling and growing your team to reach the next tier.`,
      };
    case 'bonus_awarded':
      return {
        subject: 'You won a campaign bonus! 🎉',
        body: `Congratulations! A ${money(payload.amountCents, currency)} bonus${payload.reason ? ` (${payload.reason})` : ''} was added to your payable balance.`,
      };
    default:
      return { subject: `${APP_NAME()} notification`, body: `Notification: ${template}` };
  }
}
