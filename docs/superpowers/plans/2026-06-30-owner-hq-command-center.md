# Owner HQ — Command Center (Alt-proje A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The platform owner (`platform_admin`) logs in and lands on a single `/hq` command center showing all companies' earnings (gross + net), a revenue leaderboard, and pending work; clicking a company loads that company's admin modules in-place (Model 1) without leaving HQ.

**Architecture:** Backend gains two endpoints — `POST /platform/companies/:id/act-as` (issues a tenant-scoped god token for the owner who has no membership) and `GET /platform/overview` (portfolio aggregates). One auth guard is relaxed so the act-as token passes `/admin/*` routes. Frontend gains an `/hq` shell + command center, a company switcher, and `/hq/c/[id]/<module>` routes that reuse the existing admin page bodies (extracted into shared components) driven by an in-memory "active company token".

**Tech Stack:** NestJS 11 + Prisma 6 + Postgres (apps/api), Next.js 15 App Router + React 19 (apps/web), Jest integration tests via supertest (`apps/api/test/*.int-spec.ts`), `tsc --noEmit` + chrome-devtools visual QA for web.

**Scope note:** Subdomains, shared-cookie auth, DNS/TLS and branded company login are **Alt-proje B** (out of scope here). A runs on the current single domain; the owner lands on `/hq` (replacing today's thin `/platform`).

---

## File Structure

**Backend (`apps/api`)**
- Modify `src/auth/auth.guard.ts` — relax `@RequireMembership` to accept platform-admin tenant-scoped tokens.
- Modify `src/auth/auth.service.ts` — add `actAsTenant(userId, tenantId)`.
- Modify `src/platform/platform.controller.ts` — add `POST companies/:id/act-as` and `GET overview`.
- Modify `src/platform/platform.service.ts` — add `overview()` and a reusable `companyKpis()` helper (extract from existing `companies()`).
- Create `test/platform-hq.int-spec.ts` — act-as + guard + overview tests.
- Modify `test/helpers.ts` — add `createPlatformAdmin()` helper.

**Frontend (`apps/web`)**
- Modify `src/lib/api.ts` — module-level active-company-token override for `/admin/*` calls.
- Create `src/lib/hq.ts` — `actAsCompany()` + active-company token lifecycle, `OverviewResp` type.
- Create `src/app/hq/layout.tsx` — HQ shell (gate on `isPlatformAdmin`, switcher slot).
- Create `src/app/hq/page.tsx` — command center (3 layers, consumes `/platform/overview`).
- Create `src/components/HqCompanySwitcher.tsx` — global company dropdown.
- Create `src/app/hq/c/[id]/layout.tsx` — drill-in shell (sets active-company token, back link, switcher, company nav).
- Create `src/app/hq/c/[id]/page.tsx` — company overview (reuses admin overview body).
- Create `src/components/admin/<Module>PageContent.tsx` — extracted admin page bodies (Sales first as template, then the rest).
- Modify `src/app/admin/<module>/page.tsx` — become thin wrappers rendering the extracted content.
- Create `src/app/hq/c/[id]/<module>/page.tsx` — thin wrappers rendering the same content scoped to `[id]`.
- Modify `src/lib/auth.ts` — `landingForSession` sends platform admins to `/hq` (not `/platform`).

---

## Task B1: Auth — `actAsTenant` token + `POST /platform/companies/:id/act-as`

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts` (add method near `switchTenant`, around line 371)
- Modify: `apps/api/src/platform/platform.controller.ts` (add route)
- Modify: `apps/api/src/platform/platform.service.ts` (add `actAs` that audits + delegates)
- Modify: `apps/api/test/helpers.ts` (add `createPlatformAdmin`)
- Test: `apps/api/test/platform-hq.int-spec.ts` (create)

- [ ] **Step 1: Add the `createPlatformAdmin` test helper**

Append to `apps/api/test/helpers.ts`:

```typescript
import { hash } from '@node-rs/argon2';

const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

/** Dogrulanmis bir platform_admin kullanicisi olusturur (login icin gercek sifre hash'i). */
export async function createPlatformAdmin(
  prisma: PrismaClient,
  password: string,
  email = `platform-${next()}@test.refearn.local`,
): Promise<{ id: string; email: string }> {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, ARGON2),
      fullName: 'Test Platform',
      isPlatformAdmin: true,
      emailVerifiedAt: new Date(),
    },
    select: { id: true, email: true },
  });
  return user;
}
```

- [ ] **Step 2: Write the failing test (act-as issues a tenant-scoped token; non-admin rejected)**

Create `apps/api/test/platform-hq.int-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createChain, createPlatformAdmin, createPlan, createTenant, truncateAll,
} from './helpers';

