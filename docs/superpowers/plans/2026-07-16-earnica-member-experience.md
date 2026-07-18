# Earnica Member Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Üyeye “ne kazandım, neden, ödeme için ne eksik ve sıradaki en iyi adım ne?” sorularını tek bakışta cevaplayan; wallet, team ve invite görevlerini web/mobile boyutlarında güvenilir ve premium bir Earnica deneyimine dönüştürmek.

**Architecture:** Member route'ları shared Earnica shell ve P0 server contracts'i tüketir. Home özet odaklıdır; Wallet lifecycle/readiness authority'sidir; Team aggregate privacy'yi korur; Invite Center gerçek share/expiry/status görevini tamamlar. Para ve status presentation route içinde üretilmez.

**Tech Stack:** Next.js App Router/React 19, shared Earnica composition layer, existing `/app/*` Nest endpoints, qrcode.react, URLSearchParams.

## Global Constraints

- Foundation/auth ve P0 planları geçmeden member route'ları complete sayılmaz.
- Member yalnız doğrudan recruit için server'ın allowlist ettiği kimlik/membership/readiness özetini görür; daha derin downline kişisel sale/name eşleştirmesi gösterilmez ve aggregate privacy korunur.
- Readiness `unknown` hiçbir zaman `ready` gösterilmez. Unknown compliance gate'inin payout mutation'ını kapatması yalnız master'daki ayrı business-rule onayı verilirse etkinleşir; onay yoksa mevcut server davranışı korunur, UI `not configured` gösterir ve ilgili spec acceptance BLOCKED kalır.
- Member shell tenant markasını Earnica'nın yerine koymaz.
- Desktop table mobile'da yalnız yatay kaydırmaya bırakılmaz; mobile task-specific list/row composition kullanılır.

---

## Task ME-01: Responsive Member Shell'i Ortak Earnica Shell'e Taşı

**Files:**

- Modify: `apps/web/src/app/app/layout.tsx`
- Create: `apps/web/src/components/member/MemberShell.tsx`
- Modify: `apps/web/src/components/NotificationBell.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/app/app/layout.contract.node.test.ts`

- [ ] Contract testte Earnica primary brand, tenant context, desktop nav, 4-item mobile bottom nav, safe area, skip link/focus order, notification label ve capability-aware admin switch beklentilerini yaz; FAIL bekle.
- [ ] Existing session/landing guard'ını koruyarak `MemberShell`i `EarnicaShell` üstünde compose et.
- [ ] `/app`, `/app/wallet`, `/app/team`, `/app/invite` active navigation semantics ve 44px touch target uygula.
- [ ] `/app/brand` tenant response'u yalnız name/mark/accent context alanına uygula; shell/action/status renklerini değiştirme.
- [ ] NotificationBell loading/error/unread state'lerini shared primitive'lerle normalize et.
- [ ] Contract test + web typecheck; PASS bekle.
- [ ] Commit: `feat: move member routes into Earnica shell`.

## Task ME-02: Member Dashboard'a Readiness Summary Authority'si Ekle

**Files:**

- Modify: `apps/api/src/wallet/wallet.service.ts`
- Modify: `apps/api/src/payouts/payout-readiness.ts`
- Modify: `apps/api/test/payouts.int-spec.ts`
- Modify: `apps/web/src/app/app/page.tsx`
- Create: `apps/web/src/app/app/page.contract.node.test.ts`

**Target dashboard addition:**

```ts
payoutReadinessSummary: {
  requestable: boolean;
  readyCount: number;
  totalCount: number;
  nextBlocker: ReadinessCheck | null;
};
```

