# Earnica P0 Data Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Earnica arayüzünün kullandığı invite, bulk action, payout, capability, tenancy ve MFA/step-up durumlarını server-authoritative, idempotent ve testli sözleşmelere bağlamak; kaynak bulunmayan finansal/compliance alanlarını güvenli biçimde kapatmak.

**Architecture:** P0 davranışları saf mapper/evaluator modüllerinde tanımlanır; controller yalnız validation/authorization yapar, service transaction ve authority'yi uygular. UI ancak typed response kullanır. Invite consent ve bulk replay için önerilen kalıcı kayıtlar ayrı açık migration onayı gerektirir. Compliance provider bulunmayan readiness kontrolleri `unknown/not configured` olur ve asla ready gösterilmez; payout mutation'ını kapatmaları yalnız master'daki ayrı business-rule onayı verilirse etkinleşir, aksi halde mevcut davranış korunur ve acceptance BLOCKED kalır.

**Tech Stack:** NestJS 11, Zod, Prisma 6.6/PostgreSQL, Jest/ts-jest, Next/Expo API clients.

## Global Constraints

- Master plandaki tüm Global Constraints geçerlidir.
- Integration testleri yalnız `DATABASE_URL_TEST` açıkça test database'i olduğunda çalıştırılır.
- Migration dosyaları yalnız kullanıcı plan + migration yetkisini açıkça onayladıktan sonra oluşturulur/uygulanır.
- Prisma geçmişi yeniden yazılmaz; yeni timestamped migration eklenir.
- Address/KYC/fraud/sanctions/payment-method için upstream authority yoktur; bu plan sahte profil, provider veya admin override üretmez.
- Routing/account alanları kaynakta yoktur; reveal UI/API eklenmez. Non-leak regression testi eklenir.
- Fresh step-up süresi client'a hardcode edilmez; onaylanırsa server 5 dakika authority üretir.

---

## Task P0-01: Authority Matrix'i Çalıştırılabilir Kanıta Dönüştür

**Files:**

- Create: `docs/superpowers/plans/evidence/earnica-p0-authority-matrix.json`
- Create: `apps/api/src/common/p0-authority.contract.spec.ts`

**Contract:** Her matrix satırı şu shape'i taşır:

```ts
type AuthorityEvidence = {
  key:
    | 'bulk_scope'
    | 'invite_acceptance'
    | 'mfa_assurance'
    | 'mfa_recovery'
    | 'payout_readiness'
    | 'payment_lifecycle'
    | 'capability_tenancy'
    | 'sensitive_reveal'
    | 'multi_currency'
    | 'member_sale_entry'
    | 'nps_eligibility'
    | 'telemetry';
  sourceFiles: string[];
  endpoints: string[];
  authority: 'implemented' | 'partial' | 'absent' | 'not-applicable';
  safeFallback: string;
  testCommand: string;
};
```

- [ ] Önce testte exact 12 unique key, boş olmayan source/endpoint veya açık `not-applicable` ve safe fallback zorunluluğunu yaz.
- [ ] Testi çalıştır: `pnpm.cmd --filter @refearn/api exec jest --selectProjects unit --runInBand --runTestsByPath src/common/p0-authority.contract.spec.ts`; JSON yok/eksik olduğu için FAIL bekle.
- [ ] Kaynak taramasında doğrulanan mevcut endpoint/file authority'lerini JSON'a yaz; telemetry event/dedupe/correlation/retention authority bulunmuyorsa `absent`, KPI `unmeasured` ve yeni analytics paketi `approval-required` olarak kaydet.
- [ ] Testi yeniden çalıştır; PASS bekle.
- [ ] `git diff --check -- docs/superpowers/plans/evidence/earnica-p0-authority-matrix.json apps/api/src/common/p0-authority.contract.spec.ts`.
- [ ] Commit: `test: codify Earnica P0 authority matrix`.

## Task P0-02: Payout Batch Preview ve Explicit Scope'u Fail-Closed Yap

**Files:**

- Modify: `apps/api/src/payouts/payouts.types.ts`
- Modify: `apps/api/src/payouts/payouts.controller.ts`
- Modify: `apps/api/src/payouts/payouts.service.ts`
- Modify: `apps/api/src/engine/engine.service.ts`
- Modify: `apps/api/test/payouts.int-spec.ts`

**Target contracts:**

```ts
const payoutScopeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('selected'), membershipIds: z.array(z.string().uuid()).min(1).max(100) }),
  z.object({
    mode: z.literal('all_eligible'),
    filters: z.object({ period: month.optional(), method: z.enum(['manual', 'csv']) }),
  }),
]);

export const previewPayoutBatchSchema = z.object({
  scope: payoutScopeSchema,
});

export const startPayoutBatchSchema = z.object({
  scope: payoutScopeSchema,
  previewToken: z.string().min(32),
});

type PayoutBatchPreview = {
  previewToken: string;
  expiresAt: string;
  eligibleCount: number;
  excludedCount: number;
  totals: Array<{ currency: string; amountCents: string }>;
  normalizedScope: PayoutScope;
};
```

