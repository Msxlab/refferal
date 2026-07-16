# Earnica Admin Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin yüzeyini kart yığını olmaktan çıkarıp; server-authoritative karar kuyruğu, URL ile paylaşılabilir çalışma bağlamı, evidence/impact/action inspector'ları ve güvenli finansal toplu işlemler içeren profesyonel Earnica Operations Workspace'e dönüştürmek.

**Architecture:** Admin route'ları shared `EarnicaShell` ve `DecisionWorkspace` composition'larını tüketir. List/filter/selection/inspector state'i URL'de tutulur. API; decision queue, server-side audit filters, explicit scope, paginated batch summary ve masked DTO'lar sağlar. UI capability ile görünürlüğü yönetir; server guard güvenlik sınırı kalır.

**Tech Stack:** Next.js 15/React 19, shared shadcn/Radix primitives, Nest/Prisma/Jest, existing `@xyflow/react` + `d3-hierarchy` network tooling.

## Global Constraints

- P0 ve foundation planları exit gate'i geçmeden bu plan release-ready değildir.
- `sales/page.tsx` ve `payouts/page.tsx` monolitleri tek seferde wholesale rewrite edilmez; task dilimleriyle parçalanır.
- Table row selection checkbox ve detail link/button ayrı semantik control olur.
- `selected` ve `all-results/all-eligible` hiçbir zaman implicit dönüşmez.
- FX yapılmaz; currency grupları ayrı gösterilir.
- UI permission filtresi security boundary değildir.
- Kaynakta olmayan issued/mailed/billing/bank-account state veya field uydurulmaz.

---

## Task AO-01: Controlled Request Header Contract'ını Ekle

**Files:**

- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/api-headers.contract.node.test.ts`

**Target API:**

```ts
type ApiRequestOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

api.post<T>(path, body, options?)
api.patch<T>(path, body, options?)
api.del<T>(path, options?)
```

- [ ] Source contract testte controlled headers merge, Authorization override yasağı, Idempotency-Key ve retry'da aynı options kullanımı beklentisini yaz; FAIL bekle.
- [ ] Caller header'larını allowlist/normalize et; auth/content headers caller tarafından override edilemesin.
- [ ] Refresh retry aynı body/header/idempotency key'i korusun.
- [ ] Contract test + web typecheck; PASS bekle.
- [ ] Commit: `feat: support controlled API request headers`.

## Task AO-02: Typed URL-State Foundation'ını Kur

**Files:**

- Create: `apps/web/src/lib/url-state.ts`
- Create: `apps/web/src/lib/url-state.contract.node.test.ts`

**Exports:**

```ts
parseEnumParam
parseBoundedIntParam
parseUuidParam
parseDateParam
parseRepeatedParam
setCanonicalSearchParams
```

- [ ] Source contract testte enum allowlist, bounded int, UUID, ISO date, repeated values, default removal ve deterministic key order beklentilerini yaz; FAIL bekle.
- [ ] Pure parser/serializer ekle; invalid input safe default ve unknown query preservation politikasını açık uygula.
- [ ] Search `q` 250 ms debounce; discrete filter immediate replace/push helper sözleşmesini dokümante eden exported constants ekle.
- [ ] Contract test + web typecheck; PASS bekle.
- [ ] Browser behavior later Back/Forward task'ında doğrulanacak; source testini behavior test diye sunma.
- [ ] Commit: `feat: add canonical admin URL state helpers`.

## Task AO-03: Admin Layout'ı Earnica Operations Shell'e Taşı

**Files:**

- Modify: `apps/web/src/app/admin/layout.tsx`
- Create: `apps/web/src/components/admin/AdminShell.tsx`
- Modify: `apps/web/src/components/NotificationBell.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/app/admin/layout.contract.node.test.ts`

- [ ] Contract testte Earnica primary brand, tenant context, capability-filtered nav, desktop rail/mobile nav, landmark/focus ve logout semantics'i yaz; FAIL bekle.
- [ ] Nav mapping: dashboard.view, sales.view, members.view, network.view, payouts.view, audit.view, settings.view.
- [ ] `AdminShell`i `EarnicaShell` ile compose et; role string yerine P0 `/me.capabilities` veya normalized session claims kullan.
- [ ] Client nav gizleme dışında server guard davranışını değiştirme.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: move admin into Earnica operations shell`.

