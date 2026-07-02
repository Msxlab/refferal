# Markalı Subdomain'ler — Üye/Admin Kapısı (Alt-proje B)

Tarih: 2026-07-01
Durum: Onaylandı (sohbette onaylandı: "önerdiğin şekilde uygula")

## Amaç

Alt-proje A'nın "Sonraki faz" bölümünde ertelenen kapsam: her tenant'ın kendi markalı
subdomain'inden (`{slug}.{ROOT_DOMAIN}`) giriş yapabilmesi, platform sahibinin ayrı bir
`hq.{ROOT_DOMAIN}` kapısından girmesi. Kod tarafı bu spec'in konusu; wildcard DNS/TLS/deploy
Mustafa'nın VPS'inde ayrı bir adım (bu spec kapsamında değil).

## Kritik keşif: paylaşılan-cookie oturuma gerek YOK

İlk brainstorm'da varsayılan "localStorage → `.domain` cookie göçü" gereksiz çıktı: drill-in
zaten **gömülü** (Model 1, Alt-proje A) — sahip hiçbir zaman `{slug}.domain`'e gitmiyor, hep
`hq.domain` içinde `/hq/c/{id}/...` altında kalıyor. Yani subdomain'ler arası paylaşılan oturuma
ihtiyaç yok; her subdomain zaten ayrı bir origin, mevcut `localStorage` oturumu (`refearn.session`)
olduğu gibi çalışır. Bu, canlı para sistemindeki en riskli değişikliği (auth mekanizması göçü)
**tamamen kapsam dışına** alır. B, saf bir **yönlendirme + markalama** katmanıdır.

## Mimari

### Ortam değişkeni — tek kapı

- `NEXT_PUBLIC_ROOT_DOMAIN` (yeni, opsiyonel): boşsa **tüm yeni davranış no-op'tur** — bugünkü
  tek-domain akışı olduğu gibi çalışır. Bu, üretimde geri alınabilir bir "aç/kapa" anahtarıdır;
  operatör hazır olduğunda değişkeni set eder.
- Yerelde doğrulama: `NEXT_PUBLIC_ROOT_DOMAIN=lvh.me` (lvh.me → 127.0.0.1, gerçek DNS gerekmez).
  `hq.lvh.me:3010`, `{slug}.lvh.me:3010` gibi adreslerle test edilir.

### `apps/web/src/lib/subdomain.ts` (yeni, paylaşılan saf fonksiyonlar)

- `slugFromHost(host)` / `isHqFromHost(host)` — port'lu `host` string'i alır (middleware'de
  `request.headers.get('host')`, client'ta `window.location.host`), `ROOT_DOMAIN` boşsa `null`/`false`
  döner. `hq` ve boş/`www` etiketleri slug SAYILMAZ.
- `currentSlug()` / `isHqHost()` — client-only ince sarmalayıcılar (`window.location.host` okur).
- Middleware'in path/URL manipülasyonuna GEREK yok — client zaten `window.location.host`'tan
  slug'ı kendi okuyabiliyor. Middleware yalnız **route guard** (yanlış kapıyı engellemek) içindir.

### `apps/web/src/middleware.ts` (yeni)

- `ROOT_DOMAIN` boşsa: no-op (`NextResponse.next()`).
- `{slug}.{ROOT}` üzerinde `/hq*` istenirse → `/login`'e redirect (sahip kapısı tenant
  subdomain'inden sızmaz — bu yönün legit bir istisnası yok).
- `hq.{ROOT}` üzerinde `/admin*`/`/app*` **BİLEREK engellenmiyor** (revize, 2026-07-01 audit):
  HQ drill-in'in önceden var olan "View as member" akışı (`MembersPageContent.viewAsMember` →
  `/app`) ve impersonation çıkışı (`app/layout.tsx exitImpersonation` → `/admin`) tam bu
  host'tan bu path'lere geçiş yapıyor; ilk taslakta bu path'leri `hq.{ROOT}`'ta engelleyen bir
  kural vardı ve bu akışı dead-end'e sokuyordu (audit bulgusu, HIGH, doğrulandı, düzeltildi).
  `/app` ve `/admin` zaten kendi client-side + API-seviyeli yetki kontrollerini host'tan
  bağımsız yapıyor — ekstra bir host bazlı sınıra ihtiyaç yok.
- Aksi halde (apex/`www`/eşleşmeyen host — ör. bugünkü `earn.oppeinnj.com` `ROOT_DOMAIN` set
  edilmeden önce) dokunmadan geçirir — **geriye dönük tam uyumluluk**.
- DB/API çağrısı YOK (edge-safe, hızlı, bağımsız çalışır çalışmaz).

### Backend — `GET /auth/tenant-brand/:slug` (yeni, `@Public()`)

- `AuthController`'a eklenir (zaten `@Public()` + throttled sınıf). Girişten ÖNCE marka
  bilgisi (isim, `Tenant.branding` JSON — `logoText/tagline/primaryColor/accentColor`, alanlar
  zaten var, bkz. `Brand.tsx`) döner.
- Yalnız `status: active` tenant döner; bulunamayan/askıya alınmış → `404` (ayrım yapılmaz —
  askı durumu girişten önce sızdırılmaz).