- [ ] API integration testte dashboard summary'nin wallet evaluator ile aynı sonucu verdiğini yaz; FAIL bekle.
- [ ] Dar kırmızı koşuları çalıştır: `pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/payouts.int-spec.ts` ve `node --test apps/web/src/app/app/page.contract.node.test.ts`; dashboard summary/source contract eksikken FAIL bekle.
- [ ] Dashboard endpoint'i tüm ledger page'ini çekmeden evaluator için gerekli bounded data'yı kullansın.
- [ ] Web source contract testinde Home'un `/app/dashboard` summary'sini tükettiğini, unknown check'i ready göstermediğini ve separate hard-block onayı yoksa onu `nextBlocker`/`requestable:false` diye client'ta yükseltmediğini yaz.
- [ ] Aynı exact API ve web contract komutlarını yeniden çalıştır; ardından `pnpm.cmd --filter @refearn/api lint` ve `pnpm.cmd --filter @refearn/web lint --incremental false`; PASS bekle.
- [ ] Commit: `feat: expose member payout readiness summary`.

## Task ME-03: Home'u Earned-Value Workspace Olarak Yenile

**Files:**

- Modify: `apps/web/src/app/app/page.tsx`
- Modify: `apps/web/src/components/NextActions.tsx`
- Create: `apps/web/src/components/member/MemberValueRail.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/app/app/page.contract.node.test.ts`

- [ ] Contract testte earned/maturing/payable/requested/processing/settled currency values, `status-unavailable`, one dominant next action, readiness progress, level breakdown ve loading/error/empty state'lerini yaz; raw `paid` label bekleme ve FAIL bekle.
- [ ] KPI card grid'ini tek `MemberValueRail` + next action + compact level evidence hierarchy'sine indir.
- [ ] Verified new value event dışında trace pulse çalıştırma; navigation mount'unda sürekli animation yapma.
- [ ] Farklı currency response gelirse ayrı rail group göster; tek total üretme.
- [ ] Recommendation copy stable kind üzerinden localize edilsin; raw server sentence UI authority olmasın.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: build Earnica member value overview`.

## Task ME-04: Wallet Readiness ve Lifecycle Component'lerini Kur

**Files:**

- Create: `apps/web/src/components/member/PayoutReadiness.tsx`
- Create: `apps/web/src/components/member/PayoutLifecycle.tsx`
- Create: `apps/web/src/components/member/WalletActivity.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/components/member/wallet-components.contract.node.test.ts`

- [ ] Contract testte ready/blocked/unknown check; native/verified-web/external-provider/support remediation; earned/maturing/payable/requested/under-verification/approved/processing/issued/mailed/settled/cleared/held/rejected/failed/reversed/status-unavailable ve currency/timestamp semantics'i yaz; authority olmayan method state'ini görünür bekleme ve FAIL bekle.
- [ ] `PayoutReadiness` checklist her gate'i text+icon+state+reason+action ile göstersin.
- [ ] `PayoutLifecycle` yalnız `payout-presentation` mapper output'u alsın; raw status switch route'ta yapılmasın.
- [ ] `WalletActivity` desktop table + mobile semantic rows composition'ı kullansın; selection olmayan satırı tıklanabilir div yapma.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: add member payout readiness and lifecycle`.

## Task ME-05: Wallet Route'unu Task-Oriented Workspace'e Taşı

**Files:**

- Modify: `apps/web/src/app/app/wallet/page.tsx`
- Modify: `apps/web/src/components/member/PayoutReadiness.tsx`
- Modify: `apps/web/src/components/member/PayoutLifecycle.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/app/app/wallet/page.contract.node.test.ts`

**URL state:** `page`, `status`, detail için `selected=<recordId>`.

- [ ] Contract testte URL-backed page/filter/detail, Back/Forward restore, readiness-first hierarchy, request confirmation ve typed blocker resultlerini yaz; FAIL bekle.
- [ ] Balance summary, readiness, primary payout action, active lifecycle ve history sırasını uygula.
- [ ] Request action server readiness'i submit anında yeniden doğrulasın; 409/blocker response'u action alanında kalıcı göster, yalnız toast kullanma.
- [ ] Double submit'i disabled/pending state ile önle; server idempotency/active request authority'sine güven.
- [ ] Invalid URL page/status/payout değerlerini safe default/closed inspector'a normalize et.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: redesign Earnica member wallet`.

## Task ME-06: Email Verification Remediation'ını Kullanılabilir Yap

**Dependencies:** P0 planındaki authenticated resend endpoint'i uygulanmış olmalıdır.