## Task AO-04: Tenant-Scoped Decision Queue API'sini Ekle

**Files:**

- Modify: `apps/api/src/recommendations/recommendations.types.ts`
- Modify: `apps/api/src/recommendations/recommendations.controller.ts`
- Modify: `apps/api/src/recommendations/recommendations.service.ts`
- Modify: `apps/api/test/recommendations.int-spec.ts`

**Target DTO:**

```ts
interface DecisionQueueItem {
  id: string;
  kind: 'sale_approval' | 'sale_delivery' | 'payout_request' | 'payout_batch_stale';
  entityId: string;
  createdAt: string;
  amount: { cents: string; currency: string } | null;
  subject: { name: string; reference: string } | null;
  requiredPermission: string;
  destination: '/admin/sales' | '/admin/payouts';
}
```

- [ ] Integration testte tenant scope, live permissions, limit bound, priority ve cross-tenant absence beklentilerini yaz; FAIL bekle.
- [ ] `GET /admin/decisions?limit=12` ekle.
- [ ] Priority: stale processing batch → payout request → draft approval → delivery.
- [ ] Server sentence yerine typed kind/data dön; UI localize etsin.
- [ ] Test + API lint; PASS bekle.
- [ ] Commit: `feat: add admin decision queue`.

## Task AO-05: Admin Overview'u Onaylı Operations Workspace'e Dönüştür

**Files:**

- Modify: `apps/web/src/app/admin/page.tsx`
- Create: `apps/web/src/components/admin/DecisionQueue.tsx`
- Modify: `apps/web/src/components/workspace/LiveValueRail.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/app/admin/page.contract.node.test.ts`

**URL state:** `range`, `selected`.

- [ ] Contract testte LiveValueRail, queue, inspector, range/selected URL state, Back/Forward, no decorative chart ve state panels beklentilerini yaz; FAIL bekle.
- [ ] Existing dashboard/analytics values'ını value rail ve compact evidence'e taşı; KPI card soup ve decorative Donut'u kaldır.
- [ ] Decision click destination/type'a göre controlled inspector veya doğru route deep-link'i açsın.
- [ ] Desktop reference hiyerarşisi: ink rail, pearl canvas, single workspace surface, right Decision Desk.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: build Earnica admin operations workspace`.

## Task AO-06: Admin Dashboard Multi-Currency Doğruluğunu Sağla

**Files:**

- Modify: `apps/api/src/reports/reports.service.ts`
- Modify: `apps/api/test/admin.int-spec.ts`
- Modify: `apps/web/src/app/admin/page.tsx`
- Modify: `apps/web/src/app/admin/page.contract.node.test.ts`

**Target fields:** `revenueByCurrency[]`, `commissionByCurrency[]`, `payableByCurrency[]`.

- [ ] Mixed legacy sale/ledger fixture ile tek currency total üretilmemesi testini yaz; FAIL bekle.
- [ ] Report aggregation'ı currency group'ları döndürecek şekilde değiştir; tenant default ile yanlış etiketleme yapma.
- [ ] Value rail her currency'yi ayrı group render etsin; group count >1 ise “not converted or combined” açıklaması göster.
- [ ] API test + web contract/typecheck; PASS bekle.
- [ ] Commit: `fix: preserve currency boundaries in admin metrics`.

## Task AO-07: Sales List State'ini URL ve Decision Desk'e Taşı

**Files:**

- Modify: `apps/web/src/app/admin/sales/page.tsx`
- Modify: `apps/web/src/app/admin/sales/page.contract.node.test.ts`

**URL:** `q`, `status`, `from`, `to`, `min`, `max`, `page`, `sort`, detail için `selected=<recordId>`, bulk checkbox için repeated `checked=<recordId>`.

- [ ] Contract testte canonical params, reload/Back/Forward, `selected` detail inspector/object-fetch ve repeated `checked` visible-page bulk semantics ile invalid param fallback beklentilerini yaz; FAIL bekle.
- [ ] Local-only Filters/page/detail state'ini URL helpers ile controlled yap; saved views canonical query set etsin.
- [ ] Drawer yerine `DecisionWorkspace.Inspector`; ledger `EvidenceTimeline`; commission summary `Impact` kullan.
- [ ] Row click yerine detail link/button ve ayrı checkbox kullan.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: make sales workspace shareable`.

