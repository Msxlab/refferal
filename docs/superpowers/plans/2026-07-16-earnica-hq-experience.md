# Earnica HQ Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mevcut `/platform` route'larını URL'leri bozmadan Earnica HQ olarak yeniden konumlandırmak; şirket portföyü, currency-safe performans/risk özeti ve güvenli company inspection/governance görevlerini premium shared workspace içinde tamamlamak.

**Architecture:** `/platform` teknik route'u korunur; visible surface “HQ” olur. HQ shell shared `EarnicaShell` kullanır. Portfolio filter/pagination server-side ve URL-backed; company inspection `DecisionWorkspace` ile overview/network/governance bölümlerini compose eder. Platform admin authorization backend authority'dir.

**Tech Stack:** Next.js 15/React 19, shared Earnica components, Nest platform controller/service, Prisma/Jest, controlled NetworkExplorer.

## Global Constraints

- Yeni `/hq` route'u veya URL migration'ı yapılmaz; deep links `/platform` altında korunur.
- Kaynakta billing/subscription modeli veya endpoint'i yoktur; sahte Billing sekmesi/CTA eklenmez.
- Currency değerleri çevrilmez veya birleştirilmez.
- Suspend/reactivate fresh step-up P0-12/P0-13/P0-15 onayına bağlıdır; onaysız durumda current MFA policy korunur ve UI fresh assurance iddiası yapmaz.
- Tenant owner/admin hiçbir platform endpointine erişemez; UI guard tek security boundary değildir.

---

## Task HQ-01: Platform Layout'ı Earnica HQ Shell'e Taşı

**Files:**

- Modify: `apps/web/src/app/platform/layout.tsx`
- Create: `apps/web/src/components/hq/HqShell.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/app/platform/layout.contract.node.test.ts`

- [ ] Contract testte visible “HQ”, Earnica primary brand, portfolio nav, platform-admin guard, landmark/focus, theme/logout ve responsive nav beklentilerini yaz; FAIL bekle.
- [ ] Duplicated platform shell'i shared `EarnicaShell` üstünde `HqShell` wrapper'a taşı.
- [ ] `/platform` path'i/links'i koru; visible old Axtra/Platform branding varsa kaldır.
- [ ] Platform admin session yoksa safe login/landing; tenant role session'ına platform content hydrate etme.
- [ ] Contract test + web typecheck; PASS bekle.
- [ ] Commit: `feat: move platform routes into Earnica HQ shell`.

## Task HQ-02: Company Directory Query Contract'ını Server-Side Yap

**Files:**

- Modify: `apps/api/src/platform/platform.controller.ts`
- Modify: `apps/api/src/platform/platform.service.ts`
- Modify: `apps/api/test/platform.int-spec.ts`

**Query:** `q`, `status`, `currency`, `page`, `pageSize`.

**Response:**

```ts
type CompanyDirectory = {
  total: number;
  filteredTotal: number;
  page: number;
  pageSize: number;
  portfolio: {
    revenueByCurrency: CurrencyAmount[];
    payableByCurrency: CurrencyAmount[];
    companyCount: number;
    activeCount: number;
    suspendedCount: number;
  };
  items: CompanySummary[];
};
```

- [ ] Integration testte query/filter/page bounds, global vs filtered total, platform-only access ve currency grouping beklentilerini yaz; FAIL bekle.
- [ ] Server filters/pagination ekle; client'ın bütün company listesini çekmesine gerek bırakma.
- [ ] Tenant local-month caveat metadata/copy key için gerekli date range alanını açık dön.
- [ ] API test + lint; PASS bekle.
- [ ] Commit: `feat: add HQ company directory query`.

## Task HQ-03: HQ Portfolio Table ve URL-State'i Uygula

**Files:**

- Modify: `apps/web/src/app/platform/page.tsx`
- Create: `apps/web/src/components/hq/PortfolioSummary.tsx`
- Create: `apps/web/src/components/hq/CompanyPortfolioTable.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/app/platform/page.contract.node.test.ts`

**URL:** `q`, `status`, `currency`, `page`, detail için `selected=<recordId>`.

