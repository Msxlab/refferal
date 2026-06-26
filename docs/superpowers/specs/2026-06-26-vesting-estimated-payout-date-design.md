# Faz E — Tahmini Ödeme Tarihi (Estimated Payout Date) · Tasarım

**Tarih:** 2026-06-26
**Durum:** Onaylandı (Mustafa), implementasyona hazır
**Kapsam:** Üye home + cüzdandaki "vesting toward payout" çubuğunu, tarayıcıda uydurulan tahminden gerçek bir backend tahmini ile değiştirmek.

---

## 1. Arka plan / problem

Sistem komisyonları **zaten gerçek** olarak olgunlaştırıyor: `LedgerEntry.status` `pending → payable → paid` akışı, `maturesAt` damgasına göre her 5 dk çalışan `engine.matureCommissions()` job'ı + tenant başına `MaturationRule` (on_approval / on_delivery / days_after_approval / days_after_delivery). Yani "bir komisyon ne zaman ödenebilir hale gelir" sorusunun gerçek cevabı DB'de `maturesAt` olarak duruyor.

**Sahte olan tek şey GÖSTERİM.** Üye `home/page.tsx` (`homeVesting()`, ~satır 49) ve `wallet/page.tsx` (`computeVesting()`, ~satır 53) "vesting toward payout" çubuğunu tarayıcıda uyduruyor:
- `vested = payable`, `accrued = pending + payable` (anlamsız hedef),
- ödeme tarihi = **ay sonu** (hardcoded),
- `perDay` lineer hız = tahmin.

Gerçek `maturesAt` verisini hiç kullanmıyor.

**Ödemeler eşik-tetikli, sabit ödeme günü YOK.** `payable ≥ tenant.payoutMinCents` (varsayılan $1.000) olunca her gün 06:00'daki `payouts.autoRequestPayouts()` bir `Payout(status=requested)` açıyor; sonra admin çek onayı veriyor. Dolayısıyla gerçekçi bir "tahmini ödeme tarihi" ancak **"ne zaman yeterince olgunlaşmış payable'a ulaşılacağı"ndan** türeyebilir.

## 2. Onaylanan kararlar

| Karar | Seçim |
|------|-------|
| Vesting'in anlamı | **Sadece tahmini ödeme tarihi.** Kovalar (pending/payable/paid) ve payout mantığı AYNEN kalır. Yeni para-durumu yok. |
| Tarih neyi temsil eder | **Eşik-aşım tarihi:** kümülatif (mevcut payable + `maturesAt` sırasıyla olgunlaşacak pending) ilk kez `payoutMin`'e ulaştığı gün = "ödemeye uygun olacak" tarih. |
| Hesaplama yeri | **Saklanan alan + job** (Yol 2). `Membership`'e alan, periyodik job günceller. |
| Tazeleme stratejisi | **Yaklaşım A:** `matureCommissions` (5dk) sonrası etkilenen üyeleri yeniden hesapla + günlük tam tarama. Advisory-lock ile çok-sunuculu güvenlik. |

## 3. Veri modeli (`Membership`)

İki **nullable, additive** alan — para durumu değil, türetilmiş gösterim verisi:

```prisma
// Faz E: tahmini ödeme tarihi. payoutMin'e ulaşılan gün; null = mevcut boru hattıyla ulaşılamıyor.
estimatedPayoutDate DateTime? @map("estimated_payout_date")
// Bu tahminin hesaplandığı an (tazelik/debug; bayatlama gözlemi için).
estimatedPayoutAt   DateTime? @map("estimated_payout_at")
```

Migration: `ALTER TABLE membership ADD COLUMN estimated_payout_date timestamptz, ADD COLUMN estimated_payout_at timestamptz;` — additive, mevcut satırlar `NULL` (ilk job turunda dolar). Index gerekmiyor (alanlar sıralama/filtre için değil, satır-içi okuma için).

## 4. Hesaplama fonksiyonu — `PayoutEstimateService`

Yeni servis: `apps/api/src/payouts/payout-estimate.service.ts`. Yalnız `PrismaService`'e bağımlı (ledger + tenant + membership okur); payouts modülünde yaşar çünkü `payoutMinCents` eşiği ve payout kavramları orada. Saf, **salt-okunur** (hiçbir para yazmaz). **BigInt cent** baştan sona — hiçbir yerde `Number()` ile para'ya dokunulmaz.

### `compute(membershipId, tenantId): Promise<{ estimatedPayoutDate: Date | null }>`