## Task AO-08: Sales Bulk Preview/Scope UI'sini Bağla

**Dependencies:** P0-06 ve P0-07.

**Files:**

- Modify: `apps/web/src/app/admin/sales/page.tsx`
- Create: `apps/web/src/components/admin/SalesBulkReview.tsx`
- Modify: `apps/web/src/app/admin/sales/page.contract.node.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`

- [ ] Contract testte zero selection disabled, selected eligible subset, explicit all-results choice, server preview count/currency, drift re-review, stable Idempotency-Key ve partial retry summary beklentilerini yaz; FAIL bekle.
- [ ] `ActionScopeGuard.Selected` ve `.AllResults` kullan; choice user gesture olmadan değişmesin.
- [ ] Preview response gelmeden confirm açma; count/totals değişirse mutation değil yeni review göster.
- [ ] Partial failures toast yerine persistent summary + failed subset retry action sun.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: connect reviewed sales bulk actions`.

## Task AO-09: Sales Import Wizard'ı Evidence-First Yap

**Files:**

- Modify: `apps/web/src/components/ImportWizard.tsx`
- Create: `apps/web/src/components/admin/ImportReviewSummary.tsx`
- Modify: `apps/web/src/app/admin/sales/page.contract.node.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`

- [ ] Contract testte upload → mapping → server preview → error rows → commit state sequence, currency summary ve keyboard semantics'i yaz; FAIL bekle.
- [ ] Existing API contract'ını koru; preview evidence olmadan final import action açma.
- [ ] Mapping errors field'e bağlı; error rows downloadable/copyable safe summary olarak sunulsun.
- [ ] Modal yerine responsive Dialog/Sheet primitive kullan; focus return doğrula.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: refine sales import review flow`.

## Task AO-10: Members Workspace'ini URL ve Idempotent Invite'a Taşı

**Files:**

- Modify: `apps/web/src/app/admin/members/page.tsx`
- Create: `apps/web/src/components/admin/MemberInspector.tsx`
- Modify: `apps/web/src/app/admin/members/page.contract.node.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`

**URL:** `q`, `status`, `page`, detail için `selected=<recordId>`.

- [ ] Contract testte URL restore; row'da membership state, payout readiness, role ve risk; detail dock'ta profile, readiness, network context, sanitized audit ve allowed actions; activation/role impact confirmation ve stable invite Idempotency-Key beklentilerini yaz; FAIL bekle.
- [ ] Invite attempt için payload-stable UUID key'i AO-01 helper ile gönder; retry aynı key, payload değişimi/success yeni key.
- [ ] Member detail/role/activation DecisionWorkspace inspector'da; profile/readiness/network/audit bölümleri aynı selected member bağlamında kalsın ve backend capability sonucu action görünürlüğünü belirlesin.
- [ ] Sensitive email/risk/audit detail'i allowlisted masked DTO dışında çıkarma; unknown readiness/risk'i safe status olarak göster.
- [ ] Empty/error/page states'i shared primitives ile uygula.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: redesign Earnica members workspace`.

## Task AO-25: Admin Network Query'sini Bounded Metadata Contract'ına Taşı

**Files:**

- Modify: `apps/api/src/members/members.admin.controller.ts`
- Modify: `apps/api/src/members/members.admin.service.ts`
- Modify: `apps/api/test/admin.int-spec.ts`

