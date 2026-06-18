/**
 * Bildirim sablonlari (EN varsayilan; SPEC 10 i18n — locale ileride). Hem e-posta hem push
 * icin baslik+govde uretir. Para tutarlari payload'da string cent gelir.
 */
const WEB_URL = (): string => process.env.WEB_URL ?? 'http://localhost:3000';

function money(cents: unknown): string {
  const n = Number(cents ?? 0) / 100;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export interface Rendered {
  subject: string;
  body: string;
}

export function render(template: string, payload: Record<string, unknown>): Rendered {
  switch (template) {
    case 'verify_email':
      return {
        subject: 'Refearn — Verify your email address',
        body: `To activate your account, use this verification link:\n${WEB_URL()}/verify-email?token=${payload.token}\n\nIf you didn't request this, you can safely ignore it.`,
      };
    case 'password_reset':
      return {
        subject: 'Refearn — Password reset',
        body: `Use this link to reset your password (valid for 1 hour):\n${WEB_URL()}/reset-password?token=${payload.token}\n\nIf you didn't request this, you can safely ignore it.`,
      };
    case 'commission_earned':
      return {
        subject: 'You earned a new commission',
        body: `Congratulations! ${money(payload.amountCents)} in commission was credited to your account (level ${payload.level}).`,
      };
    case 'commission_reversed':
      return {
        subject: 'Commission adjustment',
        body: `A sale was voided, so a ${money(payload.amountCents)} adjustment was applied to your account (level ${payload.level}).`,
      };
    case 'payout_sent':
      return {
        subject: 'Your payout was sent',
        body: `Your payout of ${money(payload.totalCents)} was processed for the ${payload.period} period.`,
      };
    case 'payout_auto_requested':
      // Faz A3: esik dolunca otomatik talep acildi — para henuz cikmadi (onay bekler).
      return {
        subject: 'Your commission check is being prepared',
        body: `Good news! Your balance reached the payout threshold, so a check for ${money(payload.totalCents)} is being prepared for the ${payload.period} period. It's pending review and will be mailed to your address on file once approved. Make sure your mailing address is up to date in your account.`,
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
        body: `Congratulations! A ${money(payload.amountCents)} bonus${payload.reason ? ` (${payload.reason})` : ''} was added to your payable balance.`,
      };
    default:
      return { subject: 'Refearn notification', body: `Notification: ${template}` };
  }
}