- [ ] `POST /admin/payouts/batches/preview` ve confirm `POST /admin/payouts/batches` contract testlerini önce yaz; `{}`, missing scope, selected empty, invalid filter ve cross-tenant ID için mutation olmadan 400/404 bekle.
- [ ] Preview'da tenant/capability/eligibility ile bounded seçim, normalized scope/filter, eligible/excluded count ve ISO currency bazında BigInt-safe totals bekle.
- [ ] Preview token'ın actor, tenant, normalized scope fingerprint, eligible count/totals, expiry ve `payout-batch-preview:v1` domain-separated signature taşıdığını; tamper/expiry/wrong actor/tenant için mutation olmadığını test et.
- [ ] Confirm body scope'u token scope'uyla birebir eşleşmezse veya transaction içi recount/count/currency totals drift ederse 409 `review_required` + yeni preview dönmesini test et.
- [ ] Cross-tenant membership, batch settle/fail/export için 404/403 testlerini yaz.
- [ ] Dar testi çalıştır; preview endpoint/token ve explicit scope olmadığı için FAIL bekle.
- [ ] Preview/confirm schema'larını discriminated union'a çevir; legacy `/run` yalnız explicit compatibility adapter ve aynı preview doğrulamasıyla çalışsın.
- [ ] Service'te selected ID'leri tenant-bound doğrula; `all_eligible` filter'larını normalize et; preview/confirm query'leri aynı eligibility predicate'ini kullansın.
- [ ] Engine'deki empty-array → all sentinel'ini kaldır; mode'u açık parametre olarak geçir.
- [ ] Confirm transaction'ında scope fingerprint, count ve currency totals'i yeniden hesapla; değişmişse hiçbir ledger/payout mutation yapmadan conflict/review-required dön.
- [ ] Test: `pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/payouts.int-spec.ts`; PASS bekle.
- [ ] Lint: `pnpm.cmd --filter @refearn/api lint`; PASS bekle.
- [ ] Commit: `fix: require reviewed payout batch scope`.

## Task P0-03: Invite Consent İçin Kalıcı Veri Temeli Kur

> Bu task Prisma migration yetkisi gerektirir. Yetki verilmezse P0-04 ve invite kayıt UI task'ları BLOCKED kalır.

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260716120000_invite_acceptance_consent/migration.sql`
- Modify: `apps/api/test/database-safety.int-spec.ts`

**Target model:**

```prisma
model InviteAcceptanceConsent {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  inviteId          String   @map("invite_id") @db.Uuid
  tenantId          String   @map("tenant_id") @db.Uuid
  userId            String   @map("user_id") @db.Uuid
  membershipId      String   @map("membership_id") @db.Uuid
  disclaimerVersion String   @map("disclaimer_version")
  locale            String
  disclaimerContentHash String @map("disclaimer_content_hash")
  tenantDisplayName String   @map("tenant_display_name")
  programSummary    String   @map("program_summary")
  programSummaryHash String  @map("program_summary_hash")
  acceptedAt        DateTime @default(now()) @map("accepted_at")
  createdAt         DateTime @default(now()) @map("created_at")

  invite     Invite     @relation(fields: [inviteId], references: [id], onDelete: Restrict)
  tenant     Tenant     @relation(fields: [tenantId], references: [id], onDelete: Restrict)
  user       User       @relation(fields: [userId], references: [id], onDelete: Restrict)
  membership Membership @relation(fields: [membershipId], references: [id], onDelete: Restrict)

  @@unique([inviteId, userId])
  @@index([tenantId, acceptedAt])
  @@map("invite_acceptance_consents")
}
```

Pending MFA immutable snapshot alanları: `tenantId String?`, `disclaimerVersion String?`, `disclaimerLocale String?`, `disclaimerContentHash String?`, `tenantDisplayName String?`, `programSummary String?`, `programSummaryHash String?`, `consentAcceptedAt DateTime?`. Mevcut `userId`, `inviteId` ve `challengeTokenId` binding'i korunur. Eski pending kayıtlar nullable kalır; snapshot version alanlarından biri eksikse tamamlanmaz ve yeni akışla restart gerekir.

Consent row; invite, tenant, actor/user, resulting membership, authoritative disclaimer content hash ve immutable tenant/program snapshot'ını tek kabul zamanına bağlar. Client body veya client timestamp snapshot authority olamaz.

- [ ] Database safety integration testine consent tablosu/unique constraint/foreign key ve yukarıdaki bütün nullable pending snapshot sütunlarının varlığı beklentisini yaz.
- [ ] Testi çalıştır; model/migration bulunmadığı için FAIL bekle.
- [ ] Prisma model/relation ve pending snapshot alanlarını ekle.
- [ ] Migration SQL'de yeni tablo, unique constraint, foreign key ve nullable pending sütunlarını oluştur; mevcut membership'lere sahte backfill yapma.
- [ ] `pnpm.cmd --filter @refearn/api exec prisma validate`; PASS bekle.
- [ ] `pnpm.cmd --filter @refearn/api exec prisma generate`; PASS bekle.
- [ ] Approved test DB üzerinde `pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/database-safety.int-spec.ts`; PASS bekle.
- [ ] Commit: `feat: add invite acceptance consent record`.

## Task P0-04: Invite Consent'i Request ve Transaction'da Zorunlu Kıl

**Files:**

- Create: `apps/api/src/invites/invite-consent.ts`
- Modify: `apps/api/src/auth/auth.types.ts`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/memberships/memberships.service.ts`
- Modify: `apps/api/test/auth.int-spec.ts`

**Target request fields:**

```ts
export const INVITE_DISCLAIMER_VERSION = '2026-07-16';

acceptDisclaimer: z.literal(true),
disclaimerVersion: z.literal(INVITE_DISCLAIMER_VERSION),
disclaimerLocale: z.enum(['en', 'tr']),
```