**Endpoint:** `GET /admin/members/tree?q=&limit=&focus=` → `{ items, total, returned, truncated, queryContext }`.

- [ ] Önce integration testte default/max limit, q/focus bağlamı, tenant/capability scope, deterministic order, `total`, `returned`, `truncated` ve no sensitive downline fields beklentilerini yaz; mevcut array-only response yüzünden FAIL bekle.
- [ ] Query response'unu bounded yap; `queryContext` yalnız normalize edilmiş q/focus ve applied limit taşısın, raw SQL veya hassas filtre detayı taşımasın.
- [ ] `truncated` yalnız server `total > returned` authority'sinden gelsin; client loaded row sayısından tahmin etmesin.
- [ ] Cross-tenant ID'yi 404/absence, yetkisiz rolü 403 yap; full-tree limitsiz fallback bırakma.
- [ ] Çalıştır: `pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/admin.int-spec.ts`; PASS bekle.
- [ ] Commit: `feat: bound admin network queries`.

## Task AO-11: Network Explorer'ı Controlled ve Erişilebilir Yap

**Files:**

- Modify: `apps/web/src/components/NetworkExplorer.tsx`
- Modify: `apps/web/src/app/admin/tree/page.tsx`
- Create: `apps/web/src/components/NetworkExplorer.contract.node.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`

**Dependencies:** AO-25.

**URL:** `view`, `q`, `focus`, detail için `selected=<recordId>`.

- [ ] Contract testte controlled props, backwards-compatible uncontrolled mode, ancestor expansion, truncated/partial result warning, selected path/level/direct parent/allowed financial context, inspector restore ve keyboard list alternative beklentilerini yaz; FAIL bekle.
- [ ] Graph/list tab state'ini URL'ye bağla; selected/focus ID invalidse safe reset.
- [ ] Search result ancestor yolunu açık tut; API/result cap yüzünden partial/truncated ise sessizce eksik göstermeyip warning + refine action sun; graph interaction'a eşdeğer list/detail action sağla.
- [ ] Selected node inspector'ında path, relative level, direct parent ve yalnız permission-allowlisted financial context'i göster; downline sensitive detail çıkarma.
- [ ] MiniMap/dekoratif controls yalnız görev değerliyse kalsın; small screen'de list primary olsun.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: make Earnica network explorer controlled`.

## Task AO-12: Payout Operations Summary ve Paginated Queue API'lerini Ekle

**Files:**

- Modify: `apps/api/src/payouts/payouts.types.ts`
- Modify: `apps/api/src/payouts/payouts.controller.ts`
- Modify: `apps/api/src/payouts/payouts.service.ts`
- Modify: `apps/api/test/payouts.int-spec.ts`

**Endpoint/DTO authority map:**

| Görünüm | Server authority | DTO / unavailable davranışı |
| --- | --- | --- |
| Overview | `GET /admin/payouts/overview?period=` | `PayoutOverviewDto`; counts ve `totalsByCurrency`, eksik page'den client aggregate yok |
| Requests | `GET /admin/payouts?view=requests&period=&page=&pageSize=` | `PayoutPageDto`; requested/review state + canonical presentation |
| Risk & Verification | `GET /admin/payouts/payable?readiness=blocked,unknown&q=&page=&pageSize=` | `PayableReadinessPageDto`; P0-08 reason/owner/remediation, provider detayı yok |
| Payable | `GET /admin/payouts/payable?readiness=ready&q=&page=&pageSize=` | `PayableReadinessPageDto`; currency/threshold + ready rows |
| Batches | `GET /admin/payouts/batches?status=&period=&page=&pageSize=` | `PayoutBatchPageDto`; batch summary, recipient detayı yok |
| Reconciliation | `GET /admin/payouts/reconciliation?period=` | `PayoutOperationsSupportDto`; event/provider authority yoksa typed `unsupported` + reason, sahte zero/complete yok |
| History | `GET /admin/payouts?view=history&period=&page=&pageSize=` | `PayoutPageDto`; yalnız P0-09 canonical terminal/presentation states |