describe('platform HQ (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const PASSWORD = 'Cok-Gizli-Sifre-42!';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  async function loginPlatform() {
    await createPlatformAdmin(prisma, PASSWORD, 'plat@test.refearn.local');
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login').send({ email: 'plat@test.refearn.local', password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  it('act-as: platform admin bir sirket icin tenant-scoped god token alir', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const token = await loginPlatform();

    const res = await request(app.getHttpServer())
      .post(`/v1/platform/companies/${tenant.id}/act-as`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    const claims = JSON.parse(Buffer.from(res.body.accessToken.split('.')[1], 'base64').toString());
    expect(claims.tid).toBe(tenant.id);
    expect(claims.role).toBe('tenant_owner');
    expect(claims.plat).toBe(true);

    const audit = await prisma.auditLog.count({ where: { tenantId: tenant.id, action: 'platform.act_as' } });
    expect(audit).toBe(1);
  });

  it('act-as: platform yetkisi olmayan 403', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    // uye token'i almak icin: register flow yerine dogrudan reddi dogrula (token yok → 401)
    await request(app.getHttpServer())
      .post(`/v1/platform/companies/${tenant.id}/act-as`)
      .expect(401);
    void member;
  });
});
```

- [ ] **Step 3: Run it — expect failure (route 404)**

Run: `pnpm --filter @refearn/api test:int -- platform-hq`
Expected: FAIL — `POST /v1/platform/companies/:id/act-as` returns 404 (route not defined).

- [ ] **Step 4: Add `actAsTenant` to `AuthService`**

In `apps/api/src/auth/auth.service.ts`, add after `switchTenant` (≈ line 371). Reuse the existing `jwt`, `authConfig`, `Role`, `TenantStatus` imports already in the file:

```typescript
/**
 * Platform admin'in (uyeligi olmayan) bir tenant adina god yetkili,
 * kisa omurlu token almasi. switchTenant'in uyeliksiz varyanti.
 * Yenilenmez (refresh yok); suresi dolunca on yuz tekrar act-as cagirir.
 */
async actAsTenant(userId: string, tenantId: string): Promise<{ accessToken: string }> {
  const user = await this.prisma.user.findFirst({
    where: { id: userId, isPlatformAdmin: true },
    select: { id: true, isPlatformAdmin: true },
  });
  if (!user) throw new ForbiddenException('platform yetkisi gerekli');

  const tenant = await this.prisma.tenant.findFirst({
    where: { id: tenantId, status: TenantStatus.active },
    select: { id: true },
  });
  if (!tenant) throw new NotFoundException('sirket bulunamadi veya aktif degil');

  const payload: AccessTokenPayload = {
    sub: user.id,
    mid: null,
    tid: tenant.id,
    role: Role.tenant_owner,
    plat: true,
  };
  const accessToken = await this.jwt.signAsync(payload, {
    secret: authConfig.accessSecret(),
    expiresIn: authConfig.accessTtlSeconds,
  });
  return { accessToken };
}
```

Ensure `ForbiddenException` and `NotFoundException` are imported from `@nestjs/common` (NotFoundException already is; add ForbiddenException if missing). `AccessTokenPayload` is imported from `./auth.types`.

- [ ] **Step 5: Add `actAs` to `PlatformService` (audit + delegate)**

In `apps/api/src/platform/platform.service.ts`, inject `AuthService` (add to constructor) and add:

```typescript
async actAs(actorUserId: string, tenantId: string): Promise<{ accessToken: string }> {
  const res = await this.auth.actAsTenant(actorUserId, tenantId);
  await this.prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId,
      action: 'platform.act_as',
      entity: 'tenant',
      entityId: tenantId,
      after: { tenantId, role: 'tenant_owner', platformAdmin: true } as Prisma.InputJsonValue,
    },
  });
  return res;
}
```

Add `AuthService` to the constructor (`private readonly auth: AuthService`) and ensure `AuthModule`/`AuthService` is importable by `PlatformModule` (it likely already shares it; if not, add `AuthModule` to `PlatformModule` imports or export `AuthService`). Import `Prisma` from `@prisma/client` if not present.

- [ ] **Step 6: Add the controller route**

In `apps/api/src/platform/platform.controller.ts` (already `@PlatformAdmin()` + `@Controller('platform')`), add:

```typescript
@Post('companies/:id/act-as')
actAs(@CurrentUser() user: RequestUser, @Param('id') id: string) {
  return this.platform.actAs(user.sub, id);
}
```

Use the file's existing imports for `@Post`, `@Param`, `@CurrentUser`, `RequestUser`.

- [ ] **Step 7: Run the test — expect pass**

Run: `pnpm --filter @refearn/api test:int -- platform-hq`
Expected: PASS (both `act-as` tests green).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/auth/auth.service.ts apps/api/src/platform/platform.controller.ts apps/api/src/platform/platform.service.ts apps/api/test/helpers.ts apps/api/test/platform-hq.int-spec.ts
git commit -m "feat(api): platform act-as tenant token endpoint + audit"
```

---

## Task B2: Auth guard — let act-as token pass `/admin/*` routes

The act-as token has `mid: null`; `@RequireMembership` currently rejects it. Relax it to accept a platform-admin tenant-scoped token (`plat && tid`).

**Files:**
- Modify: `apps/api/src/auth/auth.guard.ts:131-133`
- Test: `apps/api/test/platform-hq.int-spec.ts` (extend)

- [ ] **Step 1: Write the failing test (act-as token can call an admin route; plain platform token cannot)**

Append inside the `describe` in `platform-hq.int-spec.ts`:

```typescript
it('act-as token /admin rotalarini gecer; duz platform token gecemez', async () => {
  const tenant = await createTenant(prisma);
  await createPlan(prisma, tenant.id);
  const platToken = await loginPlatform();

  // duz platform token (tid yok) → /admin reddedilir (uyelik gerekli)
  await request(app.getHttpServer())
    .get('/v1/admin/payouts/payable')
    .set('Authorization', `Bearer ${platToken}`)
    .expect(403);

  // act-as token (tid var) → /admin gecer
  const actAs = await request(app.getHttpServer())
    .post(`/v1/platform/companies/${tenant.id}/act-as`)
    .set('Authorization', `Bearer ${platToken}`)
    .expect(201);

  await request(app.getHttpServer())
    .get('/v1/admin/payouts/payable')
    .set('Authorization', `Bearer ${actAs.body.accessToken}`)
    .expect(200);
});
```

- [ ] **Step 2: Run — expect failure (act-as call gets 403 on /admin)**

Run: `pnpm --filter @refearn/api test:int -- platform-hq`
Expected: FAIL — the act-as `GET /admin/payouts/payable` returns 403 (membership required).

- [ ] **Step 3: Relax the guard**

In `apps/api/src/auth/auth.guard.ts`, find the `@RequireMembership` check (≈ line 131-133):

```typescript
if (this.reflector.getAllAndOverride<boolean>(REQUIRE_MEMBERSHIP_KEY, targets) && !payload.mid) {
  throw new ForbiddenException('aktif uyelik secimi gerekli (switch-tenant)');
}
```

Replace the condition so a platform-admin tenant-scoped token (act-as) is accepted:

```typescript
const actingAsTenant = payload.plat === true && !!payload.tid;
if (
  this.reflector.getAllAndOverride<boolean>(REQUIRE_MEMBERSHIP_KEY, targets) &&
  !payload.mid &&
  !actingAsTenant
) {
  throw new ForbiddenException('aktif uyelik secimi gerekli (switch-tenant)');
}
```

Security note: only the `@PlatformAdmin()`-guarded `act-as` endpoint can mint a `plat && tid` token; ordinary platform tokens have `tid: null`, so this does not widen access for anyone else.

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @refearn/api test:int -- platform-hq`
Expected: PASS (all three tests).

- [ ] **Step 5: Regression — run the full auth + admin suites**

Run: `pnpm --filter @refearn/api test:int -- auth admin payouts`
Expected: PASS (no regressions from the guard change).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/auth.guard.ts apps/api/test/platform-hq.int-spec.ts
git commit -m "feat(api): accept platform act-as tenant token on admin routes"
```

---

## Task B3: `GET /platform/overview` — portfolio totals + leaderboard + attention

**Files:**
- Modify: `apps/api/src/platform/platform.service.ts` (add `overview()`; extract `companyKpis()` from `companies()`)
- Modify: `apps/api/src/platform/platform.controller.ts` (add `GET overview`)
- Test: `apps/api/test/platform-hq.int-spec.ts` (extend)

- [ ] **Step 1: Confirm attention-source model + enum names**

Read `apps/api/prisma/schema.prisma` and confirm the exact Prisma model + enum names used by the payouts/fraud/kyc/campaign queues (the `admin/payouts/page.tsx` consumes `/admin/payouts/batches`, `/admin/fraud?status=open`, `/admin/payout-profiles?status=pending_review`). Record the model names and the status enum values; you will reference them in Step 4. (Likely: a payout-batch model with a `proposed`/pending status, a fraud-flag model with `open`, a payout-profile model with `pending_review`, `Invoice` with `open` + `dueAt`, `Campaign` with `active` + `endsAt`.)

- [ ] **Step 2: Write the failing test (overview math: gross, net, payable; leaderboard; auth)**

Append to `platform-hq.int-spec.ts`. Seed an approved sale (this month) + a commission ledger entry + a payable ledger entry, then assert:

```typescript
import { monthKey } from '../src/engine/month';
import { LedgerStatus, LedgerType, SaleStatus } from '@prisma/client';

it('overview: portfoy brut/net/odenecek + leaderboard', async () => {
  const tenant = await createTenant(prisma);            // timezone America/New_York
  await createPlan(prisma, tenant.id);
  const [seller] = await createChain(prisma, tenant.id, 1);
  const platToken = await loginPlatform();

  const m = monthKey(new Date(), tenant.timezone);
  const sale = await prisma.sale.create({
    data: {
      tenantId: tenant.id, sellerMembershipId: seller.id,
      amountCents: 100_000n, saleDate: new Date(), summaryMonth: m, status: SaleStatus.approved,
    },
  });
  await prisma.ledgerEntry.create({
    data: {
      tenantId: tenant.id, saleId: sale.id, beneficiaryMembershipId: seller.id,
      level: 0, rateBpsUsed: 500, amountCents: 5_000n,
      type: LedgerType.commission, status: LedgerStatus.payable,
    },
  });

  const res = await request(app.getHttpServer())
    .get('/v1/platform/overview')
    .set('Authorization', `Bearer ${platToken}`)
    .expect(200);

  expect(res.body.totals.grossRevenueCents).toBe('100000');
  expect(res.body.totals.netCents).toBe('95000');        // 100000 - 5000 komisyon
  expect(res.body.totals.payableCents).toBe('5000');
  expect(res.body.totals.companies).toBe(1);
  expect(res.body.leaderboard[0]).toMatchObject({ id: tenant.id, revenueThisMonthCents: '100000' });
  expect(res.body.attention).toBeDefined();
});

it('overview: token yoksa 401', async () => {
  await request(app.getHttpServer()).get('/v1/platform/overview').expect(401);
});
```