- [ ] Missing, false, version mismatch ve locale mismatch requestlerinin 400 dönüp invite/membership/consent'i değiştirmediği testleri yaz.
- [ ] Authoritative locale body hash, tenant display-name snapshot ve program-summary snapshot'ın client body kabul etmeden server tarafından kaydedildiğini test et.
- [ ] Direct acceptance'ın server `acceptedAt` değeriyle consent kaydı oluşturduğunu yaz.
- [ ] MFA-pending akışın server-clock `consentAcceptedAt`, tenant/invite/user/challenge binding'i ve tüm immutable snapshot alanlarını tuttuğunu; expired/failed challenge'ın consent/membership üretmediğini; başarılı challenge'ın aynı transaction'da final consent oluşturduğunu yaz.
- [ ] MFA başlangıcından sonra tenant display adı, program summary veya disclaimer body/version authority'sini değiştir; completion'ın güncel değerleri yeniden snapshotlamadığını, final consent row'un kullanıcının ilk kabul ettiği pending hash/metin snapshot'ını ve `consentAcceptedAt` zamanını aynen taşıdığını test et.
- [ ] Dar auth integration testini çalıştır; FAIL bekle.
- [ ] Zod request schema'ya literal acceptance/version/locale ekle.
- [ ] `auth.service.ts` içinde validation'ı invite lock/consume öncesi uygula.
- [ ] `memberships.service.ts` creation sonucunu consent record'a bağla; client timestamp kabul etme.
- [ ] MFA pending snapshot → final consent transferini transaction içinde uygula; completion sırasında yalnız invite/user/tenant/challenge geçerliliğini yeniden doğrula, kabul içeriğini canlı tenant/settings değerlerinden yeniden üretme.
- [ ] Test: `pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/auth.int-spec.ts`; PASS bekle.
- [ ] Commit: `feat: persist authoritative invite consent`.

## Task P0-05: Invite Resolve'u Explicit State ve Privacy Contract'a Taşı

**Files:**

- Modify: `apps/api/src/invites/invites.controller.ts`
- Modify: `apps/api/src/invites/invites.service.ts`
- Modify: `apps/api/src/auth/auth.types.ts`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/test/auth.int-spec.ts`

**Target DTOs (public resolve ve ayrı authenticated continuation):**

```ts
type InvitePublicState =
  | 'invalid'
  | 'valid'
  | 'expired'
  | 'revoked'
  | 'used'
  | 'tenant-suspended';

type InviteResolveDto = {
  state: InvitePublicState;
  tenant?: { displayName: string; logoUrl?: string };
  inviter?: { displayName: string };
  lockedEmailHint?: string;
  programSummary?: string;
  disclaimer?: { version: string; locale: string; body: string };
  expiresAt?: string;
};

type InviteContinuationDto = {
  state: 'available' | 'not-available';
  continuation?: { kind: 'continue-membership'; membershipId: string; route: '/app' };
};
```

- [ ] Valid/invalid/not-found/expired/revoked/used/tenant-suspended test matrisi yaz; invalid/not-found form/inviter/tenant ayrıntısı açmasın.
- [ ] Full locked email'in public response'ta bulunmadığı, yalnız masked biçim olduğu testi yaz.
- [ ] Valid state'te tenant, programSummary ve disclaimer zorunlu; diğer state'lerde yalnız privacy-safe optional alanların bulunduğu testini yaz.
- [ ] Public `GET /invites/:code` used state'i anonymous/başka user için her zaman generic döndürsün; serialized public DTO'da `continuation` key'i dahi bulunmasın ve tenant, inviter, email, membership ID veya hesap varlığı sızmasın. Ayrı authenticated `GET /invite-continuations/:code` endpoint'i yalnız token user invite'ın `usedByMembership.userId` değeriyle eşleşirse allowlisted `/app` route'u + kendi membership ID'sini `InviteContinuationDto` içinde döndürsün; same-user, other-user, anonymous, stale/inactive membership negative testlerini yaz.
- [ ] Inviter disclosure default-deny olsun: mevcut backend'de invite-specific, server-authoritative public-display izni yoksa `inviter` alanını valid response'ta dahi omit et ve UI tenant fallback'ini kullansın. İsim/member state/creator ownership'ten izin çıkarımı yapma.
- [ ] Explicit disclosure authority ileride onaylanırsa yalnız aynı invite+tenant scope'undaki geçerli izinle allowlisted `displayName` dönebilsin; missing/revoked/mismatched authority ve bütün non-valid state'lerde inviter'ın absent kaldığı negative testleri yaz. Bu plan yeni disclosure migration'ı icat etmez.
- [ ] Public response'un invite code'u echo etmediğini ve disclaimer body/version/locale'nin server authority'den geldiğini test et.
- [ ] Locked invite registration'ında client email'i optional yap; server locked email'i authority olarak kullansın. Open invite'ta email zorunlu kalsın.
- [ ] Testi çalıştır; current boolean response yüzünden FAIL bekle.
- [ ] State mapper'ı uygula; privacy-safe inviter yalnız yukarıdaki explicit disclosure authority doğrulanırsa seçilsin, aksi halde tenant trust fallback'i kullanılsın.
- [ ] Used invite için UI authority'sini public state'ten tahmin etme: session varsa protected continuation endpoint'ini çağır; 404/403 veya mismatch'te generic used state'i koru, automatic account merge/invite consume yapma.
- [ ] Program summary'yi mevcut tenant plan/setting authority'sinden deterministik üret; source yoksa valid response'u complete sayma ve ayrı contract approval'a çıkar.
- [ ] Client-supplied locked email'in invite email'ini override edemediğini doğrula.
- [ ] Auth integration testini yeniden çalıştır; PASS bekle.
- [ ] Commit: `fix: make invite resolution explicit and private`.

## Task P0-06: Sales Bulk Preview ve Explicit Scope Contract'ını Kur

**Files:**

- Create: `apps/api/src/sales/bulk-scope.ts`
- Modify: `apps/api/src/sales/sales.types.ts`
- Modify: `apps/api/src/sales/sales.controller.ts`
- Modify: `apps/api/src/sales/sales.service.ts`
- Modify: `apps/api/test/sales-wallet.int-spec.ts`

**Target contracts:**

```ts
type BulkScope =
  | { mode: 'selected'; ids: string[] }
  | { mode: 'all-results'; filters: ListSalesInput };

