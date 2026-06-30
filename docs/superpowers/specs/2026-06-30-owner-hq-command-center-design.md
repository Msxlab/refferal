# Sahip HQ — Tek Çatı Komuta Merkezi (Alt-proje A)

Tarih: 2026-06-30
Durum: Tasarım onayı bekliyor (brainstorming çıktısı)

## Amaç

Platform sahibi (`platform_admin`) giriş yaptığı anda tüm şirketlere hakim olduğu tek bir
"komuta merkezi" görür: portföy özeti (brüt + net), kazanca göre şirket sıralaması ve kendisini
bekleyen işler. Bir şirkete tıkladığında HQ'dan **çıkmadan** o şirketin yönetim modüllerine
gömülü olarak iner (Model 1).

Bu alt-proje yalnız **sahip deneyimi + onu besleyen backend**'i kapsar. Markalı subdomain,
paylaşılan-cookie oturum ve yönlendirme altyapısı **Alt-proje B**'dedir.

## Kapsam dışı (Alt-proje B'ye ertelendi)

- Markalı `{şirket}.siten.com` subdomain'leri, wildcard DNS + wildcard TLS.
- `.siten.com` üzerinde paylaşılan-cookie oturum (localStorage → cookie geçişi).
- Subdomain → tenant çözen + rol bazlı yönlendiren Next middleware.
- Şirkete özel markalı login ekranı.

