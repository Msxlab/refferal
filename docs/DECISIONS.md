# KARAR KAYDI (Decision Log)

Spec'teki (docs/SPEC.md) Bolum 14 acik kararlarinin ve gelistirme sirasinda alinan
teknik kararlarin kaydi. Spec ile celiski olursa bu dosya + spec birlikte okunur;
buradaki kararlar spec'in "acik karar" boslugunu doldurur, spec'i ezmez.

## Urun kararlari (2026-06-10, Mustafa)

| Karar | Deger |
|---|---|
| Calisma adi | **Refearn** (placeholder; routing/markayi etkilemez, rename kolay tutulur) |
| Cografya / timezone | Sistem yalnizca ABD'de calisacak. Tenant timezone varsayilani `America/New_York` |
| Payout min esigi | **$1.000** → `payout_min_cents = 100000` (tenant basina degistirilebilir) |
| Pasif uye komisyonu | MVP'de almaya **devam eder** (spec Bolum 7 notu; `tenants.inactive_members_earn` alani ile degistirilebilir) — is karari olarak ayrica teyit edilecek |

## Teknik kararlar

- **Para**: tum tutarlar `BIGINT` integer cent; oranlar `rate_bps` (basis points, 10000 = %100).
  Seviye tutari `floor(amount_cents * rate_bps / 10000)` — BigInt tam bolme ile.
- **0-cent satir**: floor sonucu 0 cikan seviye icin ledger satiri YAZILMAZ (gurultu);
  eksik upline ile ayni muamele — pay sirkette kalir.
- **Lokal portlar (bu makine)**: 5432/6379/3001 baska projelerce dolu. Refearn:
  Postgres **5434**, Redis **6380**, API **3101** (`apps/api/.env` PORT). Web 3000.
  Diger ortamlarda varsayilanlar serbest; yalnizca bu gelistirme makinesi icin kaydirildi.
- **Web auth (admin SPA)**: token'lar tarayicida localStorage'da; API client 401'de bir kez
  refresh dener, basarisizsa /login'e atar. CORS API'de `CORS_ORIGINS` ile acik. MVP tercihi;
  uretimde httpOnly cookie'ye gecilebilir.