type BulkPreview = {
  previewToken: string;
  expiresAt: string;
  action: 'approve' | 'void';
  eligibleCount: number;
  totals: Array<{ currency: string; amountCents: string }>;
  excludedCount: number;
};
```

Endpoints:

- `POST /admin/sales/bulk/preview` with `{ action, scope }`.
- `POST /admin/sales/bulk` with `{ scope, previewToken }` and mandatory `Idempotency-Key` header.

- [ ] Missing scope, selected empty, invalid filters, cross-tenant IDs ve no eligible result testlerini yaz.
- [ ] All-results preview sonrası count/currency totals değişirse mutation yerine 409 `review_required` ve yeni preview dönmesini test et.
- [ ] Preview token expiry/tamper ve wrong-tenant/actor testlerini yaz.
- [ ] Confirm body scope'un review scope/fingerprint ile birebir eşleşmediği durumda mutation olmadan 409 testini yaz.
- [ ] Testi çalıştır; FAIL bekle.
- [ ] Normalized filters, deterministic fingerprint ve short-lived signed preview token helper'ını ekle; mevcut server secret'ten `bulk-preview:v1` domain separation ile türetilen signer kullan ve tokenı auth tokenı olarak kabul etme.
- [ ] Preview query'sini action eligibility + tenant + capability ile sınırla ve currency bazında grupla.
- [ ] Mutation öncesi aynı transaction/snapshot içinde recount/fingerprint kontrolü yap; drift'te hiçbir mutation yapma.
- [ ] Dar integration testini çalıştır; preview ve drift testleri PASS bekle.
- [ ] Commit: `feat: add reviewed bulk sales scope`.

## Task P0-07: Bulk Mutation Replay ve Partial Retry Kaydı Ekle

> Bu task Prisma migration yetkisi gerektirir.

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260716121500_bulk_action_execution/migration.sql`
- Modify: `apps/api/src/sales/sales.service.ts`
- Modify: `apps/api/test/sales-wallet.int-spec.ts`

**Target persistence:**

```prisma
model BulkActionExecution {
  id                 String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId           String   @map("tenant_id") @db.Uuid
  actorUserId        String   @map("actor_user_id") @db.Uuid
  idempotencyKeyHash String   @map("idempotency_key_hash")
  requestHash        String   @map("request_hash")
  status             String
  response           Json?
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, actorUserId, idempotencyKeyHash])
  @@map("bulk_action_executions")
}
```

- [ ] Aynı key+payload'ın aynı response'u replay ettiği, farklı payload'ın 409 ürettiği testleri yaz.
- [ ] Partial failure response'un `succeededIds`, `failed[] { id, code, message }` ve `retryScope: { mode:'selected', ids: failedIds }` döndürdüğünü yaz.
- [ ] Retry'nin failed subset için yeni preview ve yeni Idempotency-Key gerektirdiğini; eski key'in yeni subset ile 409 verdiğini test et.
- [ ] Aynı kaydın replay sırasında ikinci kez approve/void edilmediğini audit/ledger assertion ile test et.
- [ ] Testi çalıştır; FAIL bekle.
- [ ] Migration/model ve transaction lock ile execution record'u uygula.
- [ ] Completed response'u JSON-safe serialize et; processing crash durumunda güvenli retry/recovery sonucu tanımla.
- [ ] Integration testini çalıştır; PASS bekle.
- [ ] Commit: `feat: make bulk sales execution replay-safe`.

## Task P0-08: Tek Payout Readiness Evaluator'ı Kullan

**Files:**

- Create: `apps/api/src/payouts/payout-readiness.ts`
- Modify: `apps/api/src/wallet/wallet.service.ts`
- Modify: `apps/api/src/payouts/payouts.service.ts`
- Modify: `apps/api/test/payouts.int-spec.ts`

**Target output:**

```ts
type ReadinessCheck = {
  key: 'email' | 'payable_balance' | 'threshold' | 'open_request' | 'address' | 'kyc' | 'fraud' | 'sanctions' | 'payment_method' | 'mfa';
  status: 'ready' | 'blocked' | 'unknown';
  reasonCode: string;
  owner: 'member' | 'workspace-admin' | 'earnica-support' | 'external-provider' | 'system-policy';
  remediation: RemediationTarget | null;
  recheck: { mode: 'after-action' | 'at' | 'manual'; at?: string };
  authority: 'user' | 'ledger' | 'payout' | 'auth' | 'unavailable';
};

type RemediationTarget =
  | { kind: 'native'; route: string }
  | { kind: 'verified-web'; url: string; returnTo?: string }
  | { kind: 'external-provider'; sessionUrl: string; expiresAt: string }
  | { kind: 'support'; reasonCode: string };

type PayoutReadiness = {
  requestable: boolean;
  checks: ReadinessCheck[];
  threshold: { amountCents: string; currency: string };
};
```

