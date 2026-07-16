# Earnica Full-Product Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onaylı Earnica ürün spesifikasyonunu; public/auth, member, admin, HQ ve native mobile yüzeylerinde güvenilir finansal durum semantiği, premium Obsidian + Pearl görsel sistemi ve ölçülebilir erişilebilirlik/kalite kapılarıyla uçtan uca uygulamak.

**Architecture:** Çalışma yedi dikey plana ayrılır. Önce authoritative veri sözleşmeleri ve güven kapıları doğrulanır; ardından marka/token/primitive temeli kurulur. Public/auth, member, admin, HQ ve mobile yüzeyleri bu temelin üstünde bağımsız checkpoint'lerle yenilenir. Her route ailesi kendi API contract testini, source contract testini, typecheck'ini ve görsel/klavye kontrolünü geçmeden sonraki checkpoint'e taşınmaz.

**Tech Stack:** pnpm 10.29.2 monorepo, Turbo, Next.js 15.1.6, React 19, TypeScript 5.8, Tailwind CSS 4.3.1, shadcn 4.12, Radix UI, Lucide, NestJS 11, Prisma 6.6, Jest 29, Expo Router 4 / React Native 0.76.

## Global Constraints

- Kaynak spesifikasyon: `docs/superpowers/specs/2026-07-16-earnica-full-product-redesign-design.md`.
- Onaylı görsel referans: `docs/superpowers/specs/assets/earnica-operations-workspace-reference.png`.
- Kullanıcıya ait mevcut `tasks/plan.md` ve `tasks/todo.md` okunmaz, değiştirilmez veya üzerine yazılmaz.
- Dirty working tree korunur. `git reset`, `git clean`, blanket `git add .` ve dosya geri alma işlemleri yapılmaz.
- `.env*`, deployment config, package manifest ve lockfile değiştirilmez; yeni paket eklenmez.
- İç teknik adlar (`@refearn/*`, `refearn.session`, `refearn.theme`, `refearn.locale`) toplu yeniden adlandırılmaz. Yalnız kullanıcıya görünen marka Earnica olur.
- Görünen logo/illustration CSS art, placeholder, emoji, JSX çizimi veya elle çizilmiş SVG olamaz. Gerçek kaynak asset oluşturulur ve export edilir.
- Komisyon motoru, finansal formüller ve ödeme sağlayıcısı bu plan kapsamında yeniden tasarlanmaz.
- Para aritmetiği `number` üzerinden yapılmaz; cent değerleri string/BigInt-safe kalır ve her tutar ISO currency taşır.
- Server authority bulunmayan hiçbir durum tahmin edilmez. Lifecycle, capability ve hassas reveal `unknown/unavailable` iken fail-closed kalır. Readiness compliance alanları `unknown/not configured` görünür; mevcut payout mutation'ını kapatmaları yalnız aşağıdaki ayrı business-rule kapısı onaylanırsa etkinleşir, aksi halde ilgili spec acceptance BLOCKED kalır.
- UI görünürlüğü hiçbir zaman backend authorization yerine geçmez. Cross-tenant nesne erişimi 404, capability eksikliği 403 üretir.
- Her implementation task en fazla beş dosya içerir; daha büyük değişiklikler ayrı task ve commit olur.
- Her code task test-first ilerler: önce başarısız contract/regression testi, sonra minimum implementation, sonra ilgili doğrulama. Görsel asset/frame task'ları önce fail-fast existence/dimension/source/reference gate'i, sonra gerçek asset üretimi ve visual comparison uygular.
- Kullanıcının seçtiği tarayıcı dışında browser kullanılmaz. Playwright CLI veya doğrudan browser otomasyonu başlamadan önce açık izin alınır.

---

## Plan Seti

