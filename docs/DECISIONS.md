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