**Files:**

- Modify: `apps/web/src/components/member/PayoutReadiness.tsx`
- Modify: `apps/web/src/app/app/page.tsx`
- Modify: `apps/web/src/app/app/wallet/page.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/components/member/readiness-remediation.contract.node.test.ts`

- [ ] Contract testte email blocker'ın resend action, pending/success/cooldown/error state'lerini yaz; FAIL bekle.
- [ ] Resend action'ı authoritative endpoint'e bağla; verified/unknown account detail sızdırma.
- [ ] Success sonrası readiness'i refetch et; client'ta check'i ready olarak elle set etme.
- [ ] Home ve Wallet aynı remediation component'ini kullansın.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: connect member readiness remediation`.

## Task ME-07: Team Görünümünü Aggregate Privacy ile Yenile

**Files:**

- Modify: `apps/web/src/app/app/team/page.tsx`
- Modify: `apps/web/src/components/RadialNetwork.tsx`
- Create: `apps/web/src/components/member/LevelActivityList.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/app/app/team/page.contract.node.test.ts`

- [ ] Contract testte aggregate counts, active/inactive level semantics, no individual sale leakage, list alternative ve loading/error/empty state'lerini yaz; FAIL bekle.
- [ ] RadialNetwork'i dekoratif chart değil functional level relation görünümü yap; keyboard/list alternative sun.
- [ ] Compact level rows aktif üyeyi yalnız aggregate count olarak gösterir; nudge yalnız gerçek action varsa görünür.
- [ ] Mobile'da chart primary content olmasın; list önce veya eşdeğer erişilebilir alternatif olsun.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: refine Earnica member team workspace`.

## Task ME-08: Invite Share Primitive'lerini Kur

**Files:**

- Create: `apps/web/src/components/member/InviteSharePanel.tsx`
- Create: `apps/web/src/components/member/InviteHistory.tsx`
- Create: `apps/web/src/components/member/invite-components.contract.node.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`

- [ ] Contract testte real QR, copy/share feedback, expiry, pending/used/expired/revoked status, locked email ve mobile rows beklentilerini yaz; FAIL bekle.
- [ ] `InviteSharePanel` Earnica trust signature + tenant context + inviter safe message kullansın.
- [ ] Copy success clipboard sonucu onaylandıktan sonra gösterilsin; unsupported browser fallback action ver.
- [ ] `InviteHistory` desktop/mobile semantics ve empty state kullansın; raw code dışında privacy leak yapma.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: add Earnica invite sharing components`.

## Task ME-09: Invite Center Route'unu Tamamla

**Dependencies:** AO-01 controlled request-header contract'ı foundation cross-plan prerequisite olarak tamamlanmış olmalıdır.

**Files:**

- Modify: `apps/web/src/app/app/invite/page.tsx`
- Modify: `apps/web/src/components/member/InviteSharePanel.tsx`
- Modify: `apps/web/src/components/member/InviteHistory.tsx`
- Create: `apps/web/src/app/app/invite/page.contract.node.test.ts`

- [ ] Contract testte stable Idempotency-Key, email/open invite variants, QR/share, expiry/status refresh ve retry semantics'ini yaz; FAIL bekle.
- [ ] `api.post` controlled headers contract'ını kullan; invite attempt için `crypto.randomUUID()` key'i payload değişene veya success olana kadar koru.
- [ ] Network retry aynı payload+key; payload değişimi yeni key üretir.
- [ ] Success'te server invite code/expiry authority'sini render et ve list'i refetch et.
- [ ] Submit error QR/history'nin tamamını yok etmesin; form action scope'unda kalsın.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: complete Earnica member invite center`.

## Task ME-12: Direct Recruit Query Contract'ını Privacy-Safe Yap

**Files:**

- Modify: `apps/api/src/wallet/wallet.types.ts`
- Modify: `apps/api/src/wallet/wallet.controller.ts`
- Modify: `apps/api/src/wallet/wallet.service.ts`
- Modify: `apps/api/test/sales-wallet.int-spec.ts`