| Sıra | Plan | Sorumluluk | Başlangıç bağımlılığı |
| --- | --- | --- | --- |
| 0 | `2026-07-16-earnica-p0-data-contracts.md` | P0 authority matrisi, invite consent, explicit bulk/payout scope, readiness, lifecycle, tenancy ve assurance | Spec onayı |
| 1 | `2026-07-16-earnica-foundation-and-auth.md` | Gerçek marka asset'leri, tokenlar, shadcn primitive'leri, ortak shell, public/auth | P0 contract kararları |
| 2 | `2026-07-16-earnica-admin-operations.md` | Önce shell + ana Operations Workspace; sonra sales, members, network, payouts, audit, settings | Foundation + bulk/payout contracts |
| 3 | `2026-07-16-earnica-member-experience.md` | Member shell, home, wallet, direct recruits, invite, NPS ve koşullu Record sale | Foundation + admin main workspace + readiness/invite contracts |
| 4 | `2026-07-16-earnica-hq-experience.md` | HQ portfolio, company inspection ve shell konsolidasyonu | Foundation + shared workspace |
| 5 | `2026-07-16-earnica-mobile-experience.md` | Native brand/theme, auth/MFA/invite, Home/Wallet/Team/Invite parity | P0 contracts + foundation semantics |
| 6 | `2026-07-16-earnica-verification-and-rollout.md` | Sistem çapı visual, responsive, accessibility, performance, regression ve rollback | Tüm route checkpoint'leri |

Takip dosyası: `tasks/earnica-full-product-redesign-todo.md`.

## Doğrulanmış Mevcut Durum

- API unit baseline: `pnpm.cmd --filter @refearn/api test --runInBand` → 3 suite / 6 test geçti.
- Mobile baseline: `node apps/mobile/test/theme-architecture.cjs` ve `node apps/mobile/test/mfa-policy.cjs` geçti.
- Web source-reading contract pattern'i `node --test apps/web/src/app/admin/sales/page.contract.node.test.ts` ile çalışıyor.
- `apps/web/src/lib/auth-api.node.test.ts` ve `privileged-actions.node.test.ts`, extensionless TypeScript ESM importları yüzünden doğrudan Node runner ile çalışmıyor. Yeni dependency/test runner bu plan kapsamında eklenmeyecek; davranış API/Jest testleri, source-reading contract testleri, typecheck ve browser görevleriyle doğrulanacak.
- Web foundation, admin/HQ ve mobile route dosyalarının çoğu zaten dirty. Her task öncesi targeted diff alınacak ve yalnız o task'ın dosyaları stage edilecek.

## P0 Authority Kararları

Kaynak taraması şu sınırları doğruladı:

| Alan | Mevcut authority | Plan kararı |
| --- | --- | --- |
| Invite consent | Request ve DB consent kaydı yok | `InviteConsent` migration'ı ayrı açık onay gerektirir; onay olmadan kayıt UI'ı complete sayılmaz |
| Bulk sales scope | Yalnız `{ action, ids }`; preview/token/idempotency yok | Server preview + explicit scope + idempotency contract gerekir; kalıcı execution kaydı migration onayına bağlıdır |
| Payout batch scope | `membershipIds` omitted/empty → all eligible | Discriminated `selected` / `all_eligible` contract; `{}` ve `[]` 400 |
| Payout readiness | Email, balance, threshold ve active request var | Bu gerçek kurallar ortak evaluator olur. Address/KYC/fraud/sanctions/payment-method source yokken `unknown` blocker ile mutation'ı kapatmak bir iş kuralı değişikliğidir ve ayrı açık onay ister |
| Payment lifecycle | requested/processing/paid/rejected/failed + settledAt | Full review/fulfillment event authority yoktur. Legacy adapter yalnız kanıtlı state'leri gösterir; Under verification/Approved/Held/Issued/Mailed/Cleared/Reversed acceptance'ı yeni event/provider authority onaylanana kadar BLOCKED kalır |
| Sensitive bank data | Routing/account modeli veya response'u yok | Reveal UI eklenmez; response non-leak regression testi eklenir. Yeni bank-data sistemi bu planın dışında kalır |
| MFA assurance | MFA epoch ve mfaAt var; fresh step-up TTL yok | Privileged action fresh-step-up server policy'si ayrıca security onayı gerektirir; client TTL yazılmaz |
| Multi-currency | Tenant/member tek currency; HQ currency grupları var | Tenant içinde currency invariant'ı test edilir; HQ toplamları currency bazında ayrı kalır, FX toplamı üretilmez |
| NPS eligibility | Eligibility/dismissal persistence yok | Authoritative lifecycle eligibility + 90 günlük dismissal additive migration ile kurulur; migration onayı yoksa prompt gösterilmez |
| Member Record sale | Yalnız owner/admin/staff `sales.create`; member endpoint yok | Yeni self-service submission ayrı business-rule/API onayı gerektirir; onay yoksa Home bu CTA'yı göstermez |