- [ ] Önce integration testte yedi görünümün endpoint/DTO eşleşmesini; tenant/capability scope'u; unknown/empty/error/unsupported ayrımını yaz, mevcut contract eksikken FAIL bekle.
- [ ] Overview aggregate'lerini tam tenant query'sinden currency bazında üret; incomplete page toplamı veya FX toplamı üretme.
- [ ] Payable/readiness endpoint'ini q/readiness/page/pageSize ile bound et; P0-08 evaluator sonucu olmayan row'u ready yapma.
- [ ] Batch endpoint'inde pagination, status/period filters, tenant scope, currency/amount summary ve no full recipient detail beklentilerini yaz. DTO: id, status, period, method, currency, totalCents, payoutCount, processing/settled/failed timestamps.
- [ ] Reconciliation authority yoksa server typed `unsupported` dönsün; UI bu görünümü unavailable state olarak gösterebilsin, `0 mismatch` veya `reconciled` uydurmasın.
- [ ] Requests/history ayrımı server query'de canonical presentation state ile yapılsın; client yalnız loaded page'i filtrelemesin.
- [ ] Cross-tenant request/payable/batch list/detail 404/absence testlerini koru.
- [ ] Targeted integration test + API lint; PASS bekle.
- [ ] Commit: `feat: add payout operations query contracts`.

## Task AO-13: Payout Queue ve Inspector Component'lerini Ayır

**Files:**

- Create: `apps/web/src/components/payouts/PayoutQueue.tsx`
- Create: `apps/web/src/components/payouts/PayoutDecisionInspector.tsx`
- Create: `apps/web/src/components/payouts/PayoutBatchInspector.tsx`
- Create: `apps/web/src/components/payouts/payout-components.contract.node.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`

- [ ] Contract testte AO-12 authority map'indeki exact yedi URL-backed view — Overview, Requests, Risk & Verification, Payable, Batches, Reconciliation, History — endpoint/DTO, empty/error/typed-unsupported, evidence/reference requirements, canonical lifecycle ve scope summary beklentilerini yaz; FAIL bekle.
- [ ] Components typed DTO + capabilities alsın; mutation adapter route'ta kalsın.
- [ ] Settle evidence/reference empty iken action disabled + reason; reject/fail reason programmatically required.
- [ ] Issued/Mailed/Cleared yalnız authoritative event mapper döndürürse gösterilsin; legacy snapshot'tan uydurulmasın. `status-unavailable` finance action'larını kapatsın.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: split payout decision components`.

## Task AO-14: Payout Route'unu Decision Workspace'e Taşı

**Files:**

- Modify: `apps/web/src/app/admin/payouts/page.tsx`
- Modify: `apps/web/src/components/payouts/PayoutQueue.tsx`
- Modify: `apps/web/src/components/payouts/PayoutDecisionInspector.tsx`
- Create: `apps/web/src/app/admin/payouts/page.contract.node.test.ts`

**Dependencies:** P0-02, P0-09, P0-16 ve AO-12.

**URL:** `section=overview|requests|risk-verification|payable|batches|reconciliation|history`, `period`, `page`, detail için `selected=<recordId>`, record tipi için `kind=request|batch`, bulk checkbox için repeated `checked=<recordId>`.

- [ ] Contract testte exact seven-view URL restore, paginated data (no listAllPayouts), explicit batch scope, preview token, confirmation totals/currency, recount drift ve partial/error states'i yaz; FAIL bekle.
- [ ] P0 explicit `selected/all_eligible` scope body + signed preview token + stable Idempotency-Key kullan; server recount drift'te review ekranına dön.
- [ ] `listAllPayouts` helper'ını kaldır; request/history + batch-summary pagination kullan.
- [ ] Inspector error page'i yok etmesin; action scope'unda kalsın.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: rebuild payout operations workspace`.

## Task AO-15: Payout Detail Masking ve Evidence Sınırını Kur

