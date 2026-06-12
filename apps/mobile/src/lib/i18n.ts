// Mobil metinler (TR). SPEC 10: tum metinler dosyada; EN sozlugu eklenecek.
const tr = {
  'login.title': 'Uye Girisi',
  'login.email': 'E-posta',
  'login.password': 'Sifre',
  'login.submit': 'Giris yap',
  'login.error': 'E-posta veya sifre hatali',
  'common.loading': 'Yukleniyor...',
  'common.retry': 'Tekrar dene',
  'common.logout': 'Cikis',
  'tab.home': 'Ozet',
  'tab.wallet': 'Cuzdan',
  'tab.team': 'Ekibim',
  'tab.invite': 'Davet',
  'home.title': 'Kazanc ozetiniz',
  'home.month': 'Bu ay toplam',
  'home.pending': 'Bekleyen',
  'home.payable': 'Odenebilir',
  'home.paid': 'Odenen',
  'home.levels': 'Seviye dokumu',
  'home.level': 'Seviye',
  'wallet.title': 'Cuzdaniniz',
  'wallet.balance': 'Odenebilir bakiye',
  'wallet.request': 'Odeme talep et',
  'wallet.requested': 'Talebiniz alindi',
  'wallet.ledger': 'Hareketler',
  'wallet.history': 'Odeme taleplerim',
  'team.title': 'Ekibim',
  'team.members': 'Kisi',
  'team.active': 'Aktif',
  'team.privacy': 'Gizlilik geregi yalnizca seviye basina ozet gosterilir.',
  'invite.title': 'Ekibinizi buyutun',
  'invite.create': 'Davet olustur',
  'invite.share': 'Linki paylas',
  'invite.copied': 'Kopyalandi',
  'invite.mine': 'Davetlerim',
  'invite.empty': 'Henuz davet yok',
  'me.noData': 'Veri yok',
  'me.incomeNote':
    'Gecmis kazanclar gelecek kazanc garantisi degildir. Komisyon yalnizca gerceklesen urun satislarindan dogar.',
  'reg.title': 'Davetle Kayit',
  'reg.invalid': 'Davet gecersiz veya suresi dolmus',
  'reg.fullName': 'Ad Soyad',
  'reg.invitedBy': 'Davet eden',
  'reg.tenant': 'Isletme',
  'reg.submit': 'Kaydol',
};

export type MsgKey = keyof typeof tr;

export function t(key: MsgKey): string {
  return tr[key] ?? key;
}