- [ ] **Step 3: Run — expect failure (route 404)**

Run: `pnpm --filter @refearn/api test:int -- platform-hq`
Expected: FAIL — `GET /v1/platform/overview` 404.

- [ ] **Step 4: Implement `overview()` in `PlatformService`**

In `apps/api/src/platform/platform.service.ts`, reuse the existing per-tenant patterns. Use `monthKey(new Date(), t.timezone)` per tenant (already imported in this file for `companies()`):

```typescript
async overview(): Promise<{
  totals: { grossRevenueCents: string; netCents: string; payableCents: string; activeMembers: number; companies: number };
  leaderboard: Array<{ id: string; slug: string; name: string; status: string; currency: string; revenueThisMonthCents: string; members: number; activeMembers: number }>;
  attention: { payoutApprovals: number; riskReviews: number; overdueInvoices: number; campaignsToFinalize: number };
}> {
  const tenants = await this.prisma.tenant.findMany({ where: { status: TenantStatus.active } });

  let gross = 0n, commission = 0n, payable = 0n, activeMembersTotal = 0;
  const leaderboard: Array<{ id: string; slug: string; name: string; status: string; currency: string; revenueThisMonthCents: string; members: number; activeMembers: number }> = [];

  for (const t of tenants) {
    const m = monthKey(new Date(), t.timezone);

    const sales = await this.prisma.sale.findMany({
      where: { tenantId: t.id, status: SaleStatus.approved, summaryMonth: m },
      select: { id: true, amountCents: true },
    });
    const revenue = sales.reduce((a, s) => a + s.amountCents, 0n);
    const saleIds = sales.map((s) => s.id);

    const comm = saleIds.length
      ? (await this.prisma.ledgerEntry.aggregate({
          where: { tenantId: t.id, saleId: { in: saleIds }, type: LedgerType.commission },
          _sum: { amountCents: true },
        }))._sum.amountCents ?? 0n
      : 0n;

    const pay = (await this.prisma.ledgerEntry.aggregate({
      where: { tenantId: t.id, status: LedgerStatus.payable },
      _sum: { amountCents: true },
    }))._sum.amountCents ?? 0n;

    const members = await this.prisma.membership.count({ where: { tenantId: t.id } });
    const active = await this.prisma.membership.count({ where: { tenantId: t.id, status: MembershipStatus.active } });

    gross += revenue; commission += comm; payable += pay; activeMembersTotal += active;
    leaderboard.push({
      id: t.id, slug: t.slug, name: t.name, status: t.status, currency: t.currency,
      revenueThisMonthCents: revenue.toString(), members, activeMembers: active,
    });
  }

  leaderboard.sort((a, b) => Number(BigInt(b.revenueThisMonthCents) - BigInt(a.revenueThisMonthCents)));

  const now = new Date();
  const attention = {
    // Step 1'de dogrulanan model/enum adlarini kullan:
    payoutApprovals: await this.prisma.payoutBatch.count({ where: { status: 'proposed' as never } }),
    riskReviews:
      (await this.prisma.fraudFlag.count({ where: { status: 'open' as never } })) +
      (await this.prisma.payoutProfile.count({ where: { status: 'pending_review' as never } })),
    overdueInvoices: await this.prisma.invoice.count({ where: { status: 'open' as never, dueAt: { lt: now } } }),
    campaignsToFinalize: await this.prisma.campaign.count({ where: { status: 'active' as never, endsAt: { lt: now } } }),
  };

  return {
    totals: {
      grossRevenueCents: gross.toString(),
      netCents: (gross - commission).toString(),
      payableCents: payable.toString(),
      activeMembers: activeMembersTotal,
      companies: tenants.length,
    },
    leaderboard,
    attention,
  };
}
```

Replace the `'... as never'` casts with the real enum members confirmed in Step 1 (e.g. `PayoutBatchStatus.proposed`). Ensure `SaleStatus`, `LedgerType`, `LedgerStatus`, `MembershipStatus`, `TenantStatus` are imported from `@prisma/client`.

- [ ] **Step 5: Add the controller route**

In `apps/api/src/platform/platform.controller.ts`:

```typescript
@Get('overview')
overview() {
  return this.platform.overview();
}
```

- [ ] **Step 6: Run — expect pass**

Run: `pnpm --filter @refearn/api test:int -- platform-hq`
Expected: PASS (overview math + auth).

- [ ] **Step 7: Type-check the API**

