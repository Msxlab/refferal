# REFERANS KOMİSYON SİSTEMİ — MASTER SPEC & BAŞLATMA PROMPTU

> **Nasıl kullanılır:** Bu doküman repo'nun tek doğruluk kaynağıdır. Tüm mimari kararlar burada kilitlidir; agent bu dokümana aykırı karar veremez, belirsizlikte buradaki kuralları esas alır. Geliştirme sırasında alınan kararlar için `docs/DECISIONS.md`'ye bakın.

---

## 0. ROL VE GÖREV (Agent için)

Sen kıdemli bir full-stack mimar ve geliştiricisin. Aşağıdaki spec'e birebir uyarak çok kiracılı (multi-tenant) bir referans/komisyon SaaS platformu geliştireceksin. Çalışma prensiplerin:

1. **Önce komisyon motoru, test-first.** Bölüm 11'deki test senaryoları geçmeden hiçbir UI yazılmaz.
2. Para hesaplarında asla float kullanma — tüm tutarlar **integer cent**.
3. Her şey Docker'da çalışır; dış servis bağımlılığı eklenmez (istisnalar: SMTP, Expo Push, app store'lar).
4. Şüphede kaldığında bu dokümanı esas al; dokümanda olmayan büyük kararlar için sor.

---

## 1. PROJE ÖZETİ

**Ne:** Şirketlerin satış-referans ağları kurup komisyon dağıttığı, self-hosted, çok kiracılı bir platform. Her üye davet linkiyle altına yeni üyeler ekler; satışlar onaylandığında komisyon, satıcıdan yukarı doğru sabit bir "kayan pencere" içinde otomatik dağıtılır.

**Kim:** İlk tenant'lar Axtra Solutions'ın yönettiği iki şirket (Oppein, Americana Studio — lüks mutfak/mobilya satışı). Platform baştan SaaS olarak tasarlanır; ileride başka şirketlere abonelikle satılır.

**Neden bu mimari:** Komisyon penceresi sabit derinlikte olduğu için (a) sistemdeki herkes, katılım sırasından bağımsız, kendi ağacının "birincisi" gibi kazanır; (b) şirketin satış başına maliyeti her zaman havuz yüzdesiyle sınırlıdır — ağ ne kadar büyürse büyüsün.

---

## 2. HEDEFLER / NON-GOALS

**Hedefler (MVP):**
- Davetle büyüyen ağaç + satış onayında otomatik, hatasız komisyon dağıtımı
- Üyenin mobilden kazancını (bekleyen/kesin/ödenen) anlık görmesi
- Tenant admininin satış girip onaylaması, payout'u manuel yönetmesi
- Şema ve auth baştan çok kiracılı