- [ ] Wallet GET ve payout POST'un aynı evaluator sonucunu kullandığı testini yaz.
- [ ] Email/balance/threshold/open-request gerçek gate'lerini ready/blocked test et.
- [ ] Her failed/unknown check'in owner, direct remediation ve recheck bilgisini taşıdığını test et.
- [ ] `verified-web` hedefinin allowlisted HTTPS origin kullandığını; `external-provider` hedefinin yalnız server-issued kısa ömürlü session URL/expiry taşıdığını; native route bulunmayan address/payment hedefinin uydurulmadığını test et.
- [ ] MFA check'in server policy'ye göre `ready/not-required`, `blocked` veya `unknown` ürettiğini; client'ın assurance TTL yazmadığını test et.
- [ ] Kaynaksız address/KYC/fraud/sanctions/payment method check'lerinin onaylanan business rule'a göre `unknown + unavailable` olduğunu test et. Hard-block davranışını master approval gate'i geçmeden etkinleştirme.
- [ ] Testi çalıştır; FAIL bekle.
- [ ] Pure evaluator ekle; route copy değil stable reasonCode üret.
- [ ] Wallet response'a `payoutReadiness` ekle; eski `payoutEligibility`ı bir geçiş boyunca compatibility field olarak koru.
- [ ] `requestPayout` aynı evaluator sonucunu kullansın. Yalnız master'daki readiness business-rule onayı verilmiş gate'ler `requestable:false` üretsin; onaysız upstream check'ler UI'da unknown/not-configured görünür ve acceptance BLOCKED kalır.
- [ ] Integration testi ve API lint'i çalıştır; PASS bekle.
- [ ] Commit: `feat: centralize payout readiness authority`.

## Task P0-09: Canonical Payout Lifecycle DTO ve Non-Leak Contract'ı Kur

**Files:**

- Create: `apps/api/src/payouts/payout-presentation.ts`
- Modify: `apps/api/src/payouts/payouts.service.ts`
- Modify: `apps/api/src/notifications/templates.ts`
- Modify: `apps/api/test/payouts.int-spec.ts`
- Modify: `apps/api/test/notifications.int-spec.ts`

**Rules:**

```ts
type PayoutPresentationState =
  | 'earned'
  | 'maturing'
  | 'payable'
  | 'requested'
  | 'under-verification'
  | 'approved'
  | 'processing'
  | 'issued'
  | 'mailed'
  | 'settled'
  | 'cleared'
  | 'held'
  | 'rejected'
  | 'failed'
  | 'reversed'
  | 'status-unavailable';
```

- [ ] Layered eligibility/review/fulfillment mapper testlerini yaz: Earned/Maturing/Payable; Requested/Under verification/Approved/Rejected; ACH Approved→Processing→Settled; Check Approved→Issued→Mailed→Cleared; Held orthogonal; Reversed audited terminal transition.
- [ ] Event contract'a unique id, attemptId, method, occurredAt, recordedAt ve authoritative version ekle; duplicate idempotency ve out-of-order event'in state'i geriye çekmemesini test et.
- [ ] Unknown/contradictory event sequence'in `status-unavailable` + actions disabled döndürdüğünü test et.
- [ ] Current snapshot adapter'ın yalnız requested/processing/settled/rejected/failed'i evidence varsa gösterebildiğini; Under verification/Approved/Held/Issued/Mailed/Cleared/Reversed event authority yokken bu state'leri uydurmadığını test et.
- [ ] Member history'nin created/processing/terminal timestamp, currency ve safe reason döndürdüğünü; recipient email/evidence/routing/account/token/secret döndürmediğini test et.
- [ ] Notification copy'nin “sent” yerine authoritative settlement/rejection/failure dilini kullandığını test et.
- [ ] Testleri çalıştır; FAIL bekle.
- [ ] Pure event fold/mapper ve legacy snapshot adapter ekle; response `authority: 'event-log' | 'legacy-snapshot' | 'unavailable'` ve supported actions taşısın.
- [ ] Full event storage/provider source mevcut olmadığı için method-specific state acceptance'ını authority matrix/acceptance ledger'da BLOCKED bırak; schema/provider sistemi ayrıca onaylanmadan üretme.
- [ ] Dar payout + notification integration testlerini çalıştır; PASS bekle.
- [ ] Commit: `fix: map payout lifecycle from authoritative events`.

## Task P0-10: Capability ve Route/Tenant Contract'ını Normalize Et

**Files:**

- Modify: `apps/api/src/common/permissions.ts`
- Modify: `apps/api/src/memberships/me.controller.ts`
- Modify: `apps/api/test/rbac.int-spec.ts`
- Modify: `apps/api/test/platform.int-spec.ts`
- Modify: `apps/api/test/admin.int-spec.ts`

**Target `/me` addition:**

```ts
capabilities: {
  permissions: string[];
  isTenantOwner: boolean;
  isPlatformAdmin: boolean;
  mfa: { enrolled: boolean; current: boolean; assuranceExpiresAt: string | null };
};
```

- [ ] Owner/platform normalized full permissions, member empty permissions ve custom-role live permissions testlerini yaz.
- [ ] Role downgrade sonrası `/me` refresh'in stale token permission'ına güvenmediğini test et.
- [ ] Unauthenticated/member/staff/admin/HQ route matrisi için 401/403/allow sonuçlarını yaz.
- [ ] Sales/member/payout object ID cross-tenant erişimin 404; platform owner olmayanın platform endpointinde 403 olduğunu test et.
- [ ] Testleri çalıştır; FAIL bekle.
- [ ] Permission normalization helper ve `/me.capabilities` response'unu ekle; server guard authority'sini değiştirme.
- [ ] Integration testlerini çalıştır; PASS bekle.
- [ ] Commit: `feat: expose live capability contract`.