### Uygulama öncesi açık yetki kapısı

Bu planın tam P0 sonucu için kullanıcıdan plan onayıyla birlikte şu state-changing/compatibility yetkileri açıkça alınmalıdır:

1. Invite consent, bulk idempotency ve NPS dismissal state için gerekli additive Prisma migration'larını oluşturma/uygulama yetkisi.
2. Invite resolve, sales bulk, payout scope/readiness, reports ve platform response'larındaki backward-incompatible API contract değişikliklerini versioned/cutover adapter ile uygulama yetkisi.
3. Kaynağı bulunmayan address/KYC/fraud/sanctions/payment-method kontrollerini `unknown` hard blocker yaparak mevcut payout request davranışını kapatma yetkisi. Onaylanmazsa bu alanlar UI'da “not configured” olarak görünür fakat full spec acceptance BLOCKED kalır.
4. Server-side 5 dakikalık fresh step-up ve recovery authority güvenlik politikası. Bu karar verilmezse hassas reveal ve freshness isteyen destructive eylemler kapalı/unsupported kalır.
5. Full payout event/provider authority ayrı bir ürün/API/schema çalışması olarak genişletilmedikçe Under verification, Approved, Held, Issued, Mailed, Cleared ve Reversed state'lerini uygulama dışı/BLOCKED kabul etme kararı.
6. Mevcut role/business rule'u genişleten member self-service `POST /app/sales` + `member.sales.submit` capability'sini uygulama yetkisi. Onaylanmazsa `Record sale` Home task'ı gösterilmez ve ilgili acceptance BLOCKED kalır.
7. ImageGen yön rasterından final path-based SVG üretmek için user-approved gerçek vector/design export aracı veya designer source sağlama kararı. Böyle bir source/tool yoksa marka SVG gate'i BLOCKED kalır; özel tracer/handcrafted SVG yapılmaz.

Address/KYC/fraud/sanctions/payment method için mevcut upstream authority bulunmadığından bu plan sahte provider veya manuel compliance sistemi icat etmez. Bu alanlar her durumda `unknown/not configured` görünür ve ready sayılmaz. Yalnız kapı 3 onaylanırsa payout request için blocker olur; onaylanmazsa legacy server request davranışı korunur ve full readiness acceptance BLOCKED kalır. Gerçek entegrasyon ayrı ürün/güvenlik projesidir.

## Bağımlılık Grafiği

```text
P0 authority audit
  ├─ invite consent contract ──> public/auth ──> member invite ──> mobile invite
  ├─ payout readiness/lifecycle ──> member wallet ──> admin payouts ──> mobile wallet
  ├─ explicit bulk/scope ──> admin sales + admin payouts
  └─ route/capability/tenancy ──> shared shells ──> admin/HQ destructive actions

brand assets + semantic tokens
  └─ shadcn primitives + AppShell + DecisionWorkspace + versioned acceptance frames
       ├─ public/auth
       ├─ member
       ├─ admin
       ├─ HQ
       └─ mobile semantic parity

all route checkpoints ──> final accessibility/performance/visual regression/rollout
```

## Checkpoint Sırası

### Checkpoint 0 — Baseline ve authority gate

- [ ] `git status --short` ile dirty sınırını kaydet; var olan değişiklikleri task ownership tablosuna yaz.
- [ ] P0 authority matrix testlerini önce başarısız çalıştır.
- [ ] Onaylanan schema/API sözleşmelerini uygula; onaylanmayan bağımlılıkları `unknown/unsupported` olarak kapat.
- [ ] API lint, unit ve dar integration suite'lerini geçir.
- [ ] P0 planındaki evidence tablosunu gerçek test sonucu ve endpoint alanlarıyla tamamla.

Exit gate: Invite tüketimi consent olmadan gerçekleşmez; empty/implicit all-scope mutation yoktur; readiness/lifecycle verisi server authority'den gelir; cross-tenant testleri geçer.

### Checkpoint 1 — Marka, token ve composition foundation