**Endpoint:** `GET /app/team/direct?q=&status=&page=&pageSize=`.

- [ ] Integration testte yalnız caller'ın level-1 direct recruits'ı, server-side q/status filter, bounded pagination, tenant scope ve deterministic order beklentilerini yaz; FAIL bekle.
- [ ] DTO'yu `id`, safe `displayName`, `membershipState`, `joinedAt`, `inviteOutcome`, `readiness { status, reasonCode }` ile allowlist et; sale/commission amount, email, deeper-downline name veya risk-rule detail döndürme.
- [ ] Readiness authority bulunmayan recruit satırını `unknown` göster; client/admin-only detay çıkarımı yapma.
- [ ] Cross-tenant ID/query'nin veri döndürmediğini ve pagination total'ın yalnız direct scope'ta hesaplandığını test et.
- [ ] `pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/sales-wallet.int-spec.ts`; PASS bekle.
- [ ] Commit: `feat: expose privacy-safe direct recruits`.

## Task ME-13: NPS Prompt Eligibility'sini Lifecycle'a Bağla

**Dependencies:** P0-18.

**Files:**

- Modify: `apps/web/src/app/app/page.tsx`
- Create: `apps/web/src/components/member/NpsPrompt.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/app/app/page.contract.node.test.ts`

- [ ] Contract testte yalnız server `npsEligibility.eligible=true` iken prompt; settled payout veya 3 approved sale+14 gün reason; blocker/auth/failed-payment suppression ve 90 günlük dismiss semantics'ini yaz; FAIL bekle.
- [ ] Prompt'u ana para görevinin önüne koyma; dismiss sonucunu authoritative endpoint'e gönder ve local timestamp ile eligibility üretme.
- [ ] Submit/survey collection authority bu spec'te yoksa skor formu uydurma; yalnız eligible prompt + safe external/approved feedback action varsa göster.
- [ ] Error/offline durumda prompt gizli kalsın ve financial task akışını bozmasın.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: gate Earnica NPS prompt by lifecycle`.

## Task ME-14: Record Sale Primary Task Sheet'ini Uygula (Koşullu)

**Dependencies:** P0-20 ayrı business-rule/API onayıyla tamamlanmış olmalıdır. Onay yoksa bu task `BLOCKED: member-sale-authority-not-approved` kalır ve Home invite/diğer authoritative next action'ı kullanır.

**Files:**

- Modify: `apps/web/src/app/app/page.tsx`
- Create: `apps/web/src/components/member/RecordSaleSheet.tsx`
- Create: `apps/web/src/components/member/RecentSaleSubmissions.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/app/app/page.contract.node.test.ts`

- [ ] Contract testte capability-gated `Record sale`, focused Sheet, amount/date/customer/external evidence fields, required evidence, expected review time ve resulting draft/review state beklentilerini yaz; FAIL bekle.
- [ ] Submit current member route'una BigInt-safe cent string ve safe fields göndersin; seller/tenant/approval state client'tan gönderilmesin.
- [ ] Double submit'i kapat; duplicate external reference veya server blocker'ı Sheet action alanında kalıcı göster, toast-only yapma.
- [ ] Success sonrası ilgili submission ID/status'u `RecentSaleSubmissions` içinde bulunabilir tut ve server'dan refetch et.
- [ ] Capability/endpoint yoksa CTA'yı gizleyip acceptance ledger'da BLOCKED bırak; admin sales URL'sine member'ı yönlendirme.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: add member record-sale task flow`.

## Task ME-15: Direct Recruit Search, Filter ve Detail Workspace'ini Bağla

**Dependencies:** ME-12.

**Files:**

- Modify: `apps/web/src/app/app/team/page.tsx`
- Create: `apps/web/src/components/member/DirectRecruitWorkspace.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/app/app/team/page.contract.node.test.ts`

**URL:** `q`, `status`, `page`, detail için `selected=<recordId>`.