- [ ] Contract testte URL restore, server query, currency-grouped totals, filtered count, table semantics, detail link ve no nonfunctional CTA beklentilerini yaz; FAIL bekle.
- [ ] Card grid'i dense readable portfolio table + summary rail'e dönüştür.
- [ ] “New company coming soon” gibi işlevsiz CTA'yı kaldır.
- [ ] Revenue/payable currency groups ayrı render; “not converted or combined” açıklamasını koru.
- [ ] loading/error/empty/pagination states shared primitives kullansın.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: build Earnica HQ portfolio`.

## Task HQ-04: Company Inspection Response'unu Bounded ve Currency-Safe Yap

**Files:**

- Modify: `apps/api/src/platform/platform.controller.ts`
- Modify: `apps/api/src/platform/platform.service.ts`
- Modify: `apps/api/test/platform.int-spec.ts`

- [ ] Önce detail testte overview metrics, currency groups, plan summary, bounded usage, risk summary, sanitized recent audit, lifecycle/governance metadata, explicit `billing: { status:'unavailable', reasonCode:'authority_absent' }`, platform-only access ve unknown company 404 beklentilerini yaz; mevcut response eksik olduğu için FAIL bekle.
- [ ] Company detail endpoint'i list için gereksiz full network/financial rows döndürmesin; network ayrı endpoint kalsın.
- [ ] Ayrı `GET /platform/companies/:id/network?q=&page=&pageSize=&focus=` endpoint'i için `items`, `total`, `page`, `pageSize`, `hasMore`, `queryContext` contract'ını yaz; default/max pageSize, deterministic order, ancestor/focus bağlamı, platform-only access ve unknown company 404 testlerini mevcut unbounded response yüzünden önce FAIL bekle.
- [ ] Network query'sini server-side search/pagination ve hard cap ile bound et; `hasMore` yalnız total/page authority'sinden gelsin, full list fallback veya client-side loaded subset search bırakma.
- [ ] Mixed currency totals'ı ayrı arrays olarak koru; FX yok.
- [ ] Usage/risk/audit özetlerini bounded counts/recent events olarak döndür; raw evidence, full user list veya sensitive rule detail ekleme.
- [ ] Billing API/model authority bulunmadığı için amount/plan renewal/CTA uydurma; typed unavailable status dön ve acceptance ledger'da provider authority'yi BLOCKED tut.
- [ ] Full sensitive payout/audit evidence detail response'a ekleme.
- [ ] Test + API lint; PASS bekle.
- [ ] Commit: `fix: bound HQ company inspection data`.

## Task HQ-05: Company Inspection'ı Overview/Network/Governance Workspace'e Taşı

**Files:**

- Modify: `apps/web/src/app/platform/companies/[id]/page.tsx`
- Create: `apps/web/src/components/hq/CompanyInspection.tsx`
- Create: `apps/web/src/components/hq/CompanyGovernanceInspector.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/app/platform/companies/[id]/page.contract.node.test.ts`

**URL:** `section=overview|network|risk-audit|governance`, network için `q`, `page`, `focus`, detail için `selected=<recordId>`.

- [ ] Contract testte section/q/page/focus/selected URL restore, 404/error isolation, currency groups, plan + explicit billing-unavailable row, usage, risk, sanitized audit, lifecycle ve governance action semantics'ini yaz; FAIL bekle.
- [ ] `CompanyInspection` PageContext + DecisionWorkspace composition'ı kullansın; nested cards üretme.
- [ ] Action error tüm page'i kapatmasın; governance inspector içinde kalıcı result göster.
- [ ] Network section HQ-04 bounded page DTO'sunu tüketen controlled `NetworkExplorer` olur; server `hasMore`/queryContext warning ve keyboard list alternative korunur.
- [ ] Billing'i fake tab/CTA olarak ekleme; overview içinde typed unavailable state + reason göster. Risk/audit bölümü raw sensitive payload veya edit action sunmasın.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: build Earnica HQ company inspection`.

## Task HQ-06: Suspend/Reactivate Governance Contract'ını Güçlendir

**Files:**