- [ ] Gerçek Earnica source artwork ve zorunlu export setini üret.
- [ ] Obsidian + Pearl light/dark semantic tokenlarını kur.
- [ ] shadcn primitive state/density sözleşmesini normalize et.
- [ ] AppShell, PageContext, StatePanel ve DecisionWorkspace composition'larını kur.
- [ ] BigInt-safe `FinancialValue` ve canonical lifecycle mapper'ları ekle.
- [ ] Spec Bölüm 19.3 versioned visual acceptance frame setini route implementation başlamadan repository'ye ekle ve yön referansıyla karşılaştır.
- [ ] Altı acceptance frame'ini kullanıcıya göster; yalnız explicit kullanıcı görsel onayından sonra manifesti `user-approved` yap. Onay gelmeden hiçbir route implementation task'ına başlama.
- [ ] PWA manifest/metadata'yı versioned Earnica icon/wordmark asset authority'sine bağla.
- [ ] Email/push ve CSV/export user-visible brand/terminology production yüzeylerini normalize et.

Exit gate: Altı frame explicit kullanıcı onayı alır; PWA manifest/metadata binding'i ve reference frame'e uygun foundation route'u light/dark/reduced-motion, 320–1440 responsive ve keyboard landmark testini geçer.

### Checkpoint 2 — Public/auth ve Admin ana workspace

- [ ] Cross-plan prerequisite AO-01 controlled request-header contract'ını foundation sonunda tamamla.
- [ ] Public landing ve auth shell'i tamamla.
- [ ] Login → MFA, verify/reset, enrollment ve invite acceptance state machine'lerini tamamla.
- [ ] Admin shell, Overview, LiveValueRail, decision queue ve full Decision Desk'i onaylı ana referansa göre tamamla.

Exit gate: Invite/login+MFA contract'ları ve Admin ana Operations Workspace reference comparison, keyboard, URL-state ve responsive contract'larını geçer.

### Checkpoint 3 — Member core ve Admin operations

- [ ] Member shell, Home, Wallet, Team direct recruit ve Invite Center vertical slice'larını bitir.
- [ ] NPS eligibility/dismissal'ı tamamla; ayrı business-rule onayı verilmişse Record sale akışını uygula, verilmemişse BLOCKED kaydet.
- [ ] Sales explicit scope + Decision Desk'i tamamla.
- [ ] Members, Network, Payouts ve Audit'i tamamla.
- [ ] Settings alt yüzeylerini capability/step-up davranışıyla tamamla.

Exit gate: Member readiness/remediation/direct recruit/invite görevleri ile Admin URL-state, selection/scope, partial retry, evidence/dock focus ve capability matrix testleri geçer.

### Checkpoint 4 — HQ ve native mobile

- [ ] HQ portfolio/company inspect yüzeylerini ortak shell'e taşı.
- [ ] Currency-grouped portfolio ve destructive company lifecycle eylemlerini doğrula.
- [ ] Native brand/theme ve auth/invite/MFA parity'yi tamamla.
- [ ] Native Home/Wallet/Team/Invite görevlerini tamamla.

Exit gate: HQ 404/403/cross-tenant ve native deep-link/background/offline/Dynamic Type matrisleri geçer.

### Checkpoint 5 — Sistem doğrulaması ve rollout

- [ ] Full typecheck/test/build/export matrix'ini çalıştır.
- [ ] İzinli Playwright browser route matrix'ini çalıştır.
- [ ] Native iOS/Android fiziksel/simulator matrisi tamamlanmadıysa unresolved olarak raporla.
- [ ] Reference + implementation screenshot karşılaştırmalarını yap ve farkları düzelt.
- [ ] Accessibility, performance ve rollback kanıtlarını kaydet.

Exit gate: Spec Bölüm 21'deki her acceptance criterion PASS veya açıkça BLOCKED kanıtına sahiptir; skipped kontrol PASS sayılmaz.

## Task Başına Git Protokolü

Her task için:

1. Task'ın `Files` listesinde yazan path'lerle `git status --short --`, `git ls-files --error-unmatch` ve `git diff --binary --` başlangıç kanıtını al; her path'i `tracked-clean`, `tracked-dirty`, `pre-existing-untracked` veya `task-new` olarak ownership ledger'a yaz. Pre-task content/diff/hash'i repository dışında `C:\tmp\earnica-baselines\{TASK_ID}` altında kaydet.
2. `pre-existing-untracked` dosya kullanıcıya aittir: bütün dosyayı task commit'ine alma. Task bu dosyayı gerektiriyorsa ya kullanıcıdan o exact dosyayı adoption/stage etmek için ayrı onay al ya da değişikliği commitless bırak. `task-new` yalnız task başladıktan sonra oluştuğu hash/evidence ile kanıtlanır.
3. En fazla beş dosyada test-first değişiklik yap; pre-existing user hunks/content'i değiştirme. Task geri alınacaksa saved baseline ile yalnız task diff'ini `apply_patch` üzerinden tersine uygula; `git checkout/reset` kullanma.
4. İlgili dar testi ve typecheck'i çalıştır.
5. Aynı task path'lerinde `git diff --check --` ve pre-task baseline'a göre yeni hunk karşılaştırması yap.
6. Task başında clean olan dosya exact path ile stage edilebilir. Tracked-dirty dosyada yalnız HEAD/index üzerine yeniden bazlanmış, reviewed task-only patch'i `git apply --cached` ile non-interactive stage et; bütün dirty dosyayı `git add path` ile stage etme. `git add -p` ancak kullanıcı açıkça interaktif seçim yapıyorsa kullanılabilir.
7. `git diff --cached --check`, `git diff --cached --name-only` ve `git diff --cached` ile staged içeriğin baseline user hunks/content'ini içermediğini kanıtla.
8. Task hunk'ı user hunk'ına bağımlı/overlap ise veya separation/adoption kanıtlanamıyorsa mixed/untracked dosyayı commit etme; task'ı commitless/blocked olarak raporla ve user değişikliğini koru.
9. Scope temizse task planındaki exact commit mesajıyla commit et.

## Ortak Doğrulama Komutları

PowerShell execution-policy sorunu nedeniyle yerel çalıştırmada `pnpm.cmd` kullanılır:

```powershell
pnpm.cmd --filter @refearn/web lint --incremental false
pnpm.cmd --filter @refearn/web build
pnpm.cmd --filter @refearn/mobile lint
node apps/mobile/test/theme-architecture.cjs
node apps/mobile/test/mfa-policy.cjs
pnpm.cmd --filter @refearn/mobile export:check
pnpm.cmd --filter @refearn/api lint
pnpm.cmd --filter @refearn/api test --runInBand
pnpm.cmd --filter @refearn/api test:int
pnpm.cmd lint
pnpm.cmd test
pnpm.cmd build
```

Dar web source contract örneği:

```powershell
node --test apps/web/src/app/admin/sales/page.contract.node.test.ts
```

Dar API integration örneği:

```powershell
pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/auth.int-spec.ts test/payouts.int-spec.ts
```

## Dosya Sahipliği ve Çakışma Önleme

- `apps/web/src/app/globals.css` ve `apps/web/src/components/ui.tsx` yalnız foundation checkpoint'inde ana sözleşme değişikliği alır; sonraki route task'ları semantic token ve ortak component tüketir.
- `apps/web/src/lib/i18n.ts` foundation'da key/type sözleşmesini kurar; route planları yalnız kendi namespaced copy key'lerini sıralı task'larla ekler. Aynı anda iki task bu dosyayı düzenlemez.
- `apps/web/src/lib/api.ts` cross-plan prerequisite AO-01'de controlled header/idempotency sözleşmesiyle genişletilir; ME-09 ve diğer route task'ları helper'ı değiştirmeden tüketir.
- `apps/api/prisma/schema.prisma` yalnız açık onaylı P0 migration task'larında değişir.
- `apps/mobile/src/theme.ts` mobile foundation task'ında tek sefer normalize edilir.
- Aynı anda çalışan ajanlar aynı route/layout dosyasını düzenlemez; task checklist ownership lock olarak kullanılır.

## Completion Tanımı

Tamamlandı denebilmesi için:

- Spec Bölüm 4 route envanterinin tamamı Earnica shell/brand sistemine bağlıdır.
- Spec Bölüm 21 kabul kriterleri kanıt tablosunda PASS veya gerçek external blocker olarak işaretlidir.
- User-visible eski marka `rg` taramasında yoktur; internal keys/package names hariç tutulur.
- P0 mutation ve financial state'ler server contract testleriyle korunur.
- Web typecheck/build, API lint/unit/required integration, mobile lint/tests/export geçer.
- İzin verilen browser ve erişilebilirlik matrisinin çıktıları kayıtlıdır.
- Native platform çalıştırılmadıysa ürün complete olarak sunulmaz; unresolved açıkça belirtilir.
- Kullanıcı dosyaları, env/deploy config, package/lock ve kapsam dışı finansal motor değişiklikleri yapılmamıştır.
