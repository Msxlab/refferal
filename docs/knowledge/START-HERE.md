# Project Knowledge Vault — Start Here

Bu dosya, Referral/Earnica deposunda çalışan her yeni insan veya Codex oturumu
için zorunlu başlangıç noktasıdır. Vault Git tarafından sürümlenir; Obsidian
yalnızca bu aynı Markdown dosyalarını okuyan isteğe bağlı bir arayüzdür.

## Zorunlu başlangıç sırası

Herhangi bir dosyayı değiştirmeden, test çalıştırmadan, rebase/deploy yapmadan
veya yeni bir karar önermeden önce sırayla:

1. Root `AGENTS.md` dosyasını okuyun.
2. Bu `START-HERE.md` dosyasını tamamen okuyun.
3. Root [`CONTINUE-HERE.md`](../../CONTINUE-HERE.md) dosyasını **tamamen**
   okuyun. Bu adım zorunludur; vault handoff'un yerine geçmez.
4. `git status --short` çalıştırın ve amacı anlaşılmayan değişiklikleri koruyun.
5. Vault temel kayıtları mevcutsa, `CURRENT-STATE.md` dosyasını okuyun. Aktif
   release için önce `verification/current-release.md`, ardından `registry.md`,
   ilgili ADR/spec/plan ve açık riskleri okuyun.

Aktif release, payout veya deployment durumu `CONTINUE-HERE.md` ile taze
verification kanıtından belirlenir. Bir doküman çelişkisi fark edilirse sessizce
eski kaynağı değiştirmeyin; registry/risk kaydı açın ve kaynakları bağlayın.

## Kaynakların rolleri

- **Güvenlik ve çalışma sınırları:** `AGENTS.md` ve aktif
  `CONTINUE-HERE.md`.
- **Ürün/tasarım kararı:** güncel açık kullanıcı kararı ve kabul edilmiş ADR.
- **Fiili davranış:** runtime code ile taze test/deployment kanıtı.
- **Tarihsel bağlam:** registry'de `historical` veya
  `needs-reconciliation` olarak işaretlenen eski spec, plan ve audit kayıtları.

Bu roller tek bir “her durumda üstün” sıralama değildir. Örneğin taze test,
sistemin ne yaptığını kanıtlar; tek başına kabul edilmiş ürün kararını değiştirmez.

## Karar kaydetme protokolü

Kod veya davranış değişikliğinden **önce**, aşağıdakilerden biri seçilirse bir
ADR oluşturun ya da güncelleyin: ürün davranışı, para akışı, güvenlik/RBAC, veri
modeli, gizlilik, mimari, UI davranışı, release/deploy veya kapsam değişikliği.

Rutin keşif, küçük ilerleme ve deneme sonucu journal'a gider. Test/build/browser
QA/review/deploy sonuçları yalnız verification kaydına gider. Belirsiz fikirleri
karar gibi yazmayın; risk veya open item olarak kaydedin.

Her önemli kayıtta kaynak, tarih, karar sahibi, gerekçe, alternatif, etki ve
ilgili doğrulama bağlantısı bulunur. Onaylı bir render veya tasarım yönü,
implementation ya da production QA'nın geçtiği anlamına gelmez.

## Güvenlik ve gizlilik

Bu vault'a parola, token, API anahtarı, SSH private key, müşteri PII'ı veya
bağlantı dizesi yazmayın. Güvenlik olayı kaydedilecekse yalnız redakte edilmiş
özet, etki ve takip aksiyonu yazılır. Vault ve onun dokümantasyon kontrolü `.env`
dosyalarını okumaz veya vault'a kopyalamaz.

## Handoff ve doğrulama

Task 2 ile bu vault kayıtları oluşturulduktan sonra, bir task bittiğinde veya
çalışma kesildiğinde:

1. Journal'a kısa, tarihli ilerleme kaydı ekleyin.
2. Yeni kanıtı `verification/current-release.md` içine sonuç ve tarih ile yazın.
3. Açık riskleri/sahipleri güncelleyin.
4. Aktif branch durumu değiştiyse `CONTINUE-HERE.md`'yi güncelleyin.
5. `CURRENT-STATE.md` yalnız yönlendirme özeti olarak güncel kalsın; ayrıntıyı
   tekrar kopyalamayın.

Doğrulanmayan bir test, SSH erişimi veya deploy sonucu `not-run`, `stale` veya
`blocked` kalır. Başarılı olduğu varsayılmaz.

Vault temel kayıtları henüz yoksa placeholder oluşturmadan yalnız mevcut
`CONTINUE-HERE.md` handoff kuralını izleyin; Task 2 bu kayıtları oluşturacaktır.

## Obsidian kullanımı

Obsidian kullanmak isterseniz vault olarak depo kökünü açın. Kişisel görünüm ve
pencere ayarları `.obsidian/` altında local kalır ve Git'e girmez. Eklenti,
cloud-sync veya ikinci bir vault kurmak bu çalışma düzeninin parçası değildir.