- **memberships.path**: ltree-uyumlu TEXT (uuid'ler `-`→`_` cevrilip `.` ile birlestirilir).
  `ltree` extension migration'da aktif; GiST index ve ltree cast'i team_stats/agac sorgulari
  gerektirdiginde eklenecek. Motor, zinciri `sponsor_membership_id` uzerinden yuruyor
  (derinlik ≤ 8 oldugu icin yeterli).
- **Reversal muhasebesi** (voidSale):
  - `pending`/`payable` satir → orijinal `reversed` olur, esit-negatif reversal satiri
    `reversed` statusunde eklenir, summary'nin ilgili bucket'i dusulur.
  - `paid` satir → orijinal `paid` kalir (gercekten odendi), esit-negatif reversal satiri
    `payable` statusunde eklenir → bakiye eksiye duser, sonraki kazanclardan mahsup edilir.
- **Olgunlasma**: `on_approval` → satirlar direkt `payable`. `on_delivery` → `pending`,
  `matures_at` NULL; `delivered_at` set edilince satirlarin `matures_at`'i dolar ve
  `matureCommissions` job'i `payable` yapar. `days_after_approval(N)` → `pending`,
  `matures_at = approved_at + N gun`.
- **monthly_summaries ay anahtari**: `sale_date`'in tenant timezone'undaki `YYYY-MM` degeri.
- **team_stats snapshot stratejisi**: `team_stats` tablosu gelecekte buyuk agaclar icin snapshot/cache
  alanidir. Mevcut MVP'de uye ekip ozeti `memberships.path`/depth uzerinden canli hesaplanir; snapshot
  job ancak performans testi veya buyuk tenant ihtiyaci dogurursa etkinlestirilir.
- **Plan toplam kontrolu**: `SUM(level_rates) ≤ pool_rate` hem zod (API katmani) hem
  Postgres DEFERRABLE constraint trigger (DB katmani) ile.
- **RLS**: kritik tablolara ikinci kilit olarak auth fazinda (Faz 1 sonu) eklenecek;
  su an Prisma middleware + servis katmani tenant filtresi.
- **argon2**: `@node-rs/argon2` (Windows/Linux prebuilt binary; node-gyp derleme riski yok).
- **Test stratejisi**: saf dagitim fonksiyonu (`@refearn/shared/commission`) unit testlerle,
  motor (transaction/idempotency/concurrency) gercek Postgres'e karsi entegrasyon
  testleriyle (`refearn_test` DB). T1–T10 entegrasyonda, T1/T2/T3/T8/T9 ayrica unit'te.

## Inceleme bulgulari (ultracode adversarial review, 2026-06-11)

Motor T1–T10 yesil olduktan sonra 5-mercekli cok-ajanli inceleme kosuldu; her bulgu
3 bagimsiz refute denemesiyle dogrulandi. Bulgular ve duzeltmeleri (regresyon testleri:
`apps/api/test/engine-review-fixes.int-spec.ts` B1–B4):

- **B1 — void/mature ay anahtari tutarsizligi (Yuksek/para)**: `monthKey` her cagrida
  `tenant.timezone`'dan yeniden hesaplaniyordu; tenant timezone'u apply'dan sonra degisirse
  kredi ve dusum FARKLI `monthly_summaries` bucket'larina gidiyordu. **Cozum**: ay anahtari
  ilk apply'da hesaplanip `sales.summary_month`'ta DONDURULUR; void/mature bu degeri kullanir.
- **B2 — void↔mature yarisi (Yuksek/para)**: `voidSale` commission satirlarini kilitsiz
  okuyup statuye gore summary deltasi seciyordu; eszamanli `matureCommissions` araya girip
  `pending→payable` yaparsa bayat statu yuzunden hayalet `payable` (void edilmis satistan
  odeme) olusuyordu. **Cozum**: void artik satirlari `SELECT ... FOR UPDATE` ile kilitleyip
  TAZE statuyu okur; mature `SKIP LOCKED` kullandigi icin deadlock olmaz.
- **B3 — payout silinince ledger bagi kopuyor (Orta)**: `ledger_entries.payout_id` FK
  varsayilani SetNull'di; payout silinince `paid` satirin payout_id'si sessizce NULL oluyordu.
  **Cozum**: FK `ON DELETE RESTRICT` — bagli satir varken payout silinemez.
- **B4 — plan trigger yaris penceresi (Orta)**: `SUM(rate_bps) <= pool_rate_bps` DEFERRABLE
  trigger'i kilitsiz SELECT yapiyordu; READ COMMITTED altinda eszamanli iki level commit'i
  invariant'i asabiliyordu. **Cozum**: trigger SUM'dan once plan satirini `FOR UPDATE` ile
  kilitler (ayni plana yazimlar serilesir).
- **Deadlock dayanikliligi (Orta)**: eszamanli summary upsert'leri kilit sirasi farkindan
  40P01/40001 verebilir. **Cozum**: tum motor mutasyonlari `withTxRetry` ile sarildi
  (gecici hatada 5 kez yeniden dener).

## Analiz sonrasi kritik duzeltmeler (cok-ajanli derin analiz, 2026-06-11)

Admin+sistem 4-mercekli analiz + elestirmen incelemesi (462K token, 127 dosya). Bulunan
en kritik domino ve hizli guvenlik kazanimlari ANINDA duzeltildi:

- **Olgunlasma scheduler'i (MVP-kiran)**: `matureCommissions` metodu vardi ama onu cagiran
  zamanlanmis is YOKTU. Varsayilan `on_delivery`'de `markDelivered` yalniz `matures_at`
  doldurur, statuyu cevirmez → `pending→payable` gecisi hic olmazdi → payable hep bos →
  payout dongusu donuk. **Cozum**: `SchedulerModule` + `@Cron('*/5')` (SchedulerService).
  Testte kapali (cron cakismasi/yan etki), `scheduler.int-spec.ts` zinciri dogrular.
- **Rate-limit (spec ihlaliydi)**: `@nestjs/throttler` global guard (varsayilan 120/dk),
  auth uclari `@Throttle` ile 10/dk. MVP'de in-memory (tek instance); cok-instance icin
  Redis store'a gecilecek. Testte `skipIf NODE_ENV==='test'`. Runtime dogrulandi (429).
- **ActorContext modul bagimliligi**: `sales`'tan `common/actor.ts`'e tasindi; payouts/
  members artik yaprak sales modulune bagimli degil.
- **Secret fail-fast**: `JWT_ACCESS_SECRET` yoksa uretimde (`NODE_ENV=production`) uygulama
  acilmaz; dev fallback korunur. `apps/api/.env`'e gercek secret eklendi (env tutarsizligi giderildi).

**Henuz acik (analizde tespit, sirada/sonraki fazlar)**: uye web `/app` + public `/i/{code}`
(siradaki is), bildirim worker'i, JWT iptali (pasiflestirilen uye 15dk yetkili), RLS +
Prisma tenant-middleware, CSV formula-injection notrleme, e-posta dogrulama zorunlulugu,
admin UI eksikleri (agac/audit/ayarlar sayfalari, CSV import UI, onay diyaloglari, sayfalama),
2FA, yedek/Caddy/deploy, /healthz+gozlemlenebilirlik, 1099/income-disclosure.

## Luxury redesign — modul kararlari (tur 1, 2026-06-12)

Musteri "tasarim cok kotu, kucuk dusunuyorsun, uctan uca dusun" geri bildirimi sonrasi
docs/DESIGN-VISION.md + docs/PRODUCT-BLUEPRINT.md olusturuldu. Gorsel yon: **Obsidian &
Champagne** (light+dark, EN, Lucide, tabular para) — globals.css yeniden yazildi, tema toggle
+ EN-varsayilan i18n eklendi. Modul karar turu 1:
- **Network/agac**: react-flow **org-chart** (admin) + gizlilik-korumali **radial "My Network"**
  (uye), iki gorunum toggle. Girintili liste birakilir.
- **RBAC**: 5 sabit rol + **gorunur izin matrisi** (Settings > Roles; aksiyon x rol). Ozel roller
  Enterprise/Faz D.
- **Audit/log saklama**: **1 yil sicak**, sonra sifreli Google Drive arsivine + sicak tablodan sil
  (gece cron). Ayni mantik notifications (sent > 1 yil).
- **Auth/hesap**: **2FA (TOTP) + aktif oturumlar + Account sayfasi** simdi kurulur (self-hosted).
  SSO/SAML Faz 3.

## Uretim-hazirlik denetimi sonrasi "hemen kumesi" (2026-06-11)

Cok-ajanli uretim-hazirlik denetimi (guvenlik-ops / yedek-DR / dolandiricilik / uyumluluk)
sonrasi yuksek-getirili hizli sertlestirmeler uygulandi:
- **trust proxy + helmet**: `app.set('trust proxy', 1)` (Caddy arkasinda gercek IP cozulur —
  rate-limit/audit/IP-tespit bunsuz etkisizdi) + helmet (API); Caddyfile guvenlik basliklari
  (HSTS/X-Frame-Options DENY/nosniff/Referrer-Policy, -Server).
- **SoD maker-checker**: `Sale.createdBy` + `Tenant.requireSeparateApprover` (varsayilan kapali).
  Acikken satisi giren onaylayamaz; kapaliyken self-onay `security.self_approved_sale` audit'iyle
  isaretlenir. Admin ayarlar sayfasinda toggle.
- **E-posta dogrulama kapisi**: payout talebi `emailVerifiedAt` doluya bagli (sybil hesap kazanc
  cekemez). **Davet cap**: uye basina 50 aktif + 20/gun (sybil agac sismesi).
- **Guvenlik olay logu**: `security.login_failed`, `security.refresh_reuse_detected` audit + warn;
  guard'da `authz_denied` structured log (tespit/forensics tabani).
- **Yedek sertlestirme**: backup.sh `set -euo pipefail` + atomik `.part`->`mv` + retention yalniz
  basarili dumptan sonra & MIN_KEEP korumasi (onceki kod bozuk gunlerde saglam yedekleri silebilirdi).
  Opsiyonel **age sifreleme** + offsite + alarm.
- **Google Drive offsite**: `docker/backup/Dockerfile` (postgres+rclone+age), compose'da rclone-env
  ile Google Drive remote'u, `BACKUP_OFFSITE_CMD`, sifreli `.sql.gz.age`, `restore-test.sh` haftalik
  tatbikat. Kurulum + service-account adimlari docs/DEPLOY.md'de. Sirlar `docker/backup/secrets/`
  (gitignore). Test: 60 entegrasyon yesil.

**Kalan oncelikli acik (denetim yol haritasi)**: kill-switch uclari (tenant/uye suspend + token
iptali), payout anomali/velocity, JWT iptali (para uclarinda DB-teyit), Sentry+merkezi log+alarm,
self-sale engeli, KYC/odeme profili, RLS, 2FA, 1099/TIN, FTC income-disclosure, money-transmitter
hukuki gorus, PITR/WAL. Tam liste denetim raporunda (sohbet) + bu listede.

## Luxury redesign — modul kararlari (tur 2)

Mustafa onayiyla (12 Haz 2026), "her modulu ayri ayri sor" talebi geregi:

- **RBAC = ozel roller + izin matrisi.** `TenantRole` (kiracci-kapsamli; isSystem owner/admin/
  finance/support/analyst seed'leri + serbest ozel roller). `Membership.roleId` ince katman;
  enum `role` kaba katman (owner/platform god-mode). Izin katalogu kodda (`common/permissions.ts`,
  kaynak.eylem anahtarlari). JWT'ye `perms[]` gomulur (owner/platform'ta gomulmez — guard tum-izinli
  sayar). `@RequirePermission('x.y')` guard. Sistem rolleri `ensureSystemRoles` ile idempotent;
  acilista bos `role_id`'ler enum katmandan geri-doldurulur.
- **2FA = TOTP + e-posta OTP yedegi + kurtarma kodlari.** Sema hazir (`User.totpEnabledAt`,
  `mfaRecoveryCodes`, `UserTokenPurpose.login_otp`). Backend/UI sirada (Account + Settings>Security,
  login 2-adim challenge, aktif oturum listesi/iptal).
- **E-posta = esnek adaptor.** `createEmailAdapter()` env ile secer: `MAIL_PROVIDER=resend` (HTTP),
  `smtp` veya `SMTP_HOST` (nodemailer), aksi halde dev-console. HTML govde (markali sablon).
  Self-hosted ilke korunur — yalniz gonderim, kimlik dis serviste DEGIL.
- **Bildirim kanallari = uygulama-ici + e-posta + push** (webhook/Slack su an yok).
  `NotificationChannel.in_app` eklendi; relay'de in_app DB'de yasar (okunma `readAt`).
  Gelen-kutusu + zil + tercih matrisi sirada.
- **Settings Center** sekmeli: General / Brand (canli onizleme, branding JSON) / People & Roles
  (izin matrisi editoru + atama) / Security / Notifications / Data & Backup. Tam Ingilizce.
  Branding `tenant.branding` JSON'a yazilir (settings PATCH genisletildi).

## Adversarial guvenlik denetimi — RBAC + inbox (tur 1, 12 Haz 2026)

Cok-ajanli review (3 mercek + dogrulayicilar) 11 bulgu onayladi. Duzeltildi:
- **[critical] Yetki yukseltme** — create/updateRole, aktorun SAHIP OLMADIGI izinleri role yazabiliyordu
  (zod yalniz "bilinen anahtar" kontrol ediyordu). Fix: `assertGrantable(actorPerms, requested)` —
  owner/platform haric, istenen her izin aktorun etkin izin kumesinde olmali. (rbac.service/controller)
- **[high] assignRole self-target + tavan** — aktor kendi uyeligine rol atayabiliyordu; roleId tavani yoktu.
  Fix: `membershipId === actorMembershipId` (user.mid) reddedilir + atanan rolun izinleri aktorun
  kumesinin altkumesi olmali. Regresyon testi: `test/rbac.int-spec.ts` (4 senaryo yesil).
- **[medium] Owner pasife alinabiliyordu** → members.admin.setStatus owner-deaktivasyon guard'i (setRole ile simetrik).
- **[medium] notifications `before` cursor** — gecersiz tarih Prisma'ya Invalid Date dusuruyordu → dogrulanip yok sayilir.
- **[medium] branding kismi guncelleme** tum JSON'u eziyordu → mevcut branding ile birlestirilir.
- **[low] HTML e-posta esc()** tirnak kacisi eklendi (defense-in-depth).

**Bilincli erteleme/kabul** (MVP):
- **[medium] JWT perms tazeligi** — rol degisikligi access-token TTL'i kadar gecikir (perms claim'i token'da).
  Tasarim tradeoff'u: token-bazli yetki, istek-basi DB teyidi yok (performans). Kisa access TTL ile sinirli.
  Ileride `pv` (permission-version) claim'i + guard teyidi ile sertlestirilebilir.
- **[low] Bootstrap kilidi** — ensureSystemRoles/backfill her instance'ta calisir; upsert idempotent oldugu
  icin tek-instance MVP'de guvenli. Cok-instance'ta pg advisory lock onerilir.
- **[medium] Device upsert yeniden-iliskilendirme** — ayni cihaz token'i login'de yeni kullaniciya gecer;
  push semantigi geregi KASITLI (cihaz devri). Sunucu token sahipligini dogrulayamaz.