## Task P0-11: Authenticated Email Verification Remediation'ı Ekle

**Files:**

- Modify: `apps/api/src/memberships/me.controller.ts`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/recommendations/recommendations.service.ts`
- Modify: `apps/api/test/auth.int-spec.ts`

**Endpoint:** `POST /me/email-verification/resend`.

- [ ] Authenticated unverified user, already-verified user, throttle/replay ve tenant/session isolation testlerini yaz; endpoint yokken FAIL bekle.
- [ ] Eski live email verification token'ını transaction içinde invalidate et; yeni one-time token + outbox notification üret.
- [ ] Response account existence veya raw token sızdırmadan `{ accepted: true, nextAllowedAt }` dönsün.
- [ ] Recommendation/readiness stable remediation href'i bu endpoint'e bağlansın; UI success sonrası authority refetch etsin.
- [ ] Auth integration test + API lint; PASS bekle.
- [ ] Commit: `feat: add email verification remediation`.

## Task P0-12: Fresh Step-Up Server Policy'sini Ekle (Koşullu Güvenlik Onayı)

> Recommended policy: payout settle/fail, tenant suspend/reactivate ve payment/security mutation'ları için son 5 dakika içinde doğrulanmış TOTP/recovery assurance. Bu task açık security onayı olmadan uygulanmaz.

**Files:**

- Modify: `apps/api/src/auth/auth.config.ts`
- Modify: `apps/api/src/auth/auth.types.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/test/auth.int-spec.ts`

**Target response:**

```ts
type AssuranceStatus = {
  level: 'password' | 'mfa' | 'fresh-mfa';
  assuranceExpiresAt: string | null;
};