```
payoutMin  = tenant.payoutMinCents            (BigInt)
tz         = tenant.timezone
payable    = Σ amountCents WHERE membershipId, status=payable     (BigInt)

if (payable >= payoutMin):
    # zaten uygun → bir sonraki auto-request anı (tenant tz, sonraki 06:00)
    return nextAutoRequestAt(now, tz)

shortfall  = payoutMin - payable               (BigInt, > 0)
pending    = SELECT amountCents, maturesAt
             WHERE membershipId, status=pending, maturesAt IS NOT NULL
             ORDER BY maturesAt ASC
cum = 0n
for row in pending:
    cum += row.amountCents
    if (cum >= shortfall):
        return row.maturesAt          # bu gün eşik geçilir
return null                            # pending bitti, eşik geçilemedi
```

### Kenar durumlar (açıkça)
- **`maturesAt = null` pending** (teslimat bekleyen, `on_delivery` kuralı): yürüyüşten **hariç**. Sonuç temkinli olur (daha geç tarih veya `null`). Gerekçe: tarihi bilinmeyen bir komisyona dayanarak tarih uyduramayız.
- **`reversed`**: zaten `pending`/`payable` değil → doğal olarak hariç.
- **`payable ≥ payoutMin`** (uygun-şimdi): `estimatedPayoutDate = nextAutoRequestAt` (gelecek bir tarih, `null` DEĞİL). Böylece `null` kesinlikle "ulaşılamıyor" anlamını korur — anlam karışmaz.
- **`payable + Σpending < payoutMin`**: `null`.
- **BigInt**: tüm toplamlar/karşılaştırmalar BigInt; serileştirmede `.toString()`.

### `nextAutoRequestAt(now, tz)`
Auto-request `EVERY_DAY_AT_6AM` (tenant tz) çalışır. Sonraki 06:00'ı döndür: bugün 06:00'dan önceyse bugün 06:00, değilse yarın 06:00 (tenant tz'de hesapla, UTC `Date` döndür). Mevcut `monthKey()`/tz yardımcılarının yanına küçük bir saf fonksiyon.

## 5. Tazeleme (Yaklaşım A) + çok-sunuculu güvenlik

`PayoutEstimateService` ek metotları:

- **`refreshForMemberships(ids: string[]): Promise<void>`** — her id için `compute` + `Membership.update({ estimatedPayoutDate, estimatedPayoutAt: now })`. İdempotent (aynı girdi → aynı değer).
- **`refreshAllActive(): Promise<number>`** — `pending` veya `payable` bakiyesi olan tüm membership'leri bul (DISTINCT membershipId FROM ledger_entries WHERE status IN (pending,payable)), `refreshForMemberships` çağır. Döndürülen sayı = güncellenen üye.

### Tetikleyiciler
1. **Olgunlaşmaya bağlı (5 dk):** `engine.matureCommissions()` o turda olgunlaşan **etkilenen membershipId set'ini döndürür** (şu an döndürmüyor — küçük, contained değişiklik: matured entry'lerden DISTINCT membershipId topla). `scheduler` maturation sonrası `payoutEstimate.refreshForMemberships(affected)` çağırır. Ana sürücü ~5 dk tazelikte.
2. **Günlük tam tarama (~05:00):** `scheduler` yeni job `refresh-payout-estimates-sweep` → `refreshAllActive()`. Payout (payable düşer), void, yeni satış kaymalarını yakalar. **`pg_advisory_xact_lock(hashtext('payout-estimate-sweep'))`** ile tek-instance — codebase'in mevcut advisory-lock deseni (period locks).

### Neden bu güvenli
- Saf salt-okunur hesap; `Membership`'e iki türetilmiş alandan başka hiçbir şey yazmaz. Para kovalarına, payout'a, period-lock'a dokunmaz.
- Üye-bazlı refresh idempotent → iki instance aynı anda çalışsa bile aynı değeri yazar (zararsız). Sweep yine de advisory-lock'lu (gereksiz tam-tarama yükünü önler).
- `scheduler.runJob` sarmalayıcısı (hata → Sentry + log + lastRun izleme) aynen kullanılır.

## 6. API + istemci

### Backend payload eklemeleri
- **`/app/dashboard`** (`wallet.service.dashboard`): payload'a `estimatedPayoutDate: string | null` (Membership alanından, ISO veya null) **ve** `payoutMinCents: string` (şu an yalnız wallet'ta; çubuğun gerçek hedefi için home'da da gerekli).
- **`/app/wallet`** (`wallet.service.wallet`): payload'a `estimatedPayoutDate: string | null`. (`payoutMinCents` + bucket'lar zaten var.)

