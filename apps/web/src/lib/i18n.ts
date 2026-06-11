// Minimal i18n (SPEC 10): varsayilan TR. Tum metinler burada (genisletilebilir).
const tr = {
  'app.title': 'Refearn Yonetim',
  'nav.dashboard': 'Panel',
  'nav.sales': 'Satislar',
  'nav.members': 'Uyeler',
  'nav.payouts': 'Odemeler',
  'nav.logout': 'Cikis',
  'login.title': 'Isletme Girisi',
  'login.email': 'E-posta',
  'login.password': 'Sifre',
  'login.submit': 'Giris yap',
  'login.error': 'E-posta veya sifre hatali',
  'common.loading': 'Yukleniyor...',
  'common.save': 'Kaydet',
  'common.cancel': 'Vazgec',
  'common.create': 'Olustur',
  'common.refresh': 'Yenile',
  'common.actions': 'Islemler',
  'common.total': 'Toplam',
  'dash.revenue': 'Bu ay ciro',
  'dash.commission': 'Bu ay komisyon',
  'dash.members': 'Uyeler',
  'dash.payable': 'Odenebilir bakiye',
  'dash.effRate': 'Efektif oran',
  'dash.pendingReq': 'Bekleyen talep',
  'sales.new': 'Yeni satis',
  'sales.seller': 'Satici (referral kod)',
  'sales.amount': 'Tutar (cent)',
  'sales.status': 'Durum',
  'sales.approve': 'Onayla',
  'sales.void': 'Iptal',
  'sales.deliver': 'Teslim',
  'sales.import': 'CSV ice aktar',
  'members.invite': 'Davet et',
  'members.deactivate': 'Pasiflestir',
  'members.activate': 'Aktiflestir',
  'members.role': 'Rol',
  'payouts.payable': 'Odenebilirler',
  'payouts.run': 'Odeme calistir',
  'payouts.export': 'CSV indir',
  'payouts.history': 'Odeme gecmisi',
};

export type MsgKey = keyof typeof tr;

export function t(key: MsgKey): string {
  return tr[key] ?? key;
}