type StepUpChallenge = {
  code: 'step_up_required';
  challengeToken: string;
  expiresAt: string;
  safeReturnTo: string;
};
```

- [ ] Challenge create/verify, invalid code, recovery code, expiry, replay, cancel ve unsafe return target testlerini yaz.
- [ ] Refresh'in original verification timestamp'ini koruduğu ama fresh state'i expiry ötesine uzatmadığı testi yaz.
- [ ] Testi çalıştır; FAIL bekle.
- [ ] Server `stepUpTtlSeconds = 5 * 60`, allowlisted return target ve one-time challenge'ı uygula.
- [ ] Verify sonrası refresh-session assurance timestamp'ini server time ile rotate et; client time kabul etme.
- [ ] Auth integration testini çalıştır; PASS bekle.
- [ ] Commit: `feat: add server-authoritative step-up assurance`.

## Task P0-13: Fresh Assurance Guard Contract'ını Kur (Koşullu)

**Files:**

- Modify: `apps/api/src/auth/auth.guard.ts`
- Modify: `apps/api/test/auth.int-spec.ts`

- [ ] Fresh/expired/missing assurance matrisi ve `428 step_up_required` challenge response testlerini yaz.
- [ ] Dar kırmızı koşuyu çalıştır: `pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/auth.int-spec.ts`; decorator/guard eksikken FAIL bekle.
- [ ] `@RequireFreshAssurance()` decorator/metadata ve guard enforcement'ını server capability + fresh assurance için uygula.
- [ ] Freshness başarısızlığında mutation/audit side effect olmadığını doğrula.
- [ ] Aynı exact auth integration komutunu yeniden çalıştır; PASS bekle.
- [ ] Commit: `feat: add fresh assurance guard`.

## Task P0-14: Money ve Settings Mutation'larında Fresh Assurance Enforce Et (Koşullu)

**Files:**

- Modify: `apps/api/src/payouts/payouts.controller.ts`
- Modify: `apps/api/test/payouts.int-spec.ts`
- Modify: `apps/api/src/settings/settings.controller.ts`
- Modify: `apps/api/test/settings.int-spec.ts`

- [ ] Payout settle/fail ve payment/security mutation için missing/expired/fresh assurance testlerini yaz; FAIL bekle.
- [ ] Payout settle/fail endpointlerine `@RequireFreshAssurance()` ekle; birleşik settings PATCH içinde yalnız `payoutMinCents` veya `requireSeparateApprover` alanı varsa aynı server helper ile freshness zorunlu kıl. Diğer settings alanlarını gereksiz engelleme.
- [ ] 428 sonucunda hiçbir payout/settings mutation veya audit success side effect olmadığını test et.
- [ ] Targeted integration suites + API lint; PASS bekle.
- [ ] Commit: `fix: require fresh assurance for money mutations`.

## Task P0-15: Company Governance Mutation'larında Fresh Assurance Enforce Et (Koşullu)

**Files:**

- Modify: `apps/api/src/platform/platform.controller.ts`
- Modify: `apps/api/test/platform.int-spec.ts`

- [ ] Suspend/reactivate için missing/expired/fresh assurance ve platform-only authorization testlerini yaz; FAIL bekle.
- [ ] `@RequireFreshAssurance()`ı suspend/reactivate endpointlerine ekle.
- [ ] 428 sonucunda tenant status/session mutation veya success audit olmadığını test et.
- [ ] Platform integration suite + API lint; PASS bekle.
- [ ] Commit: `fix: require fresh assurance for privileged mutations`.

## Task P0-16: Payout Batch Replay ve Partial Retry'ı Kalıcı Execution Kaydına Bağla

**Dependencies:** P0-02 ve P0-07.

**Files:**

- Create: `apps/api/src/common/bulk-execution.ts`
- Modify: `apps/api/src/payouts/payouts.types.ts`
- Modify: `apps/api/src/payouts/payouts.controller.ts`
- Modify: `apps/api/src/payouts/payouts.service.ts`
- Modify: `apps/api/test/payouts.int-spec.ts`

- [ ] Confirm endpoint'inde `Idempotency-Key` eksik/geçersiz olduğunda mutation olmadan 400; aynı tenant+actor+key+payload replay'inde aynı response; farklı payload/token/scope ile 409 testlerini yaz.
- [ ] Request hash'in normalized scope, preview fingerprint, method/period ve tenant+actor bağlamını kapsadığını test et.
- [ ] Partial response'un `succeededIds`, `failed[] { id, code, message }` ve `retryScope: { mode:'selected', membershipIds: failedIds }` taşıdığını yaz.
- [ ] Partial failure'ı batch creation eligibility/reservation record'larıyla sınırla: bilinen record-level blocker'lar failed list'e ayrılır, başarılı subset tek transaction'da reserve edilir. Provider settlement'i item-level kısmiymış gibi gösterme; mevcut settle/fail tüm-batch atomik contract'ı full event/provider authority onaylanana kadar korunur.
- [ ] Failed subset retry'sının yeni preview ve yeni Idempotency-Key istediğini; eski key ile subset değişiminin 409 ürettiğini test et.
- [ ] Replay/retry sırasında ikinci ledger reservation, payout veya batch item oluşmadığını sayım/audit assertion ile test et; ilk dar koşuda FAIL bekle.
- [ ] P0-07 `BulkActionExecution` modelini generic helper üzerinden sales ve payout için transaction lock + completed response replay ile kullan; yeni migration üretme.
- [ ] Crash/processing kaydı için fail-closed recovery sonucu tanımla; bilinmeyen completion'da mutation'ı tekrar çalıştırma.
- [ ] `pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/payouts.int-spec.ts`; PASS bekle.
- [ ] Commit: `feat: make payout batches replay-safe`.

## Task P0-17: Member ve Admin Invite Idempotency Contract'ını Zorunlu Kıl

**Files:**

- Modify: `apps/api/src/invites/invites.controller.ts`
- Modify: `apps/api/src/invites/invites.service.ts`
- Modify: `apps/api/src/members/members.admin.service.ts`
- Modify: `apps/api/test/auth.int-spec.ts`
- Modify: `apps/api/test/admin.int-spec.ts`

- [ ] `/app/invites` ve `/admin/members/invite` için missing/short key 400; same key+same normalized payload aynı invite response; changed email/sponsor payload 409 testlerini yaz.
- [ ] Aynı key'in farklı tenant veya farklı inviter scope'unda çakışmadığını; replay'in ikinci invite/audit/notification üretmediğini test et.
- [ ] Member controller missing key'i 400 yap; admin service missing key'i controller mutation'a girmeden reddetsin. Mevcut parse/hashed persistence/unique inviter scope authority'sini koru.
- [ ] Invite issue sonucu internal `replayed` metadata taşısın; admin service yalnız ilk create'ta `invite.create` side effect'i üretsin, replay'i duplicate create audit/notification'a çevirmesin. Public response'ta gereksiz internal hash gösterme.
- [ ] İlk dar koşuda mandatory header ve member replay coverage eksikliği nedeniyle FAIL, implementation sonrası auth/admin integration testlerinde PASS bekle.
- [ ] `pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/auth.int-spec.ts test/admin.int-spec.ts`.
- [ ] Commit: `fix: require replay-safe invite creation`.

## Task P0-18: NPS Eligibility ve 90 Günlük Dismissal Authority'sini Kur

> Bu task Prisma migration yetkisi gerektirir.

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260716123000_nps_prompt_state/migration.sql`
- Modify: `apps/api/src/wallet/wallet.controller.ts`
- Modify: `apps/api/src/wallet/wallet.service.ts`
- Modify: `apps/api/test/sales-wallet.int-spec.ts`

- [ ] Integration testte eligibility'nin yalnız authoritative `settledAt` payout veya en az üç approved sale + en az 14 günlük membership ile açıldığını yaz.
- [ ] Active payout/readiness blocker, auth/email error veya failed payment varken eligibility'nin false/suppressed olduğunu test et.
- [ ] `POST /app/nps/dismiss` sonrasında 90 gün boyunca suppressed; 90 gün sonunda server-clock ile yeniden eligible olduğunu ve cross-tenant/membership erişiminin olmadığını test et.
- [ ] Aynı dismiss retry'ının idempotent olduğunu; client timestamp/eligibility override'ının kabul edilmediğini yaz; ilk koşuda persistence/endpoint olmadığı için FAIL bekle.
- [ ] Additive `NpsPromptState` model/migration ekle; dashboard'a `npsEligibility { eligible, reasonCode, nextEligibleAt }` ekle ve dismiss endpoint'ini current membership'e bağla.
- [ ] Full survey/analytics sistemi uydurma; bu task yalnız prompt eligibility/dismissal authority'sidir.
- [ ] `pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/sales-wallet.int-spec.ts`; PASS bekle.
- [ ] Commit: `feat: add server-authoritative NPS eligibility`.

## Task P0-19: Member Record Sale Capability Policy'sini Tanımla (Koşullu İş Kuralı Onayı)