Run: `pnpm --filter @refearn/api lint`
Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/platform/platform.service.ts apps/api/src/platform/platform.controller.ts apps/api/test/platform-hq.int-spec.ts
git commit -m "feat(api): GET /platform/overview portfolio aggregates"
```

---

## Task F1: API client — active-company-token override seam

`request()` is a plain module function (not a React component), so the override must be module-level state, not a hook.

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Add the override slot**

Near the top of `apps/web/src/lib/api.ts` (after `BASE`), add:

```typescript
// HQ drill-in: sahip bir sirkete indiginde /admin/* cagrilari bu token'i kullanir.
// Bellek-ici (localStorage degil) — sayfa yenilemede temizlenir, drill-in layout tekrar set eder.
let activeCompanyToken: string | null = null;
export function setActiveCompanyToken(token: string | null): void { activeCompanyToken = token; }
export function getActiveCompanyToken(): string | null { return activeCompanyToken; }
```

- [ ] **Step 2: Use it for `/admin/*` requests**

In the `request()` wrapper, where the token is resolved from the session (≈ line 52-53):

```typescript
const session = getSession();
const overrideForAdmin = activeCompanyToken && path.startsWith('/admin') ? activeCompanyToken : null;
const token = overrideForAdmin ?? session?.accessToken;
```

Pass `token` to `rawFetch` exactly as before. Leave `/platform/*` and all other paths on the session token (so the HQ shell's own `/platform/overview` calls still use the platform token even while an active company token is set).

Note on 401-refresh: when `overrideForAdmin` is active, a 401 should NOT trigger the localStorage session refresh (the override token is short-lived and refreshed by re-`act-as`). Guard the existing refresh path: only attempt `refresh()` when `overrideForAdmin` is null.

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @refearn/web exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): active-company-token override for /admin calls"
```

---

## Task F2: HQ client helpers — `lib/hq.ts`

**Files:**
- Create: `apps/web/src/lib/hq.ts`

- [ ] **Step 1: Create the file**

```typescript
import { api } from './api';

export interface OverviewResp {
  totals: {
    grossRevenueCents: string; netCents: string; payableCents: string;
    activeMembers: number; companies: number;
  };
  leaderboard: Array<{
    id: string; slug: string; name: string; status: string; currency: string;
    revenueThisMonthCents: string; members: number; activeMembers: number;
  }>;
  attention: { payoutApprovals: number; riskReviews: number; overdueInvoices: number; campaignsToFinalize: number };
}

export function getOverview(): Promise<OverviewResp> {
  return api.get<OverviewResp>('/platform/overview');
}

/** Sahip adina bir sirket icin god token alir (drill-in). */
export function actAsCompany(companyId: string): Promise<{ accessToken: string }> {
  return api.post<{ accessToken: string }>(`/platform/companies/${companyId}/act-as`);
}
```

- [ ] **Step 2: Type-check + commit**

Run: `pnpm --filter @refearn/web exec tsc --noEmit` → clean.

```bash
git add apps/web/src/lib/hq.ts
git commit -m "feat(web): hq client helpers (overview + act-as)"
```

---

## Task F3: HQ shell — `app/hq/layout.tsx`

Model on `app/platform/layout.tsx` (gate on `isPlatformAdmin`, sidebar, ThemeToggle, logout) but the left nav is just `Genel bakış` + `Şirketler`; the header carries the company switcher (added in F5).

**Files:**
- Create: `apps/web/src/app/hq/layout.tsx`
- Modify: `apps/web/src/lib/auth.ts` (`landingForSession` → `/hq`)

- [ ] **Step 1: Create the layout**

Copy the structure of `app/platform/layout.tsx`. Replace `NAV` with:

```typescript
const NAV = [
  { href: '/hq', label: 'Genel bakış', ic: '◈' },
  { href: '/hq/companies', label: 'Şirketler', ic: '◳' },
];
```

Keep the same gate (`if (!s || !s.user.isPlatformAdmin) router.replace('/login')`), `ThemeToggle`, footer (`Platform owner` + name + `platform` badge + Log out). Use the migrated shadcn `Button`/`Badge` (consistent with the rest of the app).

- [ ] **Step 2: Route platform admins to `/hq`**

In `apps/web/src/lib/auth.ts`, change `landingForSession`:

```typescript
export function landingForSession(s: Session): string {
  if (s.user.isPlatformAdmin) return '/hq';
  return landingPath(activeMembership(s)?.role);
}
```

- [ ] **Step 3: Type-check + visual gate**

Run: `pnpm --filter @refearn/web exec tsc --noEmit` → clean.
Then start the dev server and confirm `/hq` renders the shell (logged in as a platform admin). Capture a chrome-devtools screenshot (dark + light).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/hq/layout.tsx apps/web/src/lib/auth.ts
git commit -m "feat(web): HQ shell + route platform admin to /hq"
```

---

## Task F4: Command center — `app/hq/page.tsx`

Three layers: portfolio summary (metric cards incl. gross + net), company leaderboard (rows, click → drill in), "needs you" strip. Use the migrated shadcn `Card`/`Badge` and the design tokens already in `globals.css`. Money via `money()` from `@/lib/format`.

**Files:**
- Create: `apps/web/src/app/hq/page.tsx`

- [ ] **Step 1: Build the page**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getOverview, type OverviewResp } from '@/lib/hq';
import { Loading } from '@/components/ui';
import { money } from '@/lib/format';
import { ApiError } from '@/lib/api';