**Non-Goals (MVP'de YOK — bilinçli):**
- Otomatik ödeme entegrasyonu (Stripe Connect → Faz 2; MVP'de manuel "ödendi" işaretleme + banka CSV exportu)
- Self-serve tenant kaydı ve faturalama (→ Faz 3)
- Tenant başına white-label mobil app / custom domain (→ Faz 3)
- Binary/matrix MLM planları, spillover, re-parenting (ağaçta yer değiştirme) — **asla**: yerleşim kalıcıdır, sadece pasifleştirme vardır
- Üyenin alt ekibinin bireysel satışlarını görmesi (gizlilik modeli gereği)

---

## 3. KOMİSYON İŞ MANTIĞI (sistemin kalbi)

### 3.1 Model: Unilevel + Kayan Pencere
- Her satıştan tenant'ın belirlediği **havuz yüzdesi** ayrılır (varsayılan **%10**).
- Havuz, satıcıdan yukarı doğru **plan derinliği** kadar seviyeye dağıtılır.
- **Axtra şirketlerinin standart planı:** 5 kademe → Satıcı **%5**, 1 üst **%2**, 2 üst **%1,5**, 3 üst **%1**, 4 üst **%0,5** (toplam %10).
- Pencere **kayar**: herkes yalnızca kendi satışından + altındaki N-1 seviyeden kazanır. Daha derini görmez.

### 3.2 Tenant'a göre esneklik
- Her tenant kendi planını tanımlar: derinlik (1–8) + seviye oranları + havuz yüzdesi.
- **Doğrulama (DB + API katmanında):** `SUM(level_rates) ≤ pool_rate`, tüm oranlar ≥ 0, level 0 (satıcı) zorunlu.
- Planlar **versiyonludur** (`effective_from`). Oran değişikliği geçmişe asla uygulanmaz; her ledger satırı kullanıldığı oranı kendi içinde saklar.

### 3.3 Eksik upline kuralı
- Satıcının üstünde yeterli seviye yoksa (örn. kurucu satarsa), boş seviyelerin payı **dağıtılmaz, şirkette kalır**. Yukarı/aşağı yeniden dağıtım yok.
- `compression` (pasif üyeyi atlayıp bir üst aktife verme) tenant ayarı olarak şemada bulunur, **varsayılan KAPALI**, MVP'de UI'da yok.

### 3.4 Komisyon yaşam döngüsü (olgunlaşma)
```
sale: draft → approved → (delivered) → void?
ledger entry: pending → payable → paid   (+ reversed)
```
- Satış admin onayıyla `approved` olur → ledger satırları `pending` yazılır.
- **Olgunlaşma kuralı** (tenant ayarı): `on_approval` | `on_delivery` | `days_after_approval(N)`. Mutfak projeleri uzun döngülü ve iptal edilebilir olduğundan Axtra varsayılanı: `on_delivery`.
- İptal/iade: ledger satırları silinmez; eşit-ters **reversal** satırları eklenir. `paid` olmuş satır reverse edilirse üyenin bakiyesi eksiye düşebilir → sonraki kazançlardan mahsup edilir.

### 3.5 Para ve sayı kuralları
- Tüm tutarlar **integer cent** (`BIGINT`). Yuvarlama: her seviye tutarı `floor(sale_amount * rate)`; kalan kuruşlar şirkette kalır.
- Para birimi tenant başına tek (`currency`, varsayılan USD). Çoklu kur MVP dışı.

### 3.6 Yasal korkuluklar (tasarımın parçası)
- Komisyon yalnızca **gerçek ürün satışından** doğar. Kayıt/katılım ücreti yok. Recruitment'a ödeme yok.
- ABD: yıllık ≥ $600 ödeme alan üyeler için 1099-NEC export raporu (Faz 2).
- Üye arayüzünde gelir garantisi ima eden metin kullanılmaz (income disclosure prensibi).

---

## 4. KİMLİK, ERİŞİM VE ROUTING

### 4.1 Merkezi kimlik modeli
- `users` = **global hesap** (e-posta, şifre, profil). `memberships` = kullanıcının bir tenant'taki varlığı (rol, sponsor, referral kodu, ağaç konumu).
- Bir kullanıcı birden fazla tenant'ta üye olabilir (tek login). Girişte tek üyelik → direkt panel; çoklu → tenant seçici (son seçim hatırlanır).
- JWT claim'leri: `user_id`, `active_membership_id`, `tenant_id`, `role`.

### 4.2 Roller (RBAC)
`platform_admin` (Axtra) → `tenant_owner` → `tenant_admin` → `tenant_staff` (satış girer, payout ve plan göremez) → `member`.
Para etkileyen her aksiyon (onay, void, payout, plan değişikliği) audit log'a yazılır.

### 4.3 Routing

| URL | Yüzey |
|---|---|
| `x.com` | Public site (pazarlama + girişler) |
| `x.com/login` | Tek giriş — rol bazlı yönlendirme |
| `x.com/i/{invite_code}` | Davetle üye kaydı (tenant+sponsor koddan çözülür) |
| `x.com/app/*` | Üye paneli (web) |
| `x.com/admin/*` | Tenant yönetimi |
| `platform.x.com` | Platform süper-admin (sadece Axtra) |

- Üye kaydı **yalnızca davetle**. Açık kayıt yok.
- Mobil: store'da **tek app**; davet linki deep-link ile açılır, üyelik tenant'a bağlanır.

---

## 5. MİMARİ & STACK

**Monorepo (pnpm + Turborepo):**
```
apps/api      → NestJS (TypeScript) + Prisma
apps/web      → Next.js (public + /app + /admin + platform)
apps/mobile   → Expo (React Native)
packages/shared → zod şemaları, DTO'lar, sabitler, para yardımcıları
```

**Servisler (docker-compose):**
```
postgres:17   → tek veri kaynağı (ltree extension aktif)
redis:7       → session/rate-limit + BullMQ kuyruğu
api           → NestJS
web           → Next.js
caddy         → reverse proxy + otomatik TLS
backup        → günlük pg_dump → offsite hedef (cron container)
```

**Kurallar:**
- Auth tamamen self-hosted: JWT access (15dk) + refresh (rotasyonlu, DB'de hash'li), **argon2id**, e-posta doğrulama, şifre sıfırlama; `tenant_owner/admin` için TOTP 2FA (Faz 1 sonu).
- Dosyalar (profil foto, logo): MVP'de disk volume + API'den servis; ölçekte MinIO.
- Bildirim altyapısı: **outbox pattern** → BullMQ worker → Expo Push + SMTP e-posta. (DB transaction'ı bildirimi outbox'a yazar; gönderim asenkron.)
- Yasak: Supabase, Firebase, Auth0, harici BaaS. Postgres düz resmi image'dır.

---

## 6. VERİ MODELİ

Tüm tablolarda: `id (uuid)`, `created_at`, `updated_at`. Tenant-scoped tablolarda `tenant_id` + index. Prisma middleware her sorguya tenant filtresi zorlar; kritik tablolara Postgres **RLS** ikinci kilit olarak eklenir.

```
tenants            slug(uq), name, currency, pool_settings, maturation_rule,
                   payout_min_cents, branding(jsonb), status
users              email(uq), password_hash, full_name, avatar_path, locale,
                   email_verified_at, totp_secret?
memberships        tenant_id, user_id, role, sponsor_membership_id?,
                   referral_code(uq per tenant), path(ltree), depth,
                   status(active|inactive), joined_at
                   → UNIQUE(tenant_id, user_id)
                   → path = parent.path || own_id ; yerleşim DEĞİŞTİRİLEMEZ
invites            tenant_id, inviter_membership_id, code(uq), email?,
                   expires_at, used_by_membership_id?, status
                   → partial unique: aktif kodlar
commission_plans   tenant_id, name, pool_rate_bps, depth, effective_from,
                   created_by → tarihsel sorgu: satış tarihinde aktif plan
commission_plan_levels  plan_id, level(0..depth-1), rate_bps
                   → CHECK: SUM(rate_bps) ≤ pool_rate_bps (trigger ile)
sales              tenant_id, seller_membership_id, amount_cents, currency,
                   customer_ref?, sale_date, status(draft|approved|void),
                   approved_by?, approved_at?, delivered_at?, external_ref?
ledger_entries     tenant_id, sale_id, beneficiary_membership_id, level,
                   rate_bps_used, amount_cents, type(commission|reversal|adjustment),
                   status(pending|payable|paid|reversed), matures_at?,
                   payout_id?
                   → UNIQUE(sale_id, level, type) — çift ödeme imkânsız
                   → SİLİNMEZ, güncellenen tek alan status/payout_id
monthly_summaries  tenant_id, membership_id, month, level, pending_cents,
                   payable_cents, paid_cents  (motor transaction'ında güncellenir)
team_stats         tenant_id, membership_id, level, member_count, active_count
                   (gece job'ı ile)
payouts            tenant_id, membership_id, total_cents, method(manual|csv|stripe),
                   status(requested|processing|paid|failed), period, paid_at, ref?
                   → paid olduğunda ilgili ledger satırları paid + payout_id
devices            user_id, expo_push_token, platform, last_seen_at
notifications      (outbox) recipient, channel, template, payload, status
audit_logs         tenant_id?, actor_user_id, action, entity, entity_id,
                   before(jsonb), after(jsonb), ip, at
```

---

## 7. KOMİSYON MOTORU — ALGORİTMA

Uygulama katmanında, **tek Postgres transaction** içinde (Prisma `$transaction`, gerekli yerde raw SQL):

```
applyCommissions(sale_id):
  1. SELECT sale FOR UPDATE; durum 'approved' değilse veya ledger'da
     commission satırı varsa → no-op (idempotent)
  2. Satış tarihinde geçerli planı çöz (effective_from ≤ sale_date, en yeni)
  3. chain = satıcıdan yukarı sponsor zinciri, plan.depth kadar
     (membership.sponsor_membership_id takip; inactive üye compression
      kapalıysa payını YİNE alır — pasiflik sadece yeni davet/giriş kısıtlar*)
     *MVP kararı; tenant ayarıyla değiştirilebilir alan bırak
  4. for level in 0..depth-1:
       if chain[level] yoksa → skip (pay şirkette kalır, satır yazılmaz)
       amount = floor(sale.amount_cents * rate_bps / 10000)
       INSERT ledger_entries(..., status = maturation kuralına göre
              pending|payable, matures_at hesapla)
  5. monthly_summaries upsert (aynı transaction)
  6. notifications outbox'a "commission_earned" yaz
  7. COMMIT → BullMQ worker push/e-posta gönderir

voidSale(sale_id):
  - sale.status = void; mevcut her commission satırı için eşit-ters
    reversal INSERT; summary'ler düşülür; bildirim.

matureCommissions (job, 5dk'da bir):
  - matures_at ≤ now olan pending → payable; summary güncelle.
```

**Değişmezler (invariant — testlerle korunur):**
- Bir satışın ledger toplamı ≤ `amount * pool_rate`.
- `UNIQUE(sale_id, level, type)` sayesinde motor kaç kez çağrılırsa çağrılsın sonuç aynı.
- Ledger satırı asla silinmez/azalmaz; düzeltme = yeni satır.

---

## 8. MODÜLLER & API YÜZEYİ (NestJS)

`auth` `tenants` `users` `memberships+invites` `plans` `sales` `engine` `wallet(ledger+summaries)` `payouts` `notifications` `reports` `audit` `files` `platform`

Ana route grupları (REST, `/v1`):
```
POST /auth/login|refresh|logout ; POST /auth/register-by-invite
GET  /me ; GET /me/memberships ; POST /me/switch-tenant
GET  /app/dashboard          → ay özeti + seviye dökümü
GET  /app/team               → seviye başına sayılar (bireysel satış YOK)
GET  /app/wallet             → bakiye + ledger (kendi satırları)
POST /app/payout-requests
GET/POST /app/invites
ADMIN: /admin/sales (CRUD+approve+void+import), /admin/tree,
       /admin/members, /admin/plans(+simulate), /admin/payouts(+export.csv),
       /admin/reports, /admin/settings, /admin/audit
PLATFORM: /platform/tenants (CRUD+suspend), /platform/usage, /platform/health
```

`POST /admin/plans/simulate` → oran+derinlik+örnek ağaç alır, dağılımı döner (admin'deki canlı simülatörün backend'i; mevcut interaktif görseller bu endpoint'le komponentleşir).

---

## 9. YÜZEY ÖZELLİKLERİ (öncelikli liste)

### Üye — Mobil (Expo) + `/app` [P0]
Davet linkiyle kayıt (deep link) · profil+foto · ana ekran: bu ay kazanç, **pending/payable/paid** ayrımı, seviye dökümü, trend · ekibim: seviye başına kişi sayısı + yeni katılımlar · davet: link+QR+durum takibi · cüzdan: bakiye, payout talebi, geçmiş · push: "komisyon kazandın / ekibine katılım / ödemen gönderildi" · TR/EN.
[P1]: aylık PDF ekstre, rütbe rozetleri.

### Tenant Admin `/admin` [P0]
Dashboard (ciro, komisyon, üye, büyüme) · satış: ekle/CSV import/onay kuyruğu/void · ağaç görünümü (interaktif) · üyeler: davet/pasifleştir/rol · payout: payable liste → "ödendi" + banka CSV · ayarlar: marka, olgunlaşma kuralı, payout eşiği · audit log.
[P1]: plan editörü + canlı simülatör, raporlar/top performer, staff rolü kısıtları, 2FA zorunluluğu.
[P2]: CRM webhook ile otomatik satış (Monday.com vb.), rütbe bonus motoru.

### Public site [P0 minimal]
Landing (interaktif komisyon ağacı demo gömülü) · giriş/işletme girişi · `/i/{code}` kayıt. [P1]: fiyatlandırma, demo talep.

### Platform `platform.x.com` [P0 minimal]
Tenant aç/askıya al · kullanım özeti · sağlık (kuyruk, son yedek). [P2]: paket/limitler, faturalama, self-serve kayıt, audit'li impersonation.

### Gizlilik kuralları (kod seviyesinde zorlanır)
- Üye API'ları alt ekip için yalnızca **agregat** döner (sayı + kendi ledger'ı). Bireysel isim+satış eşleşmesi member rolüne asla dönmez.
- Yeni katılan üyenin adı "ekibine katıldı" bildiriminde görünür (satış verisi değil) — tenant ayarıyla kapatılabilir.

---

## 10. NON-FUNCTIONAL

- **Güvenlik:** OWASP temelleri; rate limit (Redis); brute-force kilidi; tüm girişler zod ile doğrulanır; SQL yalnızca Prisma/parametreli; CORS sıkı; secrets `.env` (repo'ya girmez).
- **Audit:** para/rol/plan etkileyen her aksiyon before/after ile loglanır.
- **Yedek:** günlük `pg_dump` + 30 gün saklama + offsite kopya; restore prosedürü README'de test edilmiş olarak.
- **Zaman:** DB'de her şey UTC; "ay" hesapları tenant timezone'una göre (tenant ayarı, varsayılan America/New_York).
- **i18n:** TR/EN, tüm metinler dosyada.
- **Gözlemlenebilirlik:** yapılandırılmış JSON log, `/healthz`, kuyruk metrikleri.

---

## 11. TEST SENARYOLARI (motor için zorunlu — önce bunlar yeşil olur)

Varsayılan plan: %10 havuz, 5 kademe = 500/200/150/100/50 bps.

| # | Senaryo | Beklenen |
|---|---|---|
| T1 | $100.000 satış, satıcının 4+ üst seviyesi var | 5.000/2.000/1.500/1.000/500 → toplam $10.000 |
| T2 | Kurucu satar (0 üst) | sadece satıcıya $5.000; başka satır yok; $5.000 dağıtılmaz |
| T3 | Satıcının yalnız 2 üstü var | 5.000/2.000/1.500 yazılır; L3/L4 satırı yok |
| T4 | `applyCommissions` aynı satışa 2. kez çağrılır | hiçbir yeni satır yok (idempotent) |
| T5 | Onaylı satış void edilir | her satıra eşit-ters reversal; üye net etkisi 0; summary düşer |
| T6 | Plan oranı değişir (effective_from=yarın), eski satış yeniden hesaplanmaz | eski ledger aynen; yeni satış yeni oranla |
| T7 | Olgunlaşma `on_delivery`: satış approved ama delivered değil | satırlar pending; delivered_at set → job payable yapar |
| T8 | Adalet: özdeş alt-yapıya sahip L1 üyesi ve L7 üyesi | iki üyenin toplam kazancı birebir eşit |
| T9 | Yuvarlama: $33.333 satış | her seviye floor; toplam ≤ %10; fark şirkette |
| T10 | Çift istek (paralel approve) | tek set satır (unique constraint + FOR UPDATE) |

---

## 12. FAZLAR & MVP TANIMI

**Faz 1 — MVP (tek aktif tenant: Oppein; şema çok kiracılı):**
Auth+memberships, davet/ağaç, satış+onay+void, motor (T1–T10 yeşil), üye mobil (dashboard+davet+cüzdan-görüntüleme), admin (satış/onay/üyeler/manuel payout+CSV), public `/i/{code}`, docker-compose tek komutla ayağa kalkar, yedek cron çalışır.

**Bitti sayılır:** Gerçek bir satış girilir → onaylanır → 5 üyenin mobilinde doğru tutarlar görünür → dönem sonunda CSV ile ödeme yapılır → biri void edilir ve bakiyeler doğru düşer.

**Faz 2:** plan editörü+simülatör, push bildirim tam akış, raporlar, 2FA, 1099 exportu, Americana ikinci tenant olarak açılır (gerçek multi-tenant doğrulaması), Stripe Connect payout, CRM webhook.

**Faz 3:** self-serve tenant kaydı + abonelik faturalama, paket/limitler, custom domain, white-label app, rütbe bonus motoru.

---

## 13. UYGULAMA SIRASI (agent'ın ilk adımları)

1. Monorepo iskeleti (pnpm+turbo) + docker-compose (postgres+redis) + CI'da lint/test.
2. Prisma şeması (Bölüm 6) + migration'lar + seed (1 tenant, varsayılan plan, örnek ağaç).
3. **Komisyon motoru servisi + T1–T10 testleri.** Hepsi yeşil olmadan ilerleme yok.
4. Auth (register-by-invite, login, refresh) + memberships + invite akışı.
5. Sales modülü (CRUD+approve+void) → motoru tetikler; wallet/summary endpoint'leri.
6. Admin web: satış+onay+üyeler+payout. 7. Üye web `/app`. 8. Expo app (login, dashboard, davet, cüzdan, push token kaydı). 9. Caddy+backup+deploy dokümanı.

---

## 14. AÇIK KARARLAR

> Karar verilenler `docs/DECISIONS.md`'de. Kalan açıklar:

- ~~Ürün/domain adı~~ → çalışma adı **Refearn** (placeholder, 2026-06-10).
- ~~Tenant timezone~~ → ABD-only, varsayılan `America/New_York` (2026-06-10).
- ~~Payout min eşiği~~ → **$1.000** varsayılan (2026-06-10). Dönem takvimi: aylık (teyit edilecek).
- Pasif üyenin komisyon hakkı (MVP: almaya devam eder — Bölüm 7 notu) iş kararı olarak teyit edilecek.