Alt-proje A **mevcut tek alan adında** çalışır: sahip yeni `/hq` rotasına iner (bugünkü
`/platform`'un yerini alır ve genişletir). Mevcut `/admin/*` ve `/app/*`, A boyunca bugünkü
haliyle çalışmaya devam eder.

## Mimari

### Ön yüz — `apps/web`

- **HQ kabuğu** (`/hq` layout): sol nav = `Genel bakış`, `Şirketler`. Üstte **global şirket
  seçici**. Bir şirket seçiliyken o şirketin modülleri (Satışlar, Üyeler, Ağ, Kampanyalar,
  Ödemeler, Çekler, Dönem, Denetim, Ayarlar) nav'a gelir; hepsi seçili şirkete scoped.
- **Komuta merkezi** (`/hq` index) — üç katman:
  1. **Portföy özeti**: brüt ciro (bu ay, tüm şirketler) · net kâr (brüt − üye komisyonu) ·
     ödenecek komisyon · aktif üye · şirket sayısı.
  2. **Şirket sıralaması**: kazanca göre sıralı satırlar; satıra tıklamak o şirketi aktif yapar
     ve drill-in eder.
  3. **Seni bekleyenler**: tüm şirketlerden toplanmış aksiyon sayıları — ödeme onayı (4-eyes),
     KYC/risk incelemesi, vadesi geçmiş fatura, finalize bekleyen kampanya. Her biri ilgili
     scoped görünüme götürür.
- **Şirket seçici**: header'da; tüm şirketleri listeler (mevcut `CommandPalette` deseni uygun).
  Seçim → aktif şirket bağlamı; URL `/hq/c/{companyId}/...`. `Genel bakış` = bağlamsız, portföy
  ekranı.
- **Gömülü drill-in**: `/hq/c/{companyId}/<modül>` rotaları, mevcut admin modül **gövdelerini**
  yeniden kullanır; veri seçili şirkete scoped. Bunun için her admin sayfasının gövdesi rota
  sarmalayıcısından ayrıştırılıp paylaşılan bir bileşene taşınır. Aynı bileşen iki kabukta mount
  edilir: bugünkü `/admin/<modül>` (şirketin kendi yöneticisi) ve `/hq/c/{id}/<modül>` (sahip).

### Arka yüz — `apps/api`

- **Portföy uç noktası** `GET /platform/overview` (yeni): portföy toplamları + leaderboard +
  bekleyen-iş sayıları tek yanıtta. Para matematiği tam sayı cent / `BigInt` (mevcut desen);
  float yok.
- **"Şirket adına davran" token'ı** `POST /platform/companies/:id/act-as` (yeni):
  `platform_admin` için o tenant'a scoped, god-yetkili access token döner — `tid = companyId`,
  `plat = true`, `role = tenant_owner` (o tenant içinde tam yetki). Böylece **mevcut admin uç
  noktaları** ek değişiklik olmadan yetkilendirir. Yalnız `platform_admin` çağırabilir; işlem
  audit log'a yazılır. Bu, mevcut `switchTenant` deseninin **üyeliksiz** platform-admin
  varyantıdır.
- Mevcut admin guard'larının bu token'ı (plat + tenant-scope + `role=tenant_owner`) kabul ettiği
  doğrulanır; `auth.can()` zaten `GOD_TIERS` için `true` döner.

## Veri akışı

1. Sahip giriş yapar (platform token) → `/hq` → `GET /platform/overview` → komuta merkezi render.
2. Şirket seçimi → `POST /platform/companies/:id/act-as` → dönen şirket token'ı saklanır →
   `/hq/c/{id}` → admin modül bileşenleri şirket token'ıyla veri çeker ve aksiyon alır.
3. `← Genel bakış` → şirket token'ı bırakılır, platform token'a dönülür → `/hq`.

Oturum saklama A'da mevcut mekanizmadır (localStorage). Platform token ile aktif şirket token'ı
ayrı tutulur; şirket token'ı "geçici aktif bağlam"dır, B'de cookie'ye taşınınca da aynı ayrım
korunur.

## Para / doğruluk

- Tüm tutarlar tam sayı cent; toplamlar `BigInt`; UI'da `money()` ile biçimlenir.
- **net kâr = Σ(onaylı satış geliri) − Σ(üye komisyonu: ödenmiş + ödenecek)**. Abonelik/billing
  (platform → şirket) tüm şirketler sahibin olduğu için **iç transferdir**; net'e dahil edilmez,
  ayrı bir "tahsilat/AR" göstergesi olarak durur.
- Aggregation tenant izolasyonunu korur: platform sorgusu tüm tenant'ları kapsar ama her satır
  doğru tenant'a atfedilir.

## Hata yönetimi

- `/platform/overview` hatası → retry'lı hata bandı (mevcut `periods`/`audit` deseni).
- `act-as` hatası → toast; sahip HQ'da kalır, bağlam değişmez.
- Şirketi olmayan sahip → boş durum ("İlk şirketini oluştur").
- Süresi dolmuş şirket token'ı → şeffaf yeniden `act-as` veya `Genel bakış`'a güvenli dönüş.

## Test

- **Backend**: `/platform/overview` toplama doğruluğu (brüt / net / ödenecek — sabit formül);
  `act-as` yalnız `platform_admin` tarafından çağrılabilir + audit kaydı + token kapsamı doğru;
  eşzamanlılık ve yetki (RBAC) testleri.
- **Frontend**: komuta merkezi mock veriyle render; şirket seçici bağlam kurar; drill-in modülü
  şirket token'ıyla mount eder; `Genel bakış`'a dönüş bağlamı temizler. Görsel QA dark + light
  (chrome-devtools, mevcut iş akışı).

## Kararlar (spec içinde sabit)

- Admin modülleri **yeniden kullanılır** (paylaşılan bileşene ayrıştırma) — kopyalama yok.
- net'e abonelik **dahil değil** (iç transfer); ayrı billing/AR göstergesi.
- Drill-in için **act-as token** yaklaşımı (Model 1 + mevcut `switchTenant` deseni) tercih edilir;
  her admin uç noktasına `companyId` override parametresi eklemek yerine.

## Sonraki faz

**Alt-proje B**: markalı subdomain'ler + paylaşılan-cookie oturum + yönlendirme middleware +
wildcard DNS/TLS. A tamamlanıp doğrulandıktan sonra ayrı bir spec olarak ele alınacak. A'nın
ürettiği `/hq` deneyimi B'de `hq.siten.com`'a taşınır; gömülü drill-in (Model 1) sahip akışını
değiştirmediği için B, A'yı bozmadan üstüne gelir.
