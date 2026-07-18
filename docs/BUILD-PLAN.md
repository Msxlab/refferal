# Refearn — Uygulama Planı (iş modeline göre)

> Mustafa'nın iş modeli netleştirmesinden sonra (2026-06-18). Çekirdek motor
> (satış→onay→otomatik komisyon→hesap güncelleme) BİTTİ. Bu plan, o motorun
> üzerine işin gerçek ihtiyaçlarını kurar.

## İş modeli (planı şekillendiren)
- **Ürün:** Dolap/cabinet satışı için referral/komisyon sistemi.
- **Akış:** Müşteri tavsiyeyle gelir → tavsiye edenin hesabına tutar işlenir →
  **minimum tutar dolunca adresine otomatik ÇEK gönderilir + e-posta bilgilendirme.**
- **Pay alanlar = aynı zamanda müşteri.** Düşük dolandırıcılık riski.
- **Kimlik:** Kullanıcı kayıtta kimlik bilgisini girer + **disclaimer imzalar**;
  doğru bilgiden KENDİSİ sorumlu. (Ağır banka-KYC / OFAC YERİNE bu.)
- **Dil:** Arayüz **komple İngilizce** (TR kaldırılacak).

### Bunun roadmap'e etkisi
- **DÜŞTÜ:** Zorunlu banka-KYC, gerçek OFAC SDN, ACH/NACHA banka transferi.
- **YENİ (çekirdek):** Disclaimer+kimlik kaydı · ÇEK ödeme hattı (adres, min-eşik
  otomatik gönder, çek register/yazdır, e-posta).
- **DURUYOR (yasal not):** 1099 vergi bildirimi ABD'de çekle de zorunlu —
  bu planın kapsamında DEĞİL (Mustafa'nın seçimi), muhasebeciyle teyit edilmeli.

---

## FAZ A — Gerçek ödeme akışı (işin kalbi) · EN ÖNCE
| # | İş | Ne / neden (sade) | Efor |
|---|---|---|---|
| A1 | **Kayıt: kimlik + disclaimer** | Kayıtta isim/adres/kimlik alanları + disclaimer onay kutusu (tarih+IP saklanır). Hukuki koruma + çek adresi buradan. | M |
| A2 | **Çek ödeme hattı** | ACH yerine ÇEK: adres-bazlı. Hesap min-eşiği dolunca **otomatik** ödeme oluştur → çek register'a düşer → yazdırılabilir çek/batch (PDF) → "paid" işaretle. | L |
| A3 | **Otomatik tetik + e-posta** | Komisyon birikip min'i geçince gece job'u çeki oluşturur + üyeye "çekin yolda" e-postası. | M |
| A4 | **Çek makbuzu/geçmişi (üye)** | Üye cüzdanında "şu kadar çek geldi/yolda" + makbuz. Güven. | S |

## FAZ B — Para güvenliği & "bozulunca gör" · prod'a çıkış engelleri
| # | İş | Ne / neden | Efor |
|---|---|---|---|
| B1 | **Anında durdurma** | Üyeyi/şirketi askıya alınca erişim ANINDA kesilsin (şu an ~15dk gecikme). Altyapı session'larda kuruldu, admin'e bağlanacak. | M |
| B2 | **Para işleminde anlık yetki** | Ödeme/plan değişiminde yetkiyi canlı DB'den doğrula — yetkisi alınan para oynatamasın. | M |
| B3 | **Hızlı-ödeme alarmı** | Yeni hesap aniden büyük çek tetiklerse dondur+incele. | M |
| B4 | **Hata takibi (Sentry+log)** | Üretimde bir şey bozulunca SANA bildirim + ne olduğunu gör (şu an hatalar kayboluyor). | M |
| B5 | **Arka-plan işi sağlığı** | Çek-tetikleyen / komisyon-olgunlaştıran gece işleri takılırsa fark et + toparla + alarm. | M |
| B6 | **Nabız + alarm** | "Sistem ayakta mı, yedek taze mi" + kritik olayda Slack/e-posta. | S |
| B7 | **Saniyelik yedek (PITR)** | Çökerse 6 saatlik veri uçmasın — herhangi bir saniyeye dön. | L |

## FAZ C — Satılabilirlik (senin gelirin: SaaS) · Faz 5
| # | İş | Ne / neden | Efor |
|---|---|---|---|
| C1 | **Platform-admin paneli** | SEN yeni müşteri-şirket açıp askıya alacak panel (şu an boş). | L |
| C2 | **Faturalama (billing)** | Müşteri-şirketlerden abonelik geliri (Stripe vb.) — senin gelirin. | L |
| C3 | **Davet sayfası copy'si** | Davet linkine tıklayan "ne kazanacağım"ı görsün → daha çok katılım. | S |
| C4 | **Admin "yapılacaklar" kutusu** | Onay bekleyen satış, gönderilecek çek, incelenecek üye tek listede. | M |
| C5 | **Bildirim kutusu** | Uygulama-içi bildirim gelen-kutusu + tercihler (DB var, UI yok). | M |
| C6 | **"Üye gözünden bak" (destek)** | "Çekimi göremiyorum" diyene admin üyenin ekranından baksın (salt-okunur, kayıtlı). | M |

## FAZ D — Cila & büyüme · sonradan
| # | İş | Ne / neden | Efor |
|---|---|---|---|
| D1 | **Komple İngilizce** | TR kaldır, tüm arayüz tek dil İngilizce + tutarlı metin. | S |
| D2 | **Güven mesajı** | Çek makbuzu, "kitaplar denetlendi" rozeti, ödeme zaman çizelgesi. | M |
| D3 | **Daha derin raporlar** | Kim ayrılıyor, kohort, PDF çıktı → karar + profesyonellik. | L |
| D4 | **Plan simülatörü** | "$X satarsam kim ne kazanır" interaktif gösterim. | M |
| D5 | **Yarışma/rütbe cilası** | Kampanya bitiş kutlaması, rütbe atlama bildirimi. | M |
| D6 | **Erişilebilirlik** | Ekran-okuyucu uyumu, boş ekran yönlendirmeleri. | M |
| D7 | **Ölçek altyapısı** | Yük testi · deneme ortamı + otomatik güvenli güncelleme (CI/CD) · şirketler-arası ikinci veri kilidi (RLS) · sürüm geri-alma. | L |

---

## Sıra (öneri)
**A (gerçek ödeme) → B (güvenlik+görünürlük) → C (satış) → D (cila).**
A ve B "prod'a çıkış" engelleri; çek-ödeme olmadan iş yürümez, B olmadan
güvenli/görünür değil. C senin gelir motorun. D rekabet/cila.

## Kapsam dışı (bilinçli) — Mustafa kararı
Zorunlu banka-KYC · gerçek OFAC SDN · ACH banka transferi · binary/matrix
yerleşim (zaten Non-Goal). **1099 vergi** yasal olarak hâlâ geçerli → muhasebeci teyidi.