- Aynı throttle grubunda (dk'da 10/IP) — slug enumeration'a karşı zaten korumalı.

### Rezerve slug düzeltmesi (mevcut kod hatası, B'nin önkoşulu)

- `platform.controller.ts`'teki `createCompanySchema` slug regex'i bugün `hq`, `www`, `api`,
  `admin`, `app`, `login` gibi rezerve kelimeleri ENGELLEMİYOR. Böyle bir slug'lı şirket
  oluşturulursa middleware/login mantığı onunla çakışır (`hq` sahip kapısıyla karışır).
  **Düzeltme**: slug şemasına şu sabit blocklist eklenir (tam liste, genişletilebilir):
  `hq`, `www`, `api`, `admin`, `app`, `login`, `platform`, `auth`, `assets`, `static`, `cdn`,
  `mail`, `ns1`, `ns2`. Şema seviyesinde `.refine()` ile reddedilir (`400`).

### Login sayfası (`apps/web/src/app/login/page.tsx`) davranış değişikliği

- Mount'ta `slug = currentSlug()`, `hq = isHqHost()` okunur.
- `slug` varsa: `GET /auth/tenant-brand/:slug` çağrılır → başarılıysa marka (isim/logo/renk)
  gösterilir; `404` → jenerik "Şirket bulunamadı" mesajı, form gösterilmez (yanlış linke
  tıklayan kullanıcıyı bilgilendirir, giriş formunu göstermez).
- **Login backend'i DEĞİŞMEZ** (email+şifre, tüm üyelikler döner). Yalnız
  `completeLogin(session)` istemci mantığı genişler:
  - `hq && !session.user.isPlatformAdmin` → hata: "Bu giriş ekranı platform sahipleri içindir.",
    oturum kurulmaz.
  - `slug && session.user.isPlatformAdmin` → hata: "Platform sahipleri `hq.{ROOT}` adresinden
    giriş yapar." + link, oturum kurulmaz.
  - `slug && !isPlatformAdmin`: `session.memberships` içinde `tenantSlug === slug` eşleşmesi
    aranır (`MembershipSummary.tenantSlug` zaten var). Yoksa → "Bu hesabın bu şirkette üyeliği
    yok.", oturum kurulmaz. Varsa ve `activeMembershipId` farklıysa → mevcut
    `switchTenant()` + `applyTenantSwitch()` ile aktif üyelik bu tenant'a çevrilir, SONRA
    `setSession` + `landingForSession` ile iniş yapılır.
  - `slug` yoksa (apex/bugünkü domain): davranış birebir bugünkü gibi (regresyon yok).

## Veri akışı

1. Kullanıcı `{slug}.{ROOT}/login`'e gelir → marka çekilir (public, kimliksiz) → form gösterilir.
2. Email+şifre → `POST /auth/login` (değişmedi) → tüm üyelikler döner.
3. İstemci slug eşleşmesini kontrol eder → gerekiyorsa `switch-tenant` → iniş.
4. `hq.{ROOT}/login` aynı akış, yalnız `isPlatformAdmin` zorunluluğu ile.
5. Middleware yalnız yanlış-kapı isteklerini (ör. tenant subdomain'den `/hq`) sessizce
   `/login`'e yönlendirir — kullanıcı arayüzünde bir hata görmez, doğru kapıya geçer.

## Hata yönetimi

- `ROOT_DOMAIN` unset → tüm yeni mantık no-op, sıfır davranış değişikliği (var olan üretim
  `earn.oppeinnj.com` etkilenmez).
- Bilinmeyen/askıya alınmış slug → marka 404 → "şirket bulunamadı" ekranı (form yok).
- Slug var ama üyelik yok → login sonrası net hata, oturum kurulmaz (yanlış tenant'a
  sızma yok — zaten backend token her zaman kullanıcının GERÇEK üyeliklerinden birine
  scoped olurdu, ama YANLIŞ marka altında yanlış şirketin paneline inmeyi engelliyoruz).
- Rezerve slug çakışması → şirket oluşturmada backend validasyonuyla en baştan engellenir.

## Test

- **Backend**: `GET /auth/tenant-brand/:slug` — aktif tenant için 200 + doğru alanlar; bilinmeyen
  slug → 404; askıya alınmış tenant → 404 (aktif ile aynı görünür, ayrım sızmaz); throttle
  grubuna dahil olduğu doğrulanır. Rezerve slug blocklist — `createCompany` ile `hq`/`www` vb.
  denenince `400`.
- **Frontend**: `subdomain.ts` saf fonksiyonları (birim: çeşitli host string'leri → doğru
  slug/hq/null); login sayfası slug/hq dallarında doğru hata/iniş (mock). Yerel uçtan-uca:
  `lvh.me` ile gerçek tarayıcıda `hq.lvh.me`, bilinen bir şirket slug'ı, bilinmeyen slug,
  apex — 4 senaryo görsel doğrulama (dark+light).

## Kapsam dışı (bu spec'te YOK)

- Wildcard DNS, wildcard TLS, reverse-proxy config — Mustafa'nın VPS'i, ayrı deploy dokümanı.
- Şirkete özel custom domain (yalnız `{slug}.{ROOT_DOMAIN}` alt kümesi; müşterinin kendi
  domain'i değil).
- Cookie-tabanlı SSO / auth mekanizması değişikliği (yukarıda gerekmediği gösterildi).

## Kararlar (spec içinde sabit)

- Middleware yalnız **route guard**; slug çözümü/marka/üyelik mantığı **istemcide**
  (`window.location.host` + mevcut `switch-tenant`). Yeni bir sunucu-taraflı oturum/cookie
  mekanizması İCAT EDİLMEZ.
- `ROOT_DOMAIN` unset iken sıfır davranış değişikliği — üretime "aç/kapa" anahtarıyla,
  geri alınabilir şekilde entegre edilir.