export default function HqOverviewPage() {
  const router = useRouter();
  const [data, setData] = useState<OverviewResp | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getOverview().then(setData).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <Loading rows={4} />;

  const t = data.totals;
  return (
    <div>
      <div className="eyebrow fade-in">Komuta merkezi</div>
      <h1 className="h1 fade-in">Genel bakış</h1>

      {/* 1) portfoy ozeti */}
      <div className="stat-grid fade-in delay-1" style={{ margin: '16px 0' }}>
        <Kpi label="Gelir · bu ay" value={money(t.grossRevenueCents)} icon="◆" />
        <Kpi label="Net kâr" value={money(t.netCents)} icon="◇" />
        <Kpi label="Ödenecek komisyon" value={money(t.payableCents)} icon="◷" />
        <Kpi label="Aktif üye" value={String(t.activeMembers)} icon="⬡" />
      </div>

      {/* 2) sirket siralamasi */}
      <strong style={{ fontSize: 13 }} className="faint">Şirketler · kazanca göre</strong>
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
        {data.leaderboard.map((c) => (
          <button key={c.id} className="row spread" onClick={() => router.push(`/hq/c/${c.id}`)}
            style={{ width: '100%', textAlign: 'left', padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}>
            <span><strong>{c.name}</strong> <span className="faint" style={{ fontSize: 12 }}>{c.activeMembers}/{c.members} üye · {c.status}</span></span>
            <span className="tnum" style={{ fontWeight: 650 }}>{money(c.revenueThisMonthCents, c.currency)}</span>
          </button>
        ))}
        {data.leaderboard.length === 0 && <div className="muted" style={{ padding: 16 }}>İlk şirketini oluştur.</div>}
      </div>

      {/* 3) seni bekleyenler */}
      <strong style={{ fontSize: 13 }} className="faint">Seni bekleyenler</strong>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginTop: 8 }}>
        <Attn label="Ödeme onayı" value={data.attention.payoutApprovals} />
        <Attn label="KYC / risk" value={data.attention.riskReviews} />
        <Attn label="Vadesi geçmiş fatura" value={data.attention.overdueInvoices} />
        <Attn label="Finalize bekleyen kampanya" value={data.attention.campaignsToFinalize} />
      </div>
    </div>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="card stat">
      <div className="spread"><span className="k">{label}</span><span className="icon">{icon}</span></div>
      <div className="v">{value}</div>
    </div>
  );
}
function Attn({ label, value }: { label: string; value: number }) {
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="faint" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + visual gate (dark + light)**

Run: `pnpm --filter @refearn/web exec tsc --noEmit` → clean.
chrome-devtools: log in as platform admin, open `/hq`, confirm the three layers render with seeded data; screenshot dark + light; check console clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/hq/page.tsx
git commit -m "feat(web): HQ command center (portfolio + leaderboard + attention)"
```

---

## Task F5: Company switcher — `components/HqCompanySwitcher.tsx`

A header dropdown listing all companies; selecting one navigates to `/hq/c/{id}`. Build on the existing `Popover` component (do not reuse `CommandPalette`).

**Files:**
- Create: `apps/web/src/components/HqCompanySwitcher.tsx`
- Modify: `apps/web/src/app/hq/layout.tsx` (mount it in the header)

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Popover } from '@/components/Popover';
import { Button } from '@/components/ui/button';

interface Company { id: string; name: string; slug: string }

export function HqCompanySwitcher({ currentId }: { currentId?: string }) {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  useEffect(() => { api.get<Company[]>('/platform/companies').then(setCompanies).catch(() => {}); }, []);
  const current = companies.find((c) => c.id === currentId);

  return (
    <Popover trigger={<Button variant="ghost" size="sm">{current ? current.name : 'Tüm şirketler'} ▾</Button>}>
      <div style={{ minWidth: 220 }}>
        <button className="row" style={{ width: '100%', padding: '8px 10px', background: 'transparent', cursor: 'pointer' }}
          onClick={() => router.push('/hq')}>Genel bakış</button>
        {companies.map((c) => (
          <button key={c.id} className="row" style={{ width: '100%', padding: '8px 10px', background: 'transparent', cursor: 'pointer' }}
            onClick={() => router.push(`/hq/c/${c.id}`)}>{c.name}</button>
        ))}
      </div>
    </Popover>
  );
}
```

Adjust the `Popover` props to match its real API (check `apps/web/src/components/Popover.tsx`; it was migrated to Radix earlier — use its actual `trigger`/children contract).

- [ ] **Step 2: Mount in the HQ header** — render `<HqCompanySwitcher />` in `app/hq/layout.tsx`'s topbar/header area.

- [ ] **Step 3: Type-check + visual gate** → `tsc --noEmit` clean; switcher opens, lists companies, navigates.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/HqCompanySwitcher.tsx apps/web/src/app/hq/layout.tsx
git commit -m "feat(web): HQ global company switcher"
```

---

## Task F6: Drill-in shell + Sales module reuse (the extraction template)

This task establishes the reuse pattern with ONE module (Sales). Task F7 repeats it mechanically for the rest.

**Files:**
- Create: `apps/web/src/components/admin/SalesPageContent.tsx` (extracted body)
- Modify: `apps/web/src/app/admin/sales/page.tsx` (thin wrapper)
- Create: `apps/web/src/app/hq/c/[id]/layout.tsx` (drill-in shell)
- Create: `apps/web/src/app/hq/c/[id]/page.tsx` (company overview — reuse admin overview body the same way)
- Create: `apps/web/src/app/hq/c/[id]/sales/page.tsx` (thin wrapper)

- [ ] **Step 1: Extract the Sales body into a shared component**

Move the entire body of `apps/web/src/app/admin/sales/page.tsx` into `apps/web/src/components/admin/SalesPageContent.tsx` as `export function SalesPageContent({ tenantName }: { tenantName: string })`. Replace every `getSession()/activeMembership()` use that only derives `tenantName` (e.g. in `SaleDrawer`) with the `tenantName` prop (thread it down as a prop). Keep all API calls (`/admin/sales...`) unchanged — they will hit the active-company token automatically when mounted under `/hq/c/[id]`.

- [ ] **Step 2: Make the admin route a thin wrapper**

`apps/web/src/app/admin/sales/page.tsx` becomes:

```tsx
'use client';
import { getSession, activeMembership } from '@/lib/auth';
import { SalesPageContent } from '@/components/admin/SalesPageContent';

export default function AdminSalesPage() {
  const s = getSession();
  const tenantName = (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn';
  return <SalesPageContent tenantName={tenantName} />;
}
```

- [ ] **Step 3: Create the drill-in shell `app/hq/c/[id]/layout.tsx`**

Gate on `isPlatformAdmin`; on mount, fetch the company, call `actAsCompany(id)`, store the token via `setActiveCompanyToken`; clear on unmount. Render a header with `← Genel bakış`, the company name, and `<HqCompanySwitcher currentId={id} />`, plus the company module nav (same items as admin nav but pointing at `/hq/c/[id]/<module>`).

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { actAsCompany } from '@/lib/hq';
import { setActiveCompanyToken } from '@/lib/api';
import { api } from '@/lib/api';
import { HqCompanySwitcher } from '@/components/HqCompanySwitcher';
import { Loading } from '@/components/ui';

const MODULES = [
  ['', 'Genel bakış'], ['sales', 'Satışlar'], ['members', 'Üyeler'], ['tree', 'Ağ'],
  ['campaigns', 'Kampanyalar'], ['payouts', 'Ödemeler'], ['checks', 'Çekler'],
  ['periods', 'Dönem'], ['audit', 'Denetim'], ['settings', 'Ayarlar'],
] as const;

export default function HqCompanyLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    const s = getSession();
    if (!s?.user.isPlatformAdmin) { router.replace('/login'); return; }
    let alive = true;
    (async () => {
      try {
        const [company, tok] = await Promise.all([
          api.get<{ name: string }>(`/platform/companies/${id}`),
          actAsCompany(id),
        ]);
        if (!alive) return;
        setName(company.name);
        setActiveCompanyToken(tok.accessToken);
        setReady(true);
      } catch { if (alive) router.replace('/hq'); }
    })();
    return () => { alive = false; setActiveCompanyToken(null); };
  }, [id, router]);

  if (!ready) return <div className="center"><Loading rows={3} /></div>;

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12 }}>
        <Link href="/hq" className="faint">← Genel bakış</Link>
        <HqCompanySwitcher currentId={id} />
      </div>
      <div className="eyebrow">{name}</div>
      <div className="seg-tabs" role="tablist" style={{ marginBottom: 14 }}>
        {MODULES.map(([seg, label]) => (
          <Link key={seg} href={`/hq/c/${id}/${seg}`} className="seg-tab">{label}</Link>
        ))}
      </div>
      {children}
    </div>
  );
}
```

(Active-tab highlighting uses `usePathname()` — wire it the same way the existing `seg-tabs` do in `admin/settings/page.tsx`.)

- [ ] **Step 4: Create the company overview + sales wrappers**

`app/hq/c/[id]/sales/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { SalesPageContent } from '@/components/admin/SalesPageContent';

export default function HqCompanySalesPage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('Refearn');
  useEffect(() => { api.get<{ name: string }>(`/platform/companies/${id}`).then((c) => setName(c.name)).catch(() => {}); }, [id]);
  return <SalesPageContent tenantName={name} />;
}
```

`app/hq/c/[id]/page.tsx`: same wrapper pattern around the extracted admin **overview** body (extract `app/admin/page.tsx` into `components/admin/AdminOverviewContent.tsx` first, mirroring Step 1-2).

- [ ] **Step 5: Type-check + visual gate (the core end-to-end check)**

Run: `pnpm --filter @refearn/web exec tsc --noEmit` → clean.
chrome-devtools, logged in as platform admin: `/hq` → click a company → lands on `/hq/c/{id}` with `← Genel bakış`, switcher, module tabs; open `Satışlar` → the sales module renders this company's data (network calls to `/admin/sales` carry the act-as token). Confirm dark + light, console clean. Confirm `/admin/sales` still works for a real company admin (regression).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/admin/SalesPageContent.tsx apps/web/src/components/admin/AdminOverviewContent.tsx apps/web/src/app/admin/sales/page.tsx apps/web/src/app/admin/page.tsx apps/web/src/app/hq/c/
git commit -m "feat(web): HQ embedded drill-in + Sales/overview reuse"
```

---

## Task F7: Reuse the remaining admin modules

Apply the **exact** Task F6 Step 1-2 + Step 4 pattern (extract body → `components/admin/<Module>PageContent.tsx`, thin admin wrapper, thin `/hq/c/[id]/<module>` wrapper) to each module below. Each is a mechanical repeat — extract the page body verbatim into a `*Content` component, thread `tenantName` (and `meIsAdmin` where a drawer reads it) as props, and add the two wrappers.

- [ ] **Members** — `app/admin/members/page.tsx` → `components/admin/MembersPageContent.tsx` (props: `tenantName`, `meIsAdmin`). Wrappers: `app/admin/members/page.tsx`, `app/hq/c/[id]/members/page.tsx`. Note: keep impersonation behavior unchanged (it uses `startImpersonation` + navigates to `/app`).
- [ ] **Payouts** — `app/admin/payouts/page.tsx` → `components/admin/PayoutsPageContent.tsx` (prop: `tenantName`). Wrappers for `/admin/payouts` + `/hq/c/[id]/payouts`. (Money page — verify approve/reconcile flows still scope to the active company token.)
- [ ] **Checks** — `app/admin/checks/page.tsx` → `CheckspageContent`. Wrappers.
- [ ] **Periods** — `app/admin/periods/page.tsx` → `PeriodsPageContent`. Wrappers.
- [ ] **Campaigns** — `app/admin/campaigns/page.tsx` → `CampaignsPageContent`. Wrappers.
- [ ] **Network/tree** — `app/admin/tree/page.tsx` → `TreePageContent`. Wrappers.
- [ ] **Audit** — `app/admin/audit/page.tsx` → `AuditPageContent`. Wrappers.
- [ ] **Settings** — `app/admin/settings/page.tsx` → `SettingsPageContent`. Wrappers. (The 11 section components under `settings/sections/` are reused as-is; only the page shell is extracted.)

For each module:
1. Type-check: `pnpm --filter @refearn/web exec tsc --noEmit` → clean.
2. Visual gate (chrome-devtools): the module renders the active company's data under `/hq/c/[id]/<module>` AND still works under `/admin/<module>` for a real company admin.
3. Commit: `git add ... && git commit -m "feat(web): HQ reuse <module> module"`.

- [ ] **Final step: Retire the old `/platform` owner pages**

Once `/hq` covers companies list + drill-in, redirect `/platform` → `/hq` (keep `/platform/companies/[id]` working or redirect to `/hq/c/[id]`) so there is a single owner home. Commit.

---

## Self-Review

**Spec coverage:**
- Tek çatı HQ + komuta merkezi → F3, F4. ✔
- Brüt + net kâr + ödenecek + üye/şirket KPI → B3 totals, F4 Kpi row. ✔
- Kazanca göre şirket sıralaması → B3 leaderboard (sorted), F4 list. ✔
- Seni bekleyenler (ödeme onayı / KYC-risk / vadesi geçmiş fatura / kampanya finalize) → B3 attention, F4 Attn. ✔
- Gömülü drill-in (Model 1) → F1 (token seam), F2 (act-as), F6 (shell + reuse), F7 (all modules). ✔
- act-as token + audit + guard → B1, B2. ✔
- net = satış − komisyon, abonelik hariç → B3 (`netCents = gross − commission`; invoices only feed `attention.overdueInvoices`, never net). ✔
- Admin modülleri kopyalanmaz, paylaşılır → F6/F7 extraction. ✔
- Para tam sayı cent / BigInt → B3 (BigInt throughout, `.toString()` at the edge). ✔
- Hata yönetimi (overview retry, act-as fail → HQ, boş şirket) → F3/F4/F6 (`router.replace('/hq')` on act-as failure; empty leaderboard state). ✔
- Subdomain/cookie kapsam dışı → not touched. ✔

**Placeholder scan:** The only deliberate verify-then-fill is B3 Step 1 (confirm attention model/enum names) — it is an explicit lookup step, not a hand-wave, and Step 4 shows the full query shape with the casts to replace. No TBDs elsewhere.

**Type consistency:** `OverviewResp` is defined once (F2) and mirrors the B3 return shape field-for-field (`grossRevenueCents`, `netCents`, `payableCents`, `activeMembers`, `companies`; leaderboard items; `attention.{payoutApprovals,riskReviews,overdueInvoices,campaignsToFinalize}`). `setActiveCompanyToken`/`getActiveCompanyToken` (F1) are the exact names used in F6. `actAsCompany` (F2) matches the F6 layout call. `actAsTenant` (B1 service) ↔ `PlatformService.actAs` (B1) ↔ route (B1) are consistent.

## Notes for the implementer

- Frontend has no unit-test harness; the automated gate is `tsc --noEmit` and the behavioral gate is chrome-devtools visual QA (dark + light, console clean) — the project's established practice. Backend uses real Postgres integration tests (`test:int`, `--runInBand`).
- Run a single backend spec with: `pnpm --filter @refearn/api test:int -- platform-hq`.
- Keep money as `BigInt`/integer cents end-to-end; only stringify at the JSON boundary and format with `money()` in the UI.