**Files:**

- Modify: `apps/api/src/payouts/payouts.controller.ts`
- Modify: `apps/api/src/payouts/payouts.service.ts`
- Modify: `apps/api/test/payouts.int-spec.ts`
- Modify: `apps/web/src/components/payouts/PayoutDecisionInspector.tsx`
- Modify: `apps/web/src/components/payouts/PayoutBatchInspector.tsx`

- [ ] List DTO'nun full settlement reference/evidence/email/routing/account döndürmediği testini yaz; FAIL bekle.
- [ ] Capability-protected batch detail endpoint için masked summary ve `payouts.process` detail contract'ını yaz.
- [ ] Full evidence yalnız görev için gerekli inspector'da, fresh assurance onaylandıysa göster; URL/toast/log/storage'a yazma.
- [ ] Inspector kapanma/tenant switch/logout'ta sensitive state'i temizle.
- [ ] Integration test + web typecheck; PASS bekle.
- [ ] Commit: `fix: protect payout settlement evidence`.

## Task AO-16: Legacy Currency Mismatch'lerini Batch Dışında Tut

**Files:**

- Modify: `apps/api/src/payouts/payouts.service.ts`
- Modify: `apps/api/test/payouts.int-spec.ts`
- Modify: `apps/web/src/app/admin/payouts/page.tsx`

- [ ] Mixed-currency legacy ledger fixture'ın tek payout batch toplamına girmediği testi yaz; FAIL bekle.
- [ ] Payable/batch query'si tenant currency invariant'ını yeniden doğrulasın; mismatch rows data-quality/risk result'i olsun.
- [ ] UI mismatch'i blocker + remediation/support olarak göstersin; FX veya default currency relabel yapma.
- [ ] API test + web typecheck; PASS bekle.
- [ ] Commit: `fix: block mixed-currency payout batches`.

## Task AO-17: Audit Response Sanitizer'ını Ekle

**Files:**

- Modify: `apps/api/src/common/audit-redaction.ts`
- Create: `apps/api/src/common/audit-redaction.spec.ts`

- [ ] Recursive nested arrays/objects için email, IP, settlement evidence, account/routing, secret, token, recovery code redaction testlerini yaz; FAIL bekle.
- [ ] Stored audit kaydını değiştirmeyen pure response sanitizer uygula.
- [ ] Event correlation için safe fingerprint/last4 gibi açık allowlisted değerleri koru.
- [ ] Unit test: `pnpm.cmd --filter @refearn/api exec jest --selectProjects unit --runInBand --runTestsByPath src/common/audit-redaction.spec.ts`; PASS bekle.
- [ ] Commit: `fix: sanitize audit response payloads`.

## Task AO-18: Server-Backed Audit Search ve Read-Only Inspector'ı Uygula

**Files:**

- Modify: `apps/api/src/reports/reports.controller.ts`
- Modify: `apps/api/src/reports/reports.service.ts`
- Modify: `apps/api/test/admin.int-spec.ts`
- Modify: `apps/web/src/app/admin/audit/page.tsx`
- Modify: `apps/web/src/app/admin/audit/page.contract.node.test.ts`

**URL/API:** `q`, repeated `entity`, `from`, `to`, `page`, detail için `selected=<recordId>`.

- [ ] API testte filters'ın bütün tenant datasetine total öncesi uygulandığını ve cross-tenant sonuç olmadığını yaz; FAIL bekle.
- [ ] Reports query schema/server filters/pagination ekle; response'u AO-17 sanitizer'dan geçir.
- [ ] UI client-side loaded-100 filtering'i kaldır; URL-state + server query kullan.
- [ ] Detail `DecisionWorkspace.ReadOnlyInspector`; mutation action yok.
- [ ] API test + contract test + typechecks; PASS bekle.
- [ ] Commit: `feat: build searchable Earnica audit workspace`.

## Task AO-19: Settings IA ve Permission-Aware Form Sözleşmesini Kur

**Files:**