Alan `Membership`'ten okunur — endpoint'te hesaplama yok (saklanan değer).

### İstemci düzeltmesi
Sahte ay-sonu + `perDay` lineer tahmin **kaldırılır**.

- **Çubuk:** `vested = payable`, `hedef = payoutMin` (uydurma `accrued` değil), `pct = clamp(payable / payoutMin * 100, 0, 100)`.
- **Etiket mantığı:**
  - `payable ≥ payoutMin` → **"Ready · auto-requested"** (çubuk %100).
  - `payable < payoutMin && estimatedPayoutDate != null` → **"est. eligible {date}"** ("est." rozeti korunur).
  - `payable < payoutMin && estimatedPayoutDate == null` → **"Keep selling to reach {payoutMin}"**.
- `home/page.tsx homeVesting()` ve `wallet/page.tsx computeVesting()` + `payoutDateLabel()` buna göre sadeleşir. İstemci "uygun-şimdi"yi kendi `payable ≥ payoutMin` karşılaştırmasıyla anlar (her ikisi de payload'da) → saklanan tarih değeri istemci için ikincil.

## 7. Test

### Unit — `compute()` (saf, izole; DB mock veya test-DB)
- `payable ≥ payoutMin` → `nextAutoRequestAt` döner (bugün/yarın 06:00 tz mantığı doğru).
- belirli satırda eşik geçilir → tam o satırın `maturesAt`'i döner.
- pending biter eşik geçilemez → `null`.
- `payable + Σpending < payoutMin` → `null`.
- `maturesAt = null` pending hariç tutulur (sonuç temkinli/null).
- BigInt toplamları kayıpsız (büyük cent değerleri, `Number` precision sınırının üstü).
- `nextAutoRequestAt`: now < 06:00 → bugün 06:00; now ≥ 06:00 → yarın 06:00 (tenant tz).

### Entegrasyon (mevcut `notifications.int-spec` stilinde, recon_scratch/test DB)
- Olgunlaşma sonrası: pending→payable geçen üyenin `estimatedPayoutDate`'i güncellenir.
- Günlük tarama: pending bakiyeli üye için alan dolar; bakiyesiz üye atlanır.
- Advisory-lock: ikinci eşzamanlı sweep çağrısı bloklanır ama sonuç tutarlı (idempotent).

## 8. Sınırlar (değişMEYEN)

- Para kovaları `pending/payable/paid/reversed` — değişmez.
- Payout mantığı, eşik, `autoRequestPayouts`, çek onayı, period-lock — değişmez.
- Bu özellik ledger üzerinde **salt-okunur**; yalnız `Membership`'e iki türetilmiş alan yazar.
- Sistem **yalnız ABD pazarı, tek para birimi** (cent BigInt) — mevcut varsayımlar korunur.

## 9. Dosya dokunuş listesi (özet)

**Backend (`apps/api`)**
- `prisma/schema.prisma` — `Membership`'e 2 alan.
- `prisma/migrations/<ts>_membership_estimated_payout/migration.sql` — additive ALTER.
- `src/payouts/payout-estimate.service.ts` — YENİ (`compute`, `refreshForMemberships`, `refreshAllActive`, `nextAutoRequestAt`).
- `src/payouts/payouts.module.ts` — `PayoutEstimateService`'i providers/exports (scheduler enjekte edebilsin).
- `src/engine/engine.service.ts` — `matureCommissions()` etkilenen membershipId set'ini döndürür.
- `src/scheduler/scheduler.service.ts` — maturation sonrası `refreshForMemberships` + yeni `refresh-payout-estimates-sweep` günlük job (advisory-lock).
- `src/wallet/wallet.service.ts` — `dashboard` + `wallet` payload'larına `estimatedPayoutDate` (+ dashboard'a `payoutMinCents`).
- Test: `compute` unit + estimate entegrasyon spec'i.

**Frontend (`apps/web`)**
- `src/app/app/page.tsx` — `homeVesting()` + çubuk/etiket.
- `src/app/app/wallet/page.tsx` — `computeVesting()` + `payoutDateLabel()` + çubuk/etiket.
- İlgili payload tipleri (`Dashboard`, wallet arayüzleri) `estimatedPayoutDate` + `payoutMinCents`.