> Mevcut sistem yalnız owner/admin/staff için `sales.create` verir. Bu task üyeye ayrı `member.sales.submit` capability'si tanımlar; master'daki ayrı business-rule/API onayı olmadan uygulanmaz. Onay yoksa Home `Record sale` göstermez ve acceptance BLOCKED kalır.

**Files:**

- Modify: `apps/api/src/common/permissions.ts`
- Modify: `apps/api/src/memberships/me.controller.ts`
- Modify: `apps/api/test/rbac.int-spec.ts`

- [ ] Önce RBAC testinde system member'ın yalnız `member.sales.submit`, admin/staff'ın mevcut admin sales permission'ları ve custom role ceiling/tenant scope beklentilerini yaz; permission olmadığı için FAIL bekle.
- [ ] `member.sales.submit` capability'sini admin `sales.create/approve/void/import` permission'larından ayrı tanımla; member'a admin sales view veya approval capability verme.
- [ ] `/me.capabilities` normalized response'un bu capability'yi server-derived verdiğini; role-string client tahminiyle üretilmediğini test et.
- [ ] Downgrade/inactive membership sonrası capability'nin güncel server response'undan kalktığını doğrula.
- [ ] `pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/rbac.int-spec.ts`; PASS bekle.
- [ ] Commit: `feat: define member sale submission capability`.

## Task P0-20: Member Self-Service Record Sale API'sini Ekle (Koşullu)

**Dependencies:** P0-19.

**Files:**

- Modify: `apps/api/src/sales/sales.controller.ts`
- Modify: `apps/api/src/sales/sales.module.ts`
- Modify: `apps/api/src/sales/sales.types.ts`
- Modify: `apps/api/src/sales/sales.service.ts`
- Modify: `apps/api/test/sales-wallet.int-spec.ts`

- [ ] `POST /app/sales` için `member.sales.submit` capability'si ve current membership'in seller olarak server tarafından zorlandığını; client seller/tenant/role override'ının reddedildiğini test et.
- [ ] Member input contract'ını BigInt-safe decimal cent string, sale date, required external/customer evidence reference ve optional safe note ile sınırla; draft state + expected review metadata dön.
- [ ] `GET /app/sales?status=&page=&pageSize=` yalnız caller'ın submissions'ını bounded/paginated ve safe follow-up status ile döndürsün; cross-member/cross-tenant rows bulunmasın.
- [ ] Member create'ın approval/delivery/payout mutation yapmadığını; duplicate external reference ve double-submit için fail-closed/idempotent davranışı test et.
- [ ] Owner/admin/staff `/admin/sales` contract'ını geriye uyumlu tut; member'a admin sales view/approve/void/import permission verme.
- [ ] `AppSalesController`ı module'a register et; ilk dar koşuda member route olmadığı için FAIL, implementation sonrası `test/sales-wallet.int-spec.ts` PASS bekle.
- [ ] Commit: `feat: allow members to submit reviewable sales`.

## Task P0-21: P0 API Gate'ini Kapat

**Files:**

- Modify: `docs/superpowers/plans/evidence/earnica-p0-authority-matrix.json`
- Modify: `tasks/earnica-full-product-redesign-todo.md`

- [ ] Çalıştırılan exact test/command ve sonucu authority JSON'a ekle; absent upstream alanları PASS yapma.
- [ ] `pnpm.cmd --filter @refearn/api lint`.
- [ ] `pnpm.cmd --filter @refearn/api test --runInBand`.
- [ ] Onaylı test DB varsa: `pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/auth.int-spec.ts test/sales-wallet.int-spec.ts test/payouts.int-spec.ts test/rbac.int-spec.ts test/platform.int-spec.ts test/admin.int-spec.ts test/notifications.int-spec.ts`.
- [ ] `pnpm.cmd --filter @refearn/api build`.
- [ ] Authority matrix'te her satırı `implemented/partial/absent/not-applicable` ve gerçek command sonucu ile güncelle.
- [ ] Checklist P0 checkpoint'ini yalnız mandatory testler geçtiğinde tamamla.
- [ ] Commit: `docs: record Earnica P0 contract evidence`.

## P0 Exit Criteria

- Consent missing/false/version mismatch invite'ı tüketmez.
- MFA-pending invite consent final challenge öncesi final kabul kaydı üretmez.
- Selected boşken hiçbir bulk/payout mutation all-results'a genişlemez.
- Sales all-results ve payout all-eligible preview/count/currency drift yeniden review ister.
- Replay aynı mutation'ı ikinci kez çalıştırmaz; partial failures güvenli retry edilir.
- Member/admin invite create aynı key+payload'ı replay eder; payload değişimi conflict olur.
- Wallet GET ve payout POST aynı readiness authority'sini kullanır.
- Unknown compliance sources ready göstermez.
- Payout UI'nın tükettiği state yalnız authoritative event mapper'dan gelir.
- Cross-tenant nesne 404, capability eksikliği 403, fresh assurance eksikliği (onaylandıysa) 428 üretir.
- Routing/account/full evidence member/list response'larına sızmaz.
- Multi-currency değerler FX olmadan ayrı kalır.
- NPS prompt eligibility/dismissal server-clock ve authoritative lifecycle verisinden gelir; blocker sırasında gösterilmez.
- Ayrı iş kuralı onaylandıysa member sale submission current membership'e bağlı draft/review akışıdır; onaylanmadıysa UI bu görevi göstermez ve criterion BLOCKED kalır.