- [ ] Contract testte desktop/mobile eş anlamlı search/filter/detail, URL reload/Back/Forward, safe direct fields, pagination ve loading/error/empty state'lerini yaz; FAIL bekle.
- [ ] Direct recruits'ı kişi/readiness/invite outcome önceliğiyle göster; aggregate level chart/list'i ikincil bağlam yap.
- [ ] Detail Sheet yalnız allowlisted API fields'ı gösterir; email, sale amount, deeper downline veya risk-rule detail çıkarmaz.
- [ ] Mobile'da list→detail, desktop'ta list+context dock; aynı q/status/recruit state'i kullanır.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: add Earnica direct recruit workspace`.

## Task ME-10: Member Route State ve Responsive Regression'larını Kapat

**Files:**

- Modify: `apps/web/src/app/app/layout.contract.node.test.ts`
- Modify: `apps/web/src/app/app/page.contract.node.test.ts`
- Modify: `apps/web/src/app/app/wallet/page.contract.node.test.ts`
- Modify: `apps/web/src/app/app/team/page.contract.node.test.ts`
- Modify: `apps/web/src/app/app/invite/page.contract.node.test.ts`

- [ ] Her route contract testine loading/error/empty/stale ve responsive/mobile composition assertion'ı ekle.
- [ ] 320/390 no horizontal page scroll, 44px touch, one H1, landmark ve reduced-motion source contracts ekle.
- [ ] Production task'ları tamamlandıktan sonra assertions'ı genişlet ve beş testi çalıştır. Herhangi biri FAIL ise ilgili owner task'ı yeniden aç; bu regression task'ında production code değiştirme.
- [ ] Beş contract testini tek tek çalıştır; PASS bekle.
- [ ] `pnpm.cmd --filter @refearn/web lint --incremental false`.
- [ ] Commit: `test: cover Earnica member route states`.

## Task ME-11: Member Checkpoint'ini Görsel ve Görev Bazlı Doğrula

**Files:**

- Modify: `tasks/earnica-full-product-redesign-todo.md`

- [ ] API dar tests: payout readiness/history/invite idempotency ve auth consent suites.
- [ ] Web contract tests + typecheck + build çalıştır.
- [ ] Playwright izni varsa `/app`, `/app/wallet`, `/app/team`, `/app/invite` için 390×844, 768×1024, 1440×900; light/dark/reduced-motion/keyboard görevlerini çalıştır.
- [ ] Member, member+admin capability ve inactive membership session sonuçlarını kontrol et.
- [ ] Payout request blocker/remediation, request success, history detail; invite create/copy; Team direct recruit search/filter/detail + aggregate alternative; NPS eligibility/dismiss görevlerini tamamla.
- [ ] Member-sale business rule onaylandıysa Record sale submit→draft/review→recent submission görevini tamamla; onaylanmadıysa acceptance'ı BLOCKED kaydet.
- [ ] Reference hierarchy ile route screenshot'larını aynı viewport'ta karşılaştır; card soup/nested surfaces/overflow mismatch'lerini düzeltmeden checkpoint'i kapatma.
- [ ] Checklist'i gerçek kanıtla güncelle.
- [ ] Commit: `test: verify Earnica member experience`.

## Member Exit Criteria

- Member shell Earnica primary + tenant secondary hiyerarşisini korur.
- Home tek bakışta earned states, readiness ve next action verir.
- Wallet server readiness/lifecycle authority'sini kullanır; stale durumda mutation yapmaz. Unknown compliance state'i asla ready göstermez; mutation yalnız ayrı hard-block business-rule onayı verilmişse kapanır, aksi durumda acceptance BLOCKED kalır.
- Team aggregate privacy ve keyboard list alternative'i korur.
- Direct recruit search/filter/detail yalnız allowlisted level-1 veriyi gösterir; daha derin kişisel veri sızmaz.
- Invite creation idempotent, share feedback gerçek ve history mobile-friendly'dir.
- NPS blocker sırasında görünmez ve dismiss 90 gün server authority'siyle korunur; Record sale yalnız onaylı member API/capability varsa görünür.
- Bütün member route'ları loading/error/empty/retry, 320–1440 responsive ve keyboard contract'ını geçer.