- Modify: `apps/api/src/platform/platform.controller.ts`
- Modify: `apps/api/src/platform/platform.service.ts`
- Modify: `apps/api/test/platform.int-spec.ts`
- Modify: `apps/web/src/components/hq/CompanyGovernanceInspector.tsx`
- Modify: `apps/web/src/lib/privileged-actions.ts`

- [ ] Integration testte required reason, session revocation impact, idempotent repeated state, tenant owner 403 ve unknown company 404 beklentilerini yaz; mevcut davranış eksikse FAIL bekle.
- [ ] Suspend confirmation tenant/name/status, sign-in/session/member impact ve irreversible olmayan sonucu açıklar.
- [ ] Reactivate confirmation mevcut sessionları geri getirmediğini açıklar.
- [ ] P0 fresh step-up onaylandıysa endpoint guard ve client challenge flow'u bağla; onaylanmadıysa unsupported freshness iddiası yapma.
- [ ] Action sonrası company detail'i refetch et; client state'i authority gibi elle set etme.
- [ ] API test + web typecheck; PASS bekle.
- [ ] Commit: `fix: harden HQ company governance actions`.

## Task HQ-07: HQ Route ve Currency Regression Setini Kapat

**Files:**

- Modify: `apps/web/src/app/platform/page.contract.node.test.ts`
- Modify: `apps/web/src/app/platform/companies/[id]/page.contract.node.test.ts`
- Modify: `apps/api/test/platform.int-spec.ts`

- [ ] Multi-company/multi-currency portfolio, filtered/global total, local-month caveat ve no FX assertions ekle.
- [ ] 401/403/404/allow route matrix ve no unauthorized hydrate assertions ekle.
- [ ] URL Back/Forward, invalid params, company action error isolation, usage/risk/audit/lifecycle coverage, billing-unavailable state ve network list alternative source contracts ekle.
- [ ] Dar kırmızı koşuları çalıştır: `node --test apps/web/src/app/platform/page.contract.node.test.ts`, `node --test "apps/web/src/app/platform/companies/[id]/page.contract.node.test.ts"` ve `pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/platform.int-spec.ts`; yeni assertions owner implementation eksikse FAIL bekle.
- [ ] FAIL varsa HQ-02/HQ-03/HQ-04/HQ-05/HQ-06 exact owner task'ını yeniden aç; bu regression task'ında production code değiştirme.
- [ ] Owner düzeltmesi sonrası aynı exact üç test komutunu, `pnpm.cmd --filter @refearn/web lint --incremental false` ve `pnpm.cmd --filter @refearn/api lint` komutlarını yeniden çalıştır; PASS bekle.
- [ ] Commit: `test: cover Earnica HQ contracts`.

## Task HQ-08: HQ Checkpoint'ini Uçtan Uca Doğrula

**Files:**

- Modify: `tasks/earnica-full-product-redesign-todo.md`

- [ ] `pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/platform.int-spec.ts`.
- [ ] HQ source contract tests, web/API typecheck ve builds.
- [ ] Playwright izni varsa platform admin, tenant owner ve unauthenticated rollerinde `/platform` + company detail matrisini çalıştır.
- [ ] q/status/currency/page filters, Back/Forward, company inspect, network list, suspend/reactivate reason/confirm/error görevlerini keyboard ile tamamla.
- [ ] 360/768/1024/1440, light/dark/reduced-motion görsel karşılaştırma yap.
- [ ] Currency gruplarının asla tek total olmadığını screenshot/data evidence ile doğrula.
- [ ] Checklist'i gerçek kanıtla güncelle.
- [ ] Commit: `test: verify Earnica HQ experience`.

## HQ Exit Criteria

- `/platform` URL compatibility korunur; visible product surface Earnica HQ'dur.
- Portfolio server-filtered/paginated ve currency-grouped'dır.
- Company inspection overview/network/governance bağlamını URL ile geri kurar.
- Suspend/reactivate capability, reason, assurance (onaylandıysa) ve session impact sözleşmesini uygular.
- Tenant role platform verisini hydrate etmez; server 403/404 davranışı testlidir.
- Billing veya unsupported financial/provider field uydurulmamıştır.