- Modify: `apps/web/src/app/admin/settings/page.tsx`
- Modify: `apps/web/src/app/admin/settings/sections/General.tsx`
- Modify: `apps/web/src/app/admin/settings/sections/Payments.tsx`
- Modify: `apps/web/src/app/admin/settings/sections/Data.tsx`
- Create: `apps/web/src/app/admin/settings/page.contract.node.test.ts`

**URL:** `section=general|brand|notifications|people|payments|plans|security|data`.

- [ ] Contract testte query-based section restore, section permission matrix, dirty/unsaved indicator, field/general validation, save progress, persistent success result, no unauthorized PATCH fields ve correct payout language beklentilerini yaz; FAIL bekle.
- [ ] Hash/local state'i canonical query'ye taşı.
- [ ] General body yalnız sahip olunan permission alanlarını içersin; disabled UI field'i body'ye sızmasın.
- [ ] Section değişimi/route leave sırasında unsaved state'i açıkça uyar; save pending iken double submit'i kapat; başarıdan sonra server response'u forma yeniden uygula ve false optimistic success üretme.
- [ ] Payments dilini “batch processing, settlement evidence required” olarak düzelt; paid/sent iddiası yapma.
- [ ] Data tab `settings.data`, Payments `settings.payments`, Brand `settings.branding` ile görünür/editable olsun.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: restructure Earnica admin settings`.

## Task AO-20: Data-Status Response'undan Host Path Bilgisini Kaldır

**Files:**

- Modify: `apps/api/src/settings/settings.service.ts`
- Modify: `apps/api/test/settings.int-spec.ts`
- Modify: `apps/web/src/app/admin/settings/sections/Data.tsx`

- [ ] API response'un host backup directory/full filesystem path döndürmediği testini yaz; FAIL bekle.
- [ ] Yalnız configured/readable/latestAge/encrypted/state alanlarını dön.
- [ ] UI raw path yerine operational readiness + safe remediation göster.
- [ ] Tenant-scoped DB/notification count testlerini koru.
- [ ] API test + web typecheck; PASS bekle.
- [ ] Commit: `fix: reduce data-status information exposure`.

## Task AO-21: People & Roles Decision Flow'unu Yenile

**Files:**

- Modify: `apps/web/src/app/admin/settings/sections/PeopleRoles.tsx`
- Modify: `apps/web/src/app/admin/settings/page.tsx`
- Modify: `apps/web/src/lib/privileged-actions.ts`
- Create: `apps/web/src/lib/privileged-actions.contract.node.test.ts`
- Modify: `apps/api/test/rbac.int-spec.ts`

**URL:** `section=people`, `role`, detail için `selected=<recordId>`, `kind=role|member`.

- [ ] Source contract + API testlerinde permission ceiling, self-change ban, owner immutability, selected/kind deep-link ve impact confirmation beklentilerini yaz.
- [ ] Dar kırmızı koşuları çalıştır: `node --test apps/web/src/lib/privileged-actions.contract.node.test.ts` ve `pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/rbac.int-spec.ts`; yeni source contract/expectation eksikken FAIL bekle. Mevcut extensionless-import `privileged-actions.node.test.ts` suite'ini çalıştı diye iddia etme.
- [ ] Role create/edit ve person assignment'ı DecisionWorkspace inspector ile compose et.
- [ ] Elevation/reduction metni effective permissions + session impact'i açıkça özetlesin.
- [ ] Aynı exact source contract ve RBAC integration komutlarını yeniden çalıştır; PASS bekle. UI guard'ı authority sayma.
- [ ] `pnpm.cmd --filter @refearn/web lint --incremental false`; PASS bekle.
- [ ] Commit: `feat: redesign people and role decisions`.

## Task AO-22: Brand/Security/Notifications/Plans Settings Yüzeylerini Normalize Et

**Files:**

- Modify: `apps/web/src/app/admin/settings/sections/Brand.tsx`
- Modify: `apps/web/src/app/admin/settings/sections/Security.tsx`
- Modify: `apps/web/src/app/admin/settings/sections/Notifications.tsx`
- Modify: `apps/web/src/app/admin/settings/sections/Plans.tsx`
- Modify: `apps/web/src/app/admin/settings/page.contract.node.test.ts`

- [ ] Önce settings contract testine dört section'ın Earnica hierarchy, loading/error/empty/permission states ve no unsupported org-wide control beklentilerini ekle; mevcut yüzeyler eksik olduğu için FAIL bekle.
- [ ] Brand preview Earnica primary + tenant secondary hiyerarşisini kullanır; tenant action/status tokenını değiştiremez.
- [ ] Security title “My security & sessions”; Notifications “My notifications” kişisel scope'u açıklar.
- [ ] Plans simulator result'i evidence + impact düzeni; money BigInt/currency-safe.
- [ ] Existing endpoints/permissions korunur; backend'de olmayan org-wide security/template özelliği uydurma.
- [ ] Web typecheck + settings contract test; PASS bekle.
- [ ] Commit: `feat: polish Earnica settings surfaces`.

## Task AO-23: Admin Route Contract Regression Setini Kapat

**Files:**

- Modify: `apps/web/src/app/admin/page.contract.node.test.ts`
- Modify: `apps/web/src/app/admin/sales/page.contract.node.test.ts`
- Modify: `apps/web/src/app/admin/members/page.contract.node.test.ts`
- Modify: `apps/web/src/app/admin/payouts/page.contract.node.test.ts`
- Modify: `apps/web/src/app/admin/audit/page.contract.node.test.ts`

- [ ] Her route için `view/q/filters/sort/page/selected/inspector` applicable URL assertions ekle.
- [ ] loading/error/empty/stale, one H1, table semantics, no row-click div, dock focus ve no nested-card hierarchy assertions ekle.
- [ ] Production owner task'ları tamamlandıktan sonra assertions'ı genişlet; testlerden biri FAIL ise ilgili owner task'ı yeniden aç ve bu regression task'ında production code değiştirme.
- [ ] Beş contract testini tek tek çalıştır; PASS bekle.
- [ ] `pnpm.cmd --filter @refearn/web lint --incremental false`.
- [ ] Commit: `test: cover Earnica admin workspaces`.

## Task AO-24: Admin Checkpoint'ini Uçtan Uca Doğrula

**Files:**

- Modify: `tasks/earnica-full-product-redesign-todo.md`

- [ ] API unit + targeted integration: recommendations, admin, sales-wallet, payouts, settings, RBAC.
- [ ] Web contract tests, typecheck ve build.
- [ ] Playwright izni varsa owner/admin/restricted custom admin/staff rollerinde `/admin`, sales, members, tree, payouts, audit, settings görevlerini çalıştır.
- [ ] Keyboard queue→inspector→action; Back/Forward; retry/double submit; selected/all-results; mixed currency; masking matrisini tamamla.
- [ ] 360, 768, 1024, 1440; light/dark/reduced-motion görsel karşılaştırma yap.
- [ ] Onaylı Operations Workspace reference ile `/admin` aynı viewport/state screenshot karşılaştırmasını yap; visible mismatch varsa düzelt.
- [ ] Checklist'i gerçek test/screenshot kanıtı ile güncelle.
- [ ] Commit: `test: verify Earnica admin operations`.

## Admin Exit Criteria

- Overview kanıt/karar hiyerarşisini kullanır; dekoratif KPI/card soup yoktur.
- Operations list state'i URL ile paylaşılır ve Back/Forward restore edilir.
- Bulk scope preview/recount/idempotency/partial retry testleri geçer.
- Payout reserve/settle dili ve lifecycle authority doğrudur; sensitive evidence sınırı korunur.
- Audit bütün dataset üzerinde server filter kullanır ve response sanitize edilir.
- Settings permission-aware, deep-linkable ve ürün kapsamını doğru ifade eder.
- Owner/admin/custom/staff capability matrix'i UI + server testleriyle tutarlıdır.
