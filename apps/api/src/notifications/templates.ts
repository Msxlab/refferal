/**
 * Bildirim sablonlari (TR; SPEC 10 i18n — EN ileride locale ile). Hem e-posta hem push
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
        subject: 'Refearn — E-posta adresinizi dogrulayin',
        body: `Hesabinizi etkinlestirmek icin dogrulama baglantisi:\n${WEB_URL()}/verify-email?token=${payload.token}\n\nBu islemi siz yapmadiysaniz gormezden gelin.`,
      };
    case 'password_reset':
      return {
        subject: 'Refearn — Sifre sifirlama',
        body: `Sifrenizi sifirlamak icin baglanti (1 saat gecerli):\n${WEB_URL()}/reset-password?token=${payload.token}\n\nTalep etmediyseniz gormezden gelin.`,
      };
    case 'commission_earned':
      return {
        subject: 'Yeni komisyon kazandiniz',
        body: `Tebrikler! ${money(payload.amountCents)} komisyon hesabiniza islendi (seviye ${payload.level}).`,
      };
    case 'commission_reversed':
      return {
        subject: 'Komisyon duzeltmesi',
        body: `Bir satis iptal edildigi icin ${money(payload.amountCents)} tutarinda duzeltme yapildi (seviye ${payload.level}).`,
      };
    case 'payout_sent':
      return {
        subject: 'Odemeniz gonderildi',
        body: `${money(payload.totalCents)} tutarindaki odemeniz ${payload.period} donemi icin islendi.`,
      };
    case 'team_member_joined':
      return {
        subject: 'Ekibinize yeni katilim',
        body: payload.memberName ? `${payload.memberName} ekibinize katildi.` : 'Ekibinize yeni bir uye katildi.',
      };
    default:
      return { subject: 'Refearn bildirimi', body: `Bildirim: ${template}` };
  }
}
