# Platform Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the empty Axtra super-admin surface with a command-center dashboard, onboarding wizard, tabbed company detail, safe impersonation, cross-tenant search, audit/health/admin management, owner email invites, and a plan/package + MRR catalog — MVP-first, reusing the existing `platform.service.ts`/`platform.controller.ts` and `ui.tsx` primitives.

**Architecture:** Backend adds methods to the existing `PlatformService`/`PlatformController` under `@PlatformAdmin()`, one new `PackagesService`, a `TenantStatus.setup_needed` enum + `BillingPackage`/`SystemStatus` tables via append-only Prisma migrations, and a public `accept-owner-invite` route on `AuthService`. Every tenant-scoped mutation keeps `where: { tenantId }`; cross-tenant reads (search, global audit, MRR) live only on the platform surface. The Next.js 15 web app gets an overview page, a `/platform/companies` directory, a `?tab=`-routed company detail, and new nav — all client components reusing `Modal`/`Confirm`/`Pagination`/`StatCard`/`useToast`.

**Tech Stack:** NestJS 11 + Prisma 6 (PostgreSQL, `ltree`, BigInt cents), Jest + supertest integration tests (`--runInBand`), Next.js 15 App Router (React 19, client components), pnpm workspaces + turbo. Money is BigInt cents server-side, serialized to string only at the display edge.

---

## File Structure

### Backend — `apps/api`

| File | Responsibility |
|------|----------------|
| `prisma/schema.prisma` | Add `setup_needed` to `TenantStatus`; add `owner_invite` to `UserTokenPurpose`; add `BillingPackage` model + `TenantBilling.packageId`/`overrides`; add `SystemStatus` model. |
| `prisma/migrations/20260709100000_tenant_setup_needed/migration.sql` | `ALTER TYPE "TenantStatus" ADD VALUE 'setup_needed'`. |
| `prisma/migrations/20260709101000_owner_invite_token/migration.sql` | `ALTER TYPE "UserTokenPurpose" ADD VALUE 'owner_invite'`. |
| `prisma/migrations/20260709102000_billing_packages/migration.sql` | Create `billing_packages`; add `package_id`/`overrides` to `tenant_billing`. |
| `prisma/migrations/20260709103000_system_status/migration.sql` | Create `system_status` (1-row backup marker). |
| `apps/api/src/platform/platform.service.ts` | Add `companies(query)` (paginated + single grouped revenue query), `overview()`, `createCompany` → `setup_needed`, `setBranding`, `setup` block on `company()`, `members()`, `payouts()`, `impersonate()`/`impersonateEnd()`, `search()`, `companyAudit()`/`globalAudit()`, `health()`, `admins()`/`grantAdmin()`/`revokeAdmin()`. |
| `apps/api/src/platform/platform.controller.ts` | New routes for every method above; extend existing `setStatus`. |
| `apps/api/src/platform/platform.types.ts` | Extend `setStatusSchema` to `setup_needed`; add `companiesQuerySchema`, `brandingSchema`, `searchQuerySchema`, `auditQuerySchema`, `grantAdminSchema`, package schemas. |
| `apps/api/src/platform/platform.module.ts` | Import `JwtModule`, `SchedulerModule`; add `PackagesService`; declare `PackagesController` (or fold routes into `PlatformController`). |
| `apps/api/src/platform/packages.service.ts` | `BillingPackage` catalog CRUD + `mrr()`; audited. |
| `apps/api/src/scheduler/scheduler.service.ts` | Add `jobHealthWithStaleness()` helper exposing `stale` per job. |
| `apps/api/src/scheduler/scheduler.module.ts` | `exports: [SchedulerService]`. |
| `apps/api/src/auth/auth.service.ts` | Add `acceptOwnerInvite(token, password, fullName?)`; emit `owner_invite` token from `createCompany` path (called by `PlatformService`). |
| `apps/api/src/auth/auth.controller.ts` | Add public `POST /auth/accept-owner-invite`. |
| `apps/api/src/auth/auth.types.ts` | Add `acceptOwnerInviteSchema`. |

### Backend tests — `apps/api/test`

| File | Responsibility |
|------|----------------|
| `platform.int-spec.ts` | Extend with: pagination/status filter/N-query, overview queue, setup_needed + branding + activate gate, members/payouts pagination, impersonation, search, audit viewer, health, admins, packages+MRR. |
| `auth.int-spec.ts` | Owner-invite mint + accept + expiry (co-located with company-create assertions in `platform.int-spec`). |

### Frontend — `apps/web`

| File | Responsibility |
|------|----------------|
| `src/app/platform/page.tsx` | REPLACE with the **overview** dashboard (KPIs + needs-attention queue). |
| `src/app/platform/companies/page.tsx` | NEW — the moved directory (paginated, status filter, server `q`). |
| `src/app/platform/companies/[id]/page.tsx` | Convert to `?tab=`-routed tabbed detail; wire "Open company admin"; render checklist, branding, users, payouts, audit, health, plans, settings. |
| `src/app/platform/layout.tsx` | Nav → Overview / Companies / Admins / System; add global search box. |
| `src/app/platform/audit/page.tsx` | NEW — global platform audit feed. |
| `src/app/platform/system/page.tsx` | NEW — health/jobs/backup panel (30s auto-refresh). |
| `src/app/platform/admins/page.tsx` | NEW — platform-admin management. |
| `src/app/platform/packages/page.tsx` | NEW — package catalog editor. |
| `src/app/accept-invite/page.tsx` | NEW public — owner set-password. |
| `src/components/platform/OnboardingWizard.tsx` | NEW — 4-step new-company wizard. |
| `src/components/platform/Tabs.tsx` | NEW — small tab strip synced to `?tab=`. |
| `src/components/platform/GlobalSearch.tsx` | NEW — debounced cross-tenant search dropdown. |
| `src/components/platform/statusBadge.tsx` | NEW — shared `statusBadge()` mapping status → badge class + label. |
| `src/app/admin/layout.tsx` | Render "Viewing as {tenant} — exit" band when `isImpersonating()`. |

---

## Tasks

Ordered MVP-first exactly per the spec's Sequencing section (11 → 1 → 2 → 3 → 4 → 6 → 5 → 7 → 8 → 9 → 10).

---

### Task 1: Paginate companies + status filter + collapse N-query revenue loop (spec item 11)

**Files:**
- Modify: `apps/api/src/platform/platform.types.ts` (append after line 37)
- Modify: `apps/api/src/platform/platform.service.ts` (replace `companies()`, lines 16–58)
- Modify: `apps/api/src/platform/platform.controller.ts` (replace `companies()` handler, lines 39–42)
- Test: `apps/api/test/platform.int-spec.ts` (add `describe` block)

> **Decision (per-TZ month, spec item 11):** Keep each tenant's own timezone by grouping `sale.groupBy(['tenantId', 'summaryMonth'])` in **one** query, then select each tenant's current-month key app-side with `monthKey(new Date(), t.timezone)`. This preserves the existing per-tenant month semantics with a single DB round-trip (no N+1).

- [ ] **Step 1: Write the failing test.** Add to `apps/api/test/platform.int-spec.ts` inside the top-level `describe`:

```ts
  it('item 11: paginates, filters by status, and computes revenue in one grouped pass', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-pg@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    // 25 tenants; one gets a current-month approved sale, one is suspended
    const tenants = [];
    for (let i = 0; i < 25; i++) tenants.push(await createTenant(prisma));
    await prisma.tenant.update({ where: { id: tenants[0].id }, data: { status: 'suspended' } });
    const chain = await createChain(prisma, tenants[1].id, 1);
    const sale = await createSale(prisma, tenants[1].id, chain[0].id, 5_000_000n, { status: 'approved' });
    await prisma.sale.update({
      where: { id: sale.id },
      data: { summaryMonth: monthKeyFor(tenants[1].timezone) },
    });

    // page 1, size 10 → 10 rows, total 25
    const p1 = (await request(srv).get('/v1/platform/companies?page=1&pageSize=10')
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(p1.total).toBe(25);
    expect(p1.rows).toHaveLength(10);

    // page 3 → 5 rows
    const p3 = (await request(srv).get('/v1/platform/companies?page=3&pageSize=10')
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(p3.rows).toHaveLength(5);

    // status filter
    const suspended = (await request(srv).get('/v1/platform/companies?status=suspended&pageSize=100')
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(suspended.total).toBe(1);
    expect(suspended.rows[0].id).toBe(tenants[0].id);

    // revenue attributed to the right tenant (single grouped query)
    const all = (await request(srv).get('/v1/platform/companies?pageSize=100')
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    const withRev = all.rows.find((r: { id: string }) => r.id === tenants[1].id);
    expect(withRev.revenueThisMonthCents).toBe('5000000');
  });
```

Add this import + helper near the top of the file (below existing imports):

```ts
import { monthKey } from '../src/engine/month';
const monthKeyFor = (tz: string) => monthKey(new Date(), tz);
```

- [ ] **Step 2: Run test to verify it fails.** Command: `pnpm --filter @refearn/api test:int -- -t "item 11"`. Expected: fails — the route currently returns a bare array (no `.total`/`.rows`), so `p1.total` is `undefined`.

- [ ] **Step 3: Write minimal implementation.**

In `apps/api/src/platform/platform.types.ts`, append:

```ts
/** Item 11: sirket dizini sayfalama + durum filtresi + serbest arama. */
export const companiesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['active', 'suspended', 'setup_needed']).optional(),
  q: z.string().trim().max(80).optional(),
});
export type CompaniesQuery = z.infer<typeof companiesQuerySchema>;
```

In `apps/api/src/platform/platform.service.ts`, replace the `companies()` method (lines 16–58) with:

```ts
  /** Sirketler dizini: sayfali + durum/arama filtreli + TEK grouped ciro sorgusu (N+1 yok). */
  async companies(query: { page: number; pageSize: number; status?: TenantStatus; q?: string }) {
    const where: Prisma.TenantWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { slug: { contains: query.q.toLowerCase() } }] }
        : {}),
    };
    const [total, tenants] = await this.prisma.$transaction([
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const ids = tenants.map((t) => t.id);

    const [byTenant, activeByTenant, revRows] = await Promise.all([
      this.prisma.membership.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: { _all: true } }),
      this.prisma.membership.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: ids }, status: MembershipStatus.active },
        _count: { _all: true },
      }),
      // TEK sorgu: (tenant, ay) grubu; app-side her tenant'in KENDI timezone ayini secer
      this.prisma.sale.groupBy({
        by: ['tenantId', 'summaryMonth'],
        where: { tenantId: { in: ids }, status: SaleStatus.approved },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
    ]);
    const totalM = new Map(byTenant.map((r) => [r.tenantId, r._count._all]));
    const activeM = new Map(activeByTenant.map((r) => [r.tenantId, r._count._all]));
    const revM = new Map<string, { revenue: bigint; sales: number }>();
    for (const t of tenants) {
      const month = monthKey(new Date(), t.timezone);
      const row = revRows.find((r) => r.tenantId === t.id && r.summaryMonth === month);
      revM.set(t.id, { revenue: row?._sum.amountCents ?? 0n, sales: row?._count._all ?? 0 });
    }

    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      rows: tenants.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        currency: t.currency,
        status: t.status,
        timezone: t.timezone,
        members: totalM.get(t.id) ?? 0,
        activeMembers: activeM.get(t.id) ?? 0,
        revenueThisMonthCents: (revM.get(t.id)?.revenue ?? 0n).toString(),
        salesThisMonth: revM.get(t.id)?.sales ?? 0,
        createdAt: t.createdAt,
      })),
    };
  }
```

In `apps/api/src/platform/platform.controller.ts`, add the import to the `platform.types` import block and replace the `companies()` handler:

```ts
  @Get('companies')
  companies(@Query(new ZodValidationPipe(companiesQuerySchema)) q: CompaniesQuery) {
    return this.platform.companies(q);
  }
```

Add `Query` to the `@nestjs/common` import and `companiesQuerySchema, CompaniesQuery` to the `./platform.types` import.

- [ ] **Step 4: Run test to verify it passes.** Command: `pnpm --filter @refearn/api test:int -- -t "item 11"`. Expected: 1 passing. Then `pnpm --filter @refearn/api lint`. Expected: no type errors.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "platform: paginate companies + status filter + single grouped revenue query (item 11)"`

---

### Task 2: Add `TenantStatus.setup_needed` enum + migration (spec item 2, backend enum only)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (lines 28–31)
- Create: `apps/api/prisma/migrations/20260709100000_tenant_setup_needed/migration.sql`
- Modify: `apps/api/src/platform/platform.types.ts` (`setStatusSchema`, lines 6–8)
- Test: `apps/api/test/platform.int-spec.ts`

> **Decision (per spec item 2 — CONFIRMED recommendation):** `setup_needed` is treated by the guard as **fully open** (behaves like `active` for auth) — the guard only special-cases `suspended` ([`auth.guard.ts:84`,`120`](apps/api/src/auth/auth.guard.ts)). No guard change. The flag is a platform-side checklist state only.

- [ ] **Step 1: Write the failing test.** Add to `platform.int-spec.ts`:

```ts
  it('item 2: setup_needed enum round-trips and status schema accepts it', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-sn@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const tenant = await prisma.tenant.create({
      data: { slug: 'setup-co', name: 'Setup Co', status: 'setup_needed' },
    });
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe('setup_needed');

    // PATCH status accepts setup_needed → active
    await request(app.getHttpServer())
      .patch(`/v1/platform/companies/${tenant.id}/status`)
      .set('Authorization', `Bearer ${platTok}`)
      .send({ status: 'active' })
      .expect(200);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe('active');
  });
```

- [ ] **Step 2: Run test to verify it fails.** Command: `pnpm --filter @refearn/api test:int -- -t "item 2: setup_needed enum"`. Expected: fails — Prisma rejects `status: 'setup_needed'` (unknown enum value).

- [ ] **Step 3: Write minimal implementation.**

In `apps/api/prisma/schema.prisma`, change the enum (lines 28–31):

```prisma
enum TenantStatus {
  active
  suspended
  setup_needed
}
```

Create `apps/api/prisma/migrations/20260709100000_tenant_setup_needed/migration.sql`:

```sql
-- Item 2: yeni sirketler kurulum-bekliyor durumunda acilir (append-only, guvenli).
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'setup_needed';
```

In `apps/api/src/platform/platform.types.ts`, widen `setStatusSchema` (lines 6–8):

```ts
export const setStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'setup_needed']),
});
```

Apply the migration: `pnpm --filter @refearn/api db:migrate`.

- [ ] **Step 4: Run test to verify it passes.** Command: `pnpm --filter @refearn/api test:int -- -t "item 2: setup_needed enum"`. Expected: 1 passing. Then `pnpm --filter @refearn/api lint`. Expected: clean.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "platform: add TenantStatus.setup_needed enum + migration (item 2)"`

---

### Task 3: New tenants land in `setup_needed`; branding endpoint; `setup` checklist block; activate gate (spec item 2, backend)

**Files:**
- Modify: `apps/api/src/platform/platform.service.ts` (`createCompany` line 159 `tenant.create`; `company()` return, lines 82–101; add `setBranding`)
- Modify: `apps/api/src/platform/platform.types.ts` (add `brandingSchema`)
- Modify: `apps/api/src/platform/platform.controller.ts` (add `PUT companies/:id/branding`; block activate-without-plan in `setStatus`)
- Test: `apps/api/test/platform.int-spec.ts`

- [ ] **Step 1: Write the failing test.**

```ts
  it('item 2: createCompany lands in setup_needed; branding validates; activate blocked without plan', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-wiz@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    const created = (await request(srv).post('/v1/platform/companies')
      .set('Authorization', `Bearer ${platTok}`)
      .send({ name: 'Wizard Co', slug: 'wizard-co', currency: 'USD', timezone: 'America/New_York', ownerEmail: 'own@wiz.co', ownerName: 'Owner' })
      .expect(201)).body;
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: created.id } });
    expect(t.status).toBe('setup_needed');

    // company() exposes setup block (has default plan → hasPlan true)
    const detail = (await request(srv).get(`/v1/platform/companies/${created.id}`)
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(detail.setup).toMatchObject({ hasPlan: true, hasBranding: false });

    // bad hex rejected
    await request(srv).put(`/v1/platform/companies/${created.id}/branding`)
      .set('Authorization', `Bearer ${platTok}`)
      .send({ primaryHex: 'red' }).expect(400);

    // good branding persists
    await request(srv).put(`/v1/platform/companies/${created.id}/branding`)
      .set('Authorization', `Bearer ${platTok}`)
      .send({ primaryHex: '#112233', logoUrl: 'https://cdn.example.com/l.png' }).expect(200);
    const d2 = (await request(srv).get(`/v1/platform/companies/${created.id}`)
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(d2.setup.hasBranding).toBe(true);

    // activate with plan → allowed
    await request(srv).patch(`/v1/platform/companies/${created.id}/status`)
      .set('Authorization', `Bearer ${platTok}`).send({ status: 'active' }).expect(200);

    // a plan-less tenant cannot be activated
    const bare = await prisma.tenant.create({ data: { slug: 'bare-co', name: 'Bare', status: 'setup_needed' } });
    await request(srv).patch(`/v1/platform/companies/${bare.id}/status`)
      .set('Authorization', `Bearer ${platTok}`).send({ status: 'active' }).expect(400);
  });
```

- [ ] **Step 2: Run test to verify it fails.** Command: `pnpm --filter @refearn/api test:int -- -t "item 2: createCompany lands"`. Expected: fails — new tenants are `active`, no `setup` block, no branding route.

- [ ] **Step 3: Write minimal implementation.**

In `platform.service.ts` `createCompany` `tx.tenant.create` (line 159), add `status`:

```ts
      const tenant = await tx.tenant.create({
        data: {
          slug,
          name: input.name,
          currency: input.currency,
          timezone: input.timezone,
          maturationRule: 'on_delivery',
          payoutMinCents: 100_000n,
          status: TenantStatus.setup_needed,
        },
      });
```

In `company()` (lines 82–101), add a `setup` block. Insert before `return {` a computed value, and add `hasBranding`/`setup` to the returned object:

```ts
    const branding = (t.branding ?? {}) as { logoUrl?: string; primaryHex?: string; accentHex?: string };
    const hasBranding = !!(branding.logoUrl || branding.primaryHex || branding.accentHex);
    const owner = await this.prisma.membership.findFirst({
      where: { tenantId: id, role: Role.tenant_owner },
      include: { user: { select: { emailVerifiedAt: true } } },
    });
```

Then add to the return object (after `plan: ...`):

```ts
      setup: {
        hasPlan: plan !== null,
        hasBranding,
        hasOwnerAccepted: owner?.user.emailVerifiedAt !== null && owner !== null,
        memberCount: members,
      },
```

Add a `setBranding` method to `PlatformService`:

```ts
  /** Item 2: tenant.branding JSON'unu ayarla (sanitize edilmis hex/URL). Audit'li. */
  async setBranding(
    actorUserId: string,
    id: string,
    input: { logoUrl?: string | null; primaryHex?: string | null; accentHex?: string | null },
  ) {
    const t = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true, branding: true } });
    if (!t) throw new NotFoundException('sirket bulunamadi');
    const branding = {
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      ...(input.primaryHex !== undefined ? { primaryHex: input.primaryHex } : {}),
      ...(input.accentHex !== undefined ? { accentHex: input.accentHex } : {}),
    };
    await this.prisma.tenant.update({ where: { id }, data: { branding: branding as Prisma.InputJsonValue } });
    await this.prisma.auditLog.create({
      data: { tenantId: id, actorUserId, action: 'platform.tenant_branding', entity: 'tenant', entityId: id, after: branding as Prisma.InputJsonValue },
    });
    return { id, branding };
  }
```

Update `setStatus` (line 108) to block activating a plan-less tenant — insert after the `if (!t) throw` line:

```ts
    if (status === TenantStatus.active) {
      const plan = await this.prisma.commissionPlan.findFirst({ where: { tenantId: id, effectiveFrom: { lte: new Date() } }, select: { id: true } });
      if (!plan) throw new BadRequestException('plansiz sirket aktive edilemez');
    }
```

Add `BadRequestException` to the `@nestjs/common` import and `Role` to the `@prisma/client` import in `platform.service.ts` (both already imported partially — confirm `Role` is present; `BadRequestException` must be added).

In `platform.types.ts`, add:

```ts
/** Item 2: sirket branding (yalniz #hex ve https URL). */
const HEX = /^#[0-9a-fA-F]{6}$/;
export const brandingSchema = z.object({
  logoUrl: z.string().trim().url().startsWith('https://').max(500).optional().nullable(),
  primaryHex: z.string().trim().regex(HEX, 'gecersiz hex').optional().nullable(),
  accentHex: z.string().trim().regex(HEX, 'gecersiz hex').optional().nullable(),
});
export type BrandingInput = z.infer<typeof brandingSchema>;
```

In `platform.controller.ts`, add the route (and import `brandingSchema, BrandingInput`):

```ts
  @Put('companies/:id/branding')
  setBranding(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(brandingSchema)) body: BrandingInput,
  ) {
    return this.platform.setBranding(user.sub, id, body);
  }
```

- [ ] **Step 4: Run test to verify it passes.** Command: `pnpm --filter @refearn/api test:int -- -t "item 2: createCompany lands"`. Expected: 1 passing. Then `pnpm --filter @refearn/api lint`. Expected: clean.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "platform: new tenants setup_needed, branding endpoint, setup checklist + activate gate (item 2)"`

---

### Task 4: Paginated per-company members + payouts endpoints (spec item 3, backend for tabs)

**Files:**
- Modify: `apps/api/src/platform/platform.service.ts` (add `members`, `payouts`)
- Modify: `apps/api/src/platform/platform.controller.ts` (add two GET routes)
- Modify: `apps/api/src/platform/platform.types.ts` (add `pageQuerySchema`)
- Test: `apps/api/test/platform.int-spec.ts`

- [ ] **Step 1: Write the failing test.**

```ts
  it('item 3: members + payouts endpoints are tenant-scoped and paginate', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-tab@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    const tA = await createTenant(prisma);
    const tB = await createTenant(prisma);
    const chainA = await createChain(prisma, tA.id, 3);
    await createChain(prisma, tB.id, 2);
    await prisma.payout.create({ data: { tenantId: tA.id, membershipId: chainA[0].id, totalCents: 1000n, period: '2026-07' } });

    const members = (await request(srv).get(`/v1/platform/companies/${tA.id}/members?page=1&pageSize=2`)
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(members.total).toBe(3);
    expect(members.rows).toHaveLength(2);
    expect(members.rows.every((r: { tenantId: string }) => r.tenantId === undefined || r.tenantId === tA.id)).toBe(true);

    const payouts = (await request(srv).get(`/v1/platform/companies/${tA.id}/payouts`)
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(payouts.total).toBe(1);
    expect(payouts.rows[0].totalCents).toBe('1000');
  });
```

- [ ] **Step 2: Run test to verify it fails.** Command: `pnpm --filter @refearn/api test:int -- -t "item 3: members"`. Expected: 404 (routes do not exist).

- [ ] **Step 3: Write minimal implementation.**

In `platform.types.ts`, add:

```ts
/** Item 3/6: basit sayfalama query. */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;
```

In `platform.service.ts`, add:

```ts
  /** Item 3: tenant uye listesi (flat, sayfali). where: { tenantId } — capraz-kiraci sizinti yok. */
  async members(id: string, q: { page: number; pageSize: number }) {
    const exists = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('sirket bulunamadi');
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.membership.count({ where: { tenantId: id } }),
      this.prisma.membership.findMany({
        where: { tenantId: id },
        orderBy: [{ depth: 'asc' }, { joinedAt: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { user: { select: { fullName: true, email: true } } },
      }),
    ]);
    return {
      total, page: q.page, pageSize: q.pageSize,
      rows: rows.map((m) => ({
        id: m.id, fullName: m.user.fullName, email: m.user.email,
        referralCode: m.referralCode, role: m.role, status: m.status, depth: m.depth, joinedAt: m.joinedAt,
      })),
    };
  }

  /** Item 3: tenant payout listesi (salt-okunur, sayfali). where: { tenantId }. */
  async payouts(id: string, q: { page: number; pageSize: number }) {
    const exists = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('sirket bulunamadi');
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.payout.count({ where: { tenantId: id } }),
      this.prisma.payout.findMany({
        where: { tenantId: id },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { membership: { select: { referralCode: true, user: { select: { fullName: true } } } } },
      }),
    ]);
    return {
      total, page: q.page, pageSize: q.pageSize,
      rows: rows.map((p) => ({
        id: p.id, memberName: p.membership.user.fullName, referralCode: p.membership.referralCode,
        totalCents: p.totalCents.toString(), method: p.method, status: p.status, period: p.period,
        createdAt: p.createdAt, paidAt: p.paidAt,
      })),
    };
  }
```

In `platform.controller.ts`, add (import `pageQuerySchema, PageQuery`):

```ts
  @Get('companies/:id/members')
  members(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(pageQuerySchema)) q: PageQuery) {
    return this.platform.members(id, q);
  }

  @Get('companies/:id/payouts')
  payouts(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(pageQuerySchema)) q: PageQuery) {
    return this.platform.payouts(id, q);
  }
```

- [ ] **Step 4: Run test to verify it passes.** Command: `pnpm --filter @refearn/api test:int -- -t "item 3: members"`. Expected: 1 passing. Then `pnpm --filter @refearn/api lint`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "platform: paginated per-company members + payouts endpoints (item 3)"`

---

### Task 5: Overview dashboard + needs-attention queue endpoint (spec item 1, backend)

**Files:**
- Modify: `apps/api/src/platform/platform.service.ts` (add `overview`)
- Modify: `apps/api/src/platform/platform.controller.ts` (add `GET overview`; inject `BillingService` already present)
- Test: `apps/api/test/platform.int-spec.ts`

- [ ] **Step 1: Write the failing test.**

```ts
  it('item 1: overview surfaces each needs-attention kind exactly once; suspended excluded from no-member/no-plan', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-ov@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    // no members (active, no memberships, no plan) — surfaces no-members AND no-plan
    const noMembers = await createTenant(prisma);
    // no plan but has members
    const noPlan = await createTenant(prisma);
    await createChain(prisma, noPlan.id, 1);
    // stuck payout (4 days old, requested)
    const stuck = await createTenant(prisma);
    const sc = await createChain(prisma, stuck.id, 1);
    await createPlan(prisma, stuck.id);
    const oldPayout = await prisma.payout.create({ data: { tenantId: stuck.id, membershipId: sc[0].id, totalCents: 1n, period: '2026-07', status: 'requested' } });
    await prisma.payout.update({ where: { id: oldPayout.id }, data: { createdAt: new Date(Date.now() - 4 * 86_400_000) } });
    // suspended → must NOT appear for no-member/no-plan
    const suspended = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: suspended.id }, data: { status: 'suspended' } });

    const ov = (await request(srv).get('/v1/platform/overview').set('Authorization', `Bearer ${platTok}`).expect(200)).body;

    expect(ov.kpis.companies).toBeGreaterThanOrEqual(4);
    const kinds = (id: string) => ov.needsAttention.filter((r: { tenantId: string }) => r.tenantId === id).map((r: { kind: string }) => r.kind).sort();
    expect(kinds(noMembers.id)).toEqual(['no_members', 'no_plan']);
    expect(kinds(stuck.id)).toContain('stuck_payout');
    expect(ov.needsAttention.find((r: { kind: string; severity: string }) => r.kind === 'stuck_payout').severity).toBe('high');
    expect(kinds(suspended.id)).not.toContain('no_members');
    expect(kinds(suspended.id)).not.toContain('no_plan');
  });
```

- [ ] **Step 2: Run test to verify it fails.** Command: `pnpm --filter @refearn/api test:int -- -t "item 1: overview"`. Expected: 404 (`/platform/overview` missing).

- [ ] **Step 3: Write minimal implementation.**

In `platform.service.ts`, add (`overview` delegates to `BillingService` for AR — inject it):

Add `BillingService` to the constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}
```

Add the import `import { BillingService } from './billing.service';` and add the method:

```ts
  /**
   * Item 1: komuta-merkezi ozeti — KPI'lar + "ilgi bekleyenler" kuyrugu (her satir ucuz set sorgusu).
   * Askidaki tenant'lar no-member/no-plan gurultusune girmez (bilincli kapali).
   */
  async overview() {
    const now = new Date();
    const notSuspended = { status: { not: TenantStatus.suspended } as const };

    const [companies, active, suspended, memberCount, revRows, ar, tenants, membershipGroups, planGroups, stuckGroups, setupTenants] =
      await Promise.all([
        this.prisma.tenant.count(),
        this.prisma.tenant.count({ where: { status: TenantStatus.active } }),
        this.prisma.tenant.count({ where: { status: TenantStatus.suspended } }),
        this.prisma.membership.count(),
        this.prisma.sale.groupBy({ by: ['tenantId', 'summaryMonth'], where: { status: SaleStatus.approved }, _sum: { amountCents: true } }),
        this.billing.overview(),
        this.prisma.tenant.findMany({ where: notSuspended, select: { id: true, name: true, timezone: true } }),
        this.prisma.membership.groupBy({ by: ['tenantId'], _count: { _all: true } }),
        this.prisma.commissionPlan.findMany({ where: { effectiveFrom: { lte: now } }, distinct: ['tenantId'], select: { tenantId: true } }),
        this.prisma.payout.groupBy({
          by: ['tenantId'],
          where: { status: { in: [PayoutStatus.requested, PayoutStatus.processing] }, createdAt: { lt: new Date(now.getTime() - 72 * 3_600_000) } },
          _count: { _all: true },
        }),
        this.prisma.tenant.findMany({ where: { status: TenantStatus.setup_needed }, select: { id: true, name: true } }),
      ]);

    // platform revenue this month = sum of each tenant's own-tz current month
    let platformRevenue = 0n;
    for (const t of tenants) {
      const month = monthKey(now, t.timezone);
      const row = revRows.find((r) => r.tenantId === t.id && r.summaryMonth === month);
      platformRevenue += row?._sum.amountCents ?? 0n;
    }

    const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
    const withMembers = new Set(membershipGroups.filter((g) => g._count._all > 0).map((g) => g.tenantId));
    const withPlan = new Set(planGroups.map((g) => g.tenantId));
    const stuck = new Set(stuckGroups.map((g) => g.tenantId));

    type Row = { tenantId: string; tenantName: string; kind: string; severity: 'high' | 'warn'; detail: string; ctaHref: string };
    const rows: Row[] = [];
    const push = (id: string, kind: string, severity: 'high' | 'warn', detail: string, tab: string) =>
      rows.push({ tenantId: id, tenantName: nameOf.get(id) ?? id, kind, severity, detail, ctaHref: `/platform/companies/${id}?tab=${tab}` });

    for (const t of tenants) {
      if (!withMembers.has(t.id)) push(t.id, 'no_members', 'warn', 'No members yet', 'users');
      if (!withPlan.has(t.id)) push(t.id, 'no_plan', 'warn', 'No active plan', 'plans');
      if (stuck.has(t.id)) push(t.id, 'stuck_payout', 'high', 'Payout stuck > 72h', 'payouts');
    }
    for (const s of setupTenants) push(s.id, 'setup_incomplete', 'warn', 'Setup incomplete', 'overview');
    for (const inv of ar.invoices as Array<{ tenantId: string; overdue: boolean }>) {
      if (inv.overdue) push(inv.tenantId, 'overdue_billing', 'high', 'Overdue invoice', 'settings');
    }
    // dedupe by (tenantId, kind)
    const seen = new Set<string>();
    const needsAttention = rows.filter((r) => { const k = `${r.tenantId}:${r.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });

    return {
      kpis: {
        companies, active, suspended, members: memberCount,
        platformRevenueThisMonthCents: platformRevenue.toString(),
        ar: ar.totals,
      },
      needsAttention,
    };
  }
```

Add `PayoutStatus` to the `@prisma/client` import in `platform.service.ts`.

In `platform.controller.ts`, add:

```ts
  @Get('overview')
  overview() {
    return this.platform.overview();
  }
```

- [ ] **Step 4: Run test to verify it passes.** Command: `pnpm --filter @refearn/api test:int -- -t "item 1: overview"`. Expected: 1 passing. Then `pnpm --filter @refearn/api lint`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "platform: overview dashboard + needs-attention queue endpoint (item 1)"`

---

### Task 6: Safe platform impersonation endpoint (spec item 4, backend)

**Files:**
- Modify: `apps/api/src/platform/platform.module.ts` (import `JwtModule`)
- Modify: `apps/api/src/platform/platform.service.ts` (inject `JwtService`; add `impersonate`, `impersonateEnd`)
- Modify: `apps/api/src/platform/platform.controller.ts` (add two POST routes)
- Test: `apps/api/test/platform.int-spec.ts`

> **Depends on: the safe-impersonation security decision (spec item 4 — CONFIRMED recommendation).** Ship **read-only owner-view**: mint a token with `{ sub: platformAdminUserId, mid: ownerMembershipId, tid, role: tenant_owner, imp: platformAdminUserId }`. The guard already blocks all non-GET when `imp` is set ([`auth.guard.ts:106`](apps/api/src/auth/auth.guard.ts)) — read-only by construction, zero guard changes. Do **not** embed `perms` (owner is god-mode in-guard). Suspended tenant rejects; `setup_needed` allowed.

- [ ] **Step 1: Write the failing test.**

```ts
  it('item 4: platform admin with NO membership impersonates owner (GET ok, POST 403); suspended rejected; audits land', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-imp@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    const tenant = await createTenant(prisma);
    const [owner] = await createChain(prisma, tenant.id, 1);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: 'tenant_owner' } });

    const res = (await request(srv).post(`/v1/platform/companies/${tenant.id}/impersonate`)
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(res.accessToken).toBeTruthy();
    const claims = JSON.parse(Buffer.from(res.accessToken.split('.')[1], 'base64').toString());
    expect(claims.imp).toBe(platformUser.id);
    expect(claims.mid).toBe(owner.id);
    expect(claims.role).toBe('tenant_owner');

    // GET works, POST 403 (read-only by construction)
    await request(srv).get('/v1/app/dashboard').set('Authorization', `Bearer ${res.accessToken}`).expect(200);
    await request(srv).post('/v1/app/sales').set('Authorization', `Bearer ${res.accessToken}`).send({ amountCents: 1 }).expect(403);

    // start + end audit rows in tenant chain
    await request(srv).post(`/v1/platform/companies/${tenant.id}/impersonate/end`).set('Authorization', `Bearer ${platTok}`).expect(200);
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id, action: 'security.platform_impersonate_start' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id, action: 'security.platform_impersonate_end' } })).toBe(1);

    // suspended tenant rejected
    const susp = await createTenant(prisma);
    const [so] = await createChain(prisma, susp.id, 1);
    await prisma.membership.update({ where: { id: so.id }, data: { role: 'tenant_owner' } });
    await prisma.tenant.update({ where: { id: susp.id }, data: { status: 'suspended' } });
    await request(srv).post(`/v1/platform/companies/${susp.id}/impersonate`).set('Authorization', `Bearer ${platTok}`).expect(400);
  });
```

- [ ] **Step 2: Run test to verify it fails.** Command: `pnpm --filter @refearn/api test:int -- -t "item 4: platform admin"`. Expected: 404 (routes missing).

- [ ] **Step 3: Write minimal implementation.**

In `platform.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BillingService } from './billing.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [PlatformController],
  providers: [PlatformService, BillingService],
})
export class PlatformModule {}
```

In `platform.service.ts`, inject `JwtService` in the constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly jwt: JwtService,
  ) {}
```

Add imports `import { JwtService } from '@nestjs/jwt';`, `import { authConfig } from '../auth/auth.config';`, `import { AccessTokenPayload } from '../auth/auth.types';`. Add the methods:

```ts
  /**
   * Item 4: platform-kapsamli impersonation — tenant OWNER'i olarak kisa-omurlu salt-okunur token
   * mint eder (uyelik GEREKTIRMEZ). imp=platformAdminUserId → guard GET disi her seyi bloklar.
   * Suspended tenant reddedilir; setup_needed izinli.
   */
  async impersonate(platformAdminUserId: string, id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id }, select: { status: true } });
    if (!t) throw new NotFoundException('sirket bulunamadi');
    if (t.status === TenantStatus.suspended) throw new BadRequestException('askidaki sirkete girilemez');
    const owner = await this.prisma.membership.findFirst({
      where: { tenantId: id, role: Role.tenant_owner, status: MembershipStatus.active },
      select: { id: true },
    });
    if (!owner) throw new NotFoundException('sirketin aktif owner uyeligi yok');

    const payload: AccessTokenPayload = {
      sub: platformAdminUserId, mid: owner.id, tid: id, role: Role.tenant_owner, imp: platformAdminUserId,
    };
    const accessToken = await this.jwt.signAsync(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
    await this.prisma.auditLog.create({
      data: { tenantId: id, actorUserId: platformAdminUserId, action: 'security.platform_impersonate_start', entity: 'security', entityId: owner.id, after: { ownerMembershipId: owner.id } },
    });
    return { accessToken, membershipId: owner.id };
  }

  /** Item 4: impersonation bitti — platform admin'in normal tokeniyle, yalniz audit. */
  async impersonateEnd(platformAdminUserId: string, id: string) {
    await this.prisma.auditLog.create({
      data: { tenantId: id, actorUserId: platformAdminUserId, action: 'security.platform_impersonate_end', entity: 'security', entityId: id, after: {} },
    });
    return { ended: true };
  }
```

Ensure `MembershipStatus` is imported (already imported at line 2). In `platform.controller.ts`:

```ts
  @HttpCode(200)
  @Post('companies/:id/impersonate')
  impersonate(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.impersonate(user.sub, id);
  }

  @HttpCode(200)
  @Post('companies/:id/impersonate/end')
  impersonateEnd(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.impersonateEnd(user.sub, id);
  }
```

- [ ] **Step 4: Run test to verify it passes.** Command: `pnpm --filter @refearn/api test:int -- -t "item 4: platform admin"`. Expected: 1 passing. Then `pnpm --filter @refearn/api lint`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "platform: safe read-only owner impersonation endpoint (item 4)"`

---

### Task 7: Platform audit viewer — per-tenant + global feed (spec item 6, backend)

**Files:**
- Modify: `apps/api/src/platform/platform.service.ts` (add `companyAudit`, `globalAudit`, private `resolveActors`)
- Modify: `apps/api/src/platform/platform.controller.ts` (add two GET routes)
- Modify: `apps/api/src/platform/platform.types.ts` (add `auditQuerySchema`)
- Test: `apps/api/test/platform.int-spec.ts`

- [ ] **Step 1: Write the failing test.**

```ts
  it('item 6: per-tenant + global audit viewer with action filter and actor resolution', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-au@test.refearn.local', passwordHash: 'x', fullName: 'Platform Admin', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    const tA = await createTenant(prisma);
    const tB = await createTenant(prisma);
    // suspend tA (writes platform.tenant_suspended) + billing on tB
    await request(srv).patch(`/v1/platform/companies/${tA.id}/status`).set('Authorization', `Bearer ${platTok}`).send({ status: 'suspended' }).expect(200);
    await request(srv).put(`/v1/platform/companies/${tB.id}/billing`).set('Authorization', `Bearer ${platTok}`).send({ monthlyFeeCents: 5000, active: true }).expect(200);
    const inv = (await request(srv).post(`/v1/platform/companies/${tB.id}/invoices`).set('Authorization', `Bearer ${platTok}`).send({ period: '2026-06' }).expect(200)).body;
    await request(srv).post(`/v1/platform/invoices/${inv.id}/paid`).set('Authorization', `Bearer ${platTok}`).expect(200);

    // per-tenant feed for tA
    const a = (await request(srv).get(`/v1/platform/companies/${tA.id}/audit`).set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(a.items.some((r: { action: string; actorName: string }) => r.action === 'platform.tenant_suspended' && r.actorName === 'Platform Admin')).toBe(true);

    // global feed: rows from multiple tenants + tenantName
    const g = (await request(srv).get('/v1/platform/audit?pageSize=100').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    const tenantIds = new Set(g.items.map((r: { tenantId: string }) => r.tenantId));
    expect(tenantIds.has(tA.id) && tenantIds.has(tB.id)).toBe(true);
    expect(g.items[0]).toHaveProperty('tenantName');

    // filter by action
    const paid = (await request(srv).get('/v1/platform/audit?action=billing.invoice_paid&pageSize=100').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(paid.items.length).toBe(1);
    expect(paid.items[0].action).toBe('billing.invoice_paid');

    // tenant_admin token 403 on global feed
    const owner = await prisma.user.create({ data: { email: 'ow6@test.refearn.local', passwordHash: 'x', fullName: 'O' } });
    const m = await prisma.membership.create({ data: { tenantId: tB.id, userId: owner.id, role: 'tenant_owner', referralCode: 'OW6', path: 'x', depth: 0 } });
    const ownerTok = token({ sub: owner.id, mid: m.id, tid: tB.id, role: 'tenant_owner' });
    await request(srv).get('/v1/platform/audit').set('Authorization', `Bearer ${ownerTok}`).expect(403);
  });
```

- [ ] **Step 2: Run test to verify it fails.** Command: `pnpm --filter @refearn/api test:int -- -t "item 6: per-tenant"`. Expected: 404 (routes missing).

- [ ] **Step 3: Write minimal implementation.**

In `platform.types.ts`, add:

```ts
/** Item 6: platform audit filtre + sayfalama. */
export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().trim().max(64).optional(),
  entity: z.string().trim().max(40).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
```

In `platform.service.ts`, add a private actor resolver and the two methods:

```ts
  /** actorUserId → { name, email } (batch; null = 'system'). reports.service.resolveActors ile ayni kalip. */
  private async resolveActors(actorIds: Array<string | null>) {
    const ids = [...new Set(actorIds.filter((v): v is string => !!v))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } }) : [];
    const map = new Map(users.map((u) => [u.id, u]));
    return (id: string | null) => (id ? { name: map.get(id)?.fullName ?? id.slice(0, 8), email: map.get(id)?.email ?? null } : { name: 'system', email: null as string | null });
  }

  private auditWhere(q: { action?: string; entity?: string }): Prisma.AuditLogWhereInput {
    return { ...(q.action ? { action: q.action } : {}), ...(q.entity ? { entity: q.entity } : {}) };
  }

  /** Item 6: tek tenant audit (seq desc, sayfali). where: { tenantId }. */
  async companyAudit(id: string, q: { page: number; pageSize: number; action?: string; entity?: string }) {
    const exists = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('sirket bulunamadi');
    const where = { tenantId: id, ...this.auditWhere(q) };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { seq: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const actorOf = await this.resolveActors(rows.map((a) => a.actorUserId));
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map((a) => this.auditRow(a, actorOf)) };
  }

  /** Item 6: GLOBAL platform audit (capraz-kiraci — yaptirimli okuma). tenant adi join. */
  async globalAudit(q: { page: number; pageSize: number; action?: string; entity?: string }) {
    const where = this.auditWhere(q);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { seq: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const actorOf = await this.resolveActors(rows.map((a) => a.actorUserId));
    const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter((v): v is string => !!v))];
    const tenants = tenantIds.length ? await this.prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }) : [];
    const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map((a) => ({ ...this.auditRow(a, actorOf), tenantName: a.tenantId ? nameOf.get(a.tenantId) ?? null : null })) };
  }

  private auditRow(a: { id: string; tenantId: string | null; action: string; entity: string; entityId: string | null; actorUserId: string | null; before: unknown; after: unknown; seq: bigint; createdAt: Date }, actorOf: (id: string | null) => { name: string; email: string | null }) {
    const actor = actorOf(a.actorUserId);
    return {
      seq: a.seq.toString(), tenantId: a.tenantId, action: a.action, entity: a.entity, entityId: a.entityId,
      actorUserId: a.actorUserId, actorName: actor.name, actorEmail: actor.email,
      before: a.before, after: a.after, createdAt: a.createdAt,
    };
  }
```

In `platform.controller.ts`, add (import `auditQuerySchema, AuditQuery`):

```ts
  @Get('companies/:id/audit')
  companyAudit(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(auditQuerySchema)) q: AuditQuery) {
    return this.platform.companyAudit(id, q);
  }

  @Get('audit')
  globalAudit(@Query(new ZodValidationPipe(auditQuerySchema)) q: AuditQuery) {
    return this.platform.globalAudit(q);
  }
```

- [ ] **Step 4: Run test to verify it passes.** Command: `pnpm --filter @refearn/api test:int -- -t "item 6: per-tenant"`. Expected: 1 passing. Then `pnpm --filter @refearn/api lint`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "platform: per-tenant + global audit viewer endpoints (item 6)"`

---

### Task 8: Global cross-tenant search endpoint (spec item 5, backend)

**Files:**
- Modify: `apps/api/src/platform/platform.service.ts` (add `search`)
- Modify: `apps/api/src/platform/platform.controller.ts` (add `GET search`)
- Modify: `apps/api/src/platform/platform.types.ts` (add `searchQuerySchema`)
- Test: `apps/api/test/platform.int-spec.ts`

- [ ] **Step 1: Write the failing test.**

```ts
  it('item 5: cross-tenant search finds users by email + members by referral code; q<2 empty; tenant_admin 403', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-se@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    const tA = await createTenant(prisma);
    const target = await prisma.user.create({ data: { email: 'findme@acme.co', passwordHash: 'x', fullName: 'Find Me' } });
    const mem = await prisma.membership.create({ data: { tenantId: tA.id, userId: target.id, role: 'member', referralCode: 'GOLD99', path: 'x', depth: 0 } });

    const byEmail = (await request(srv).get('/v1/platform/search?q=findme').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(byEmail.users.some((u: { email: string }) => u.email === 'findme@acme.co')).toBe(true);

    // referral code case-insensitive
    const byCode = (await request(srv).get('/v1/platform/search?q=gold99').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(byCode.members.some((m: { referralCode: string; tenantId: string }) => m.referralCode === 'GOLD99' && m.tenantId === tA.id)).toBe(true);

    // q < 2 → all empty
    const short = (await request(srv).get('/v1/platform/search?q=a').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(short.users).toHaveLength(0);
    expect(short.members).toHaveLength(0);

    // tenant_admin 403
    const admin = await prisma.user.create({ data: { email: 'ad5@test.refearn.local', passwordHash: 'x', fullName: 'A' } });
    const am = await prisma.membership.create({ data: { tenantId: tA.id, userId: admin.id, role: 'tenant_admin', referralCode: 'AD5', path: 'y', depth: 0 } });
    const adminTok = token({ sub: admin.id, mid: am.id, tid: tA.id, role: 'tenant_admin' });
    await request(srv).get('/v1/platform/search?q=findme').set('Authorization', `Bearer ${adminTok}`).expect(403);
    void mem;
  });
```

- [ ] **Step 2: Run test to verify it fails.** Command: `pnpm --filter @refearn/api test:int -- -t "item 5: cross-tenant"`. Expected: 404.

- [ ] **Step 3: Write minimal implementation.**

In `platform.types.ts`, add:

```ts
/** Item 5: capraz-kiraci arama (min 2 char). */
export const searchQuerySchema = z.object({ q: z.string().trim().max(80).default('') });
export type SearchQuery = z.infer<typeof searchQuerySchema>;
```

In `platform.service.ts`, add:

```ts
  /**
   * Item 5: yaptirimli capraz-kiraci arama. q<2 → bos. Her kategori 10 satirla sinirli.
   * PII (e-posta) doner — yalniz @PlatformAdmin(); global throttler ile korunur.
   */
  async search(q: string) {
    const term = q.trim();
    const empty = { users: [], members: [], sales: [], payouts: [] };
    if (term.length < 2) return empty;
    const codeNeedle = term.toUpperCase();

    const [users, members, sales, payouts] = await Promise.all([
      this.prisma.user.findMany({
        where: { OR: [{ email: { contains: term, mode: 'insensitive' } }, { fullName: { contains: term, mode: 'insensitive' } }] },
        take: 10,
        select: { id: true, email: true, fullName: true, memberships: { select: { tenantId: true, tenant: { select: { name: true } } } } },
      }),
      this.prisma.membership.findMany({
        where: { referralCode: { contains: codeNeedle } },
        include: { user: { select: { fullName: true, email: true } }, tenant: { select: { name: true } } },
        take: 10,
      }),
      this.prisma.sale.findMany({
        where: { OR: [{ externalRef: { contains: term } }, { customerRef: { contains: term, mode: 'insensitive' } }] },
        include: { tenant: { select: { name: true } } },
        take: 10,
      }),
      this.prisma.payout.findMany({
        where: { OR: [{ ref: { contains: term } }, ...(/^\d+$/.test(term) ? [{ checkNumber: Number(term) }] : [])] },
        include: { tenant: { select: { name: true } } },
        take: 10,
      }),
    ]);

    return {
      users: users.map((u) => ({
        userId: u.id, email: u.email, fullName: u.fullName,
        tenants: u.memberships.map((m) => ({ tenantId: m.tenantId, tenantName: m.tenant.name })),
      })),
      members: members.map((m) => ({
        membershipId: m.id, referralCode: m.referralCode, fullName: m.user.fullName, email: m.user.email,
        tenantId: m.tenantId, tenantName: m.tenant.name, ctaHref: `/platform/companies/${m.tenantId}?tab=users`,
      })),
      sales: sales.map((s) => ({
        saleId: s.id, amountCents: s.amountCents.toString(), externalRef: s.externalRef, status: s.status,
        tenantId: s.tenantId, tenantName: s.tenant.name, ctaHref: `/platform/companies/${s.tenantId}?tab=overview`,
      })),
      payouts: payouts.map((p) => ({
        payoutId: p.id, totalCents: p.totalCents.toString(), ref: p.ref, checkNumber: p.checkNumber, status: p.status,
        tenantId: p.tenantId, tenantName: p.tenant.name, ctaHref: `/platform/companies/${p.tenantId}?tab=payouts`,
      })),
    };
  }
```

In `platform.controller.ts`, add (import `searchQuerySchema, SearchQuery`):

```ts
  @Get('search')
  search(@Query(new ZodValidationPipe(searchQuerySchema)) q: SearchQuery) {
    return this.platform.search(q.q);
  }
```

- [ ] **Step 4: Run test to verify it passes.** Command: `pnpm --filter @refearn/api test:int -- -t "item 5: cross-tenant"`. Expected: 1 passing. Then `pnpm --filter @refearn/api lint`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "platform: global cross-tenant search endpoint (item 5)"`

---

### Task 9: System health panel — wire scheduler + backups (spec item 7, backend)

**Files:**
- Modify: `apps/api/src/scheduler/scheduler.service.ts` (add `jobHealthWithStaleness()`)
- Modify: `apps/api/src/scheduler/scheduler.module.ts` (`exports: [SchedulerService]`)
- Modify: `apps/api/prisma/schema.prisma` (add `SystemStatus` model)
- Create: `apps/api/prisma/migrations/20260709103000_system_status/migration.sql`
- Modify: `apps/api/src/platform/platform.module.ts` (conditionally import `SchedulerService`)
- Modify: `apps/api/src/platform/platform.service.ts` (add `health()`)
- Modify: `apps/api/src/platform/platform.controller.ts` (add `GET health`)
- Test: `apps/api/test/platform.int-spec.ts` + unit spec `apps/api/src/scheduler/scheduler.staleness.spec.ts`

> **Depends on: the backups security decision (spec item 7 — CONFIRMED recommendation).** Use a **1-row `SystemStatus` table** (`lastBackupAt`) so the panel reads `lastBackupAt` without shelling out. The backup script's post-hook writes it (script wiring is out of scope for this backend task; the endpoint reads the row, defaulting to `null` = "no backup recorded"). Never expose secrets/paths.
>
> **Note (test wiring):** `SchedulerModule` is disabled under `NODE_ENV=test` ([`app.module.ts:55`](apps/api/src/app.module.ts)). So `PlatformModule` must inject `SchedulerService` **optionally** (`@Optional()`), and `health()` returns an empty `jobs: []` when the scheduler is absent (process-local, resets on restart — matches spec's "no runs since restart" note). The integration test asserts `db:true`, `jobs` is an array, and `backups` present; the unit test covers the staleness flag directly.

- [ ] **Step 1: Write the failing tests.**

Unit test — create `apps/api/src/scheduler/scheduler.staleness.spec.ts`:

```ts
import { SchedulerService } from './scheduler.service';

describe('jobHealthWithStaleness (unit)', () => {
  it('flags a job whose lastRun exceeds its FRESHNESS_MS', () => {
    const svc = Object.create(SchedulerService.prototype) as SchedulerService;
    // @ts-expect-error private map access for the test
    svc.lastRun = new Map([['mature-commissions', { at: new Date(Date.now() - 60 * 60_000), ok: true }]]);
    const rows = svc.jobHealthWithStaleness();
    const job = rows.find((r) => r.name === 'mature-commissions')!;
    expect(job.stale).toBe(true);
  });

  it('does not flag a fresh job', () => {
    const svc = Object.create(SchedulerService.prototype) as SchedulerService;
    // @ts-expect-error private map access for the test
    svc.lastRun = new Map([['mature-commissions', { at: new Date(), ok: true }]]);
    expect(svc.jobHealthWithStaleness()[0].stale).toBe(false);
  });
});
```

Integration test — add to `platform.int-spec.ts`:

```ts
  it('item 7: /platform/health returns db:true + jobs array + backups; tenant token 403', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-hl@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    const h = (await request(srv).get('/v1/platform/health').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(h.db).toBe(true);
    expect(Array.isArray(h.jobs)).toBe(true);
    expect(h).toHaveProperty('backups');

    const owner = await prisma.user.create({ data: { email: 'ow7@test.refearn.local', passwordHash: 'x', fullName: 'O' } });
    const tenant = await createTenant(prisma);
    const m = await prisma.membership.create({ data: { tenantId: tenant.id, userId: owner.id, role: 'tenant_owner', referralCode: 'OW7', path: 'x', depth: 0 } });
    const ownerTok = token({ sub: owner.id, mid: m.id, tid: tenant.id, role: 'tenant_owner' });
    await request(srv).get('/v1/platform/health').set('Authorization', `Bearer ${ownerTok}`).expect(403);
  });
```

- [ ] **Step 2: Run tests to verify they fail.** Commands: `pnpm --filter @refearn/api test -- -t "jobHealthWithStaleness"` (unit — method missing) and `pnpm --filter @refearn/api test:int -- -t "item 7"` (404). Expected: both fail.

- [ ] **Step 3: Write minimal implementation.**

In `scheduler.service.ts`, add after `jobHealth()` (line 98):

```ts
  /** Item 7: son-kosum sagligi + FRESHNESS_MS'e gore stale bayragi (health panel icin). */
  jobHealthWithStaleness(): Array<{ name: string; at: Date; ok: boolean; detail?: string; stale: boolean }> {
    const now = Date.now();
    return [...this.lastRun.entries()].map(([name, r]) => {
      const maxAge = SchedulerService.FRESHNESS_MS[name];
      return { name, at: r.at, ok: r.ok, detail: r.detail, stale: !!maxAge && now - r.at.getTime() > maxAge };
    });
  }
```

In `scheduler.module.ts`, add `exports: [SchedulerService]`.

In `schema.prisma`, add before the closing of the file:

```prisma
// Item 7: platform sistem durumu (tek satir). Backup script'i post-hook'ta lastBackupAt yazar.
model SystemStatus {
  id           String    @id @default("singleton")
  lastBackupAt DateTime? @map("last_backup_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  @@map("system_status")
}
```

Create `apps/api/prisma/migrations/20260709103000_system_status/migration.sql`:

```sql
-- Item 7: tek-satir sistem durumu (backup markeri).
CREATE TABLE "system_status" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "last_backup_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "system_status_pkey" PRIMARY KEY ("id")
);
```

In `platform.module.ts`, conditionally provide `SchedulerService` (it is undefined in test). Simplest: import `SchedulerModule` in `PlatformModule` only when not test, and inject with `@Optional()`. Since `PlatformModule` is always imported, use `@Optional()` injection and rely on `SchedulerModule`'s presence at runtime (imported in `AppModule`). Add:

```ts
import { forwardRef, Module } from '@nestjs/common';
// ... in imports array, guard with the same isTest gate used in app.module:
```

To avoid a circular import and keep tests green, inject `SchedulerService` with `@Optional()` in `PlatformService`:

```ts
import { Optional } from '@nestjs/common';
import { SchedulerService } from '../scheduler/scheduler.service';
// constructor:
    @Optional() private readonly scheduler?: SchedulerService,
```

And in `platform.module.ts`, add `SchedulerModule` to imports only outside test:

```ts
const isTest = process.env.NODE_ENV === 'test';
@Module({
  imports: [JwtModule.register({}), ...(isTest ? [] : [require('../scheduler/scheduler.module').SchedulerModule])],
  controllers: [PlatformController],
  providers: [PlatformService, BillingService],
})
```

(Use a static import + conditional spread if the codebase forbids `require`; the `isTest` spread mirrors `app.module.ts`.)

In `platform.service.ts`, add:

```ts
  /** Item 7: sistem paneli — DB ping + scheduler is sagligi + backup tazeligi. Sir/patika sizdirmaz. */
  async health() {
    let db = false;
    try { await this.prisma.$queryRaw`SELECT 1`; db = true; } catch { db = false; }
    const jobs = this.scheduler?.jobHealthWithStaleness() ?? [];
    const status = await this.prisma.systemStatus.findUnique({ where: { id: 'singleton' } }).catch(() => null);
    return { db, jobs, backups: { lastBackupAt: status?.lastBackupAt ?? null } };
  }
```

In `platform.controller.ts`, add:

```ts
  @Get('health')
  health() {
    return this.platform.health();
  }
```

Run migration: `pnpm --filter @refearn/api db:migrate`.

- [ ] **Step 4: Run tests to verify they pass.** Commands: `pnpm --filter @refearn/api test -- -t "jobHealthWithStaleness"` and `pnpm --filter @refearn/api test:int -- -t "item 7"`. Expected: all passing. Then `pnpm --filter @refearn/api lint`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "platform: system health endpoint wiring scheduler job staleness + backup marker (item 7)"`

---

### Task 10: Owner email invite + accept flow (spec item 8, backend)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (add `owner_invite` to `UserTokenPurpose`, lines 326–330)
- Create: `apps/api/prisma/migrations/20260709101000_owner_invite_token/migration.sql`
- Modify: `apps/api/src/platform/platform.service.ts` (`createCompany`: on new owner, mint `owner_invite` token + enqueue email instead of temp password)
- Modify: `apps/api/src/auth/auth.service.ts` (add `acceptOwnerInvite`)
- Modify: `apps/api/src/auth/auth.controller.ts` (public `POST accept-owner-invite`)
- Modify: `apps/api/src/auth/auth.types.ts` (add `acceptOwnerInviteSchema`)
- Test: `apps/api/test/platform.int-spec.ts`

> **Depends on: the owner-invite security decision (spec item 8 — CONFIRMED recommendation).** Reuse `UserToken` with a new `owner_invite` purpose (hashing/expiry/single-use already exist). Do **not** leak whether an email exists; existing-owner path issues no token (preserve `ownerExisting`). Email enqueue is outside the create transaction so delivery failure never rolls back tenant creation.

- [ ] **Step 1: Write the failing test.**

```ts
  it('item 8: new owner gets owner_invite token (no tempPassword); accept sets password + verifies; expired rejected; existing owner no token', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-inv@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    // new owner → no tempPassword, one owner_invite UserToken
    const created = (await request(srv).post('/v1/platform/companies').set('Authorization', `Bearer ${platTok}`)
      .send({ name: 'Invite Co', slug: 'invite-co', currency: 'USD', timezone: 'America/New_York', ownerEmail: 'newowner@inv.co', ownerName: 'New Owner' })
      .expect(201)).body;
    expect(created.tempPassword).toBeNull();
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: 'newowner@inv.co' } });
    const tok = await prisma.userToken.findFirst({ where: { userId: ownerUser.id, purpose: 'owner_invite' } });
    expect(tok).toBeTruthy();

    // accept: we need the raw token; capture it from the enqueued notification payload
    const notif = await prisma.notification.findFirst({ where: { template: 'owner_invite' }, orderBy: { createdAt: 'desc' } });
    const rawToken = (notif!.payload as { token: string }).token;
    const accepted = (await request(srv).post('/v1/auth/accept-owner-invite')
      .send({ token: rawToken, password: 'BrandNewPass123', fullName: 'New Owner' }).expect(200)).body;
    expect(accepted.accessToken).toBeTruthy();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ownerUser.id } })).emailVerifiedAt).not.toBeNull();

    // reuse rejected
    await request(srv).post('/v1/auth/accept-owner-invite').send({ token: rawToken, password: 'AnotherPass123' }).expect(400);

    // existing owner → no token
    await prisma.user.create({ data: { email: 'existing@inv.co', passwordHash: 'x', fullName: 'Existing' } });
    const c2 = (await request(srv).post('/v1/platform/companies').set('Authorization', `Bearer ${platTok}`)
      .send({ name: 'Second Co', slug: 'second-co', currency: 'USD', timezone: 'America/New_York', ownerEmail: 'existing@inv.co', ownerName: 'Existing' })
      .expect(201)).body;
    expect(c2.ownerExisting).toBe(true);
    const existingUser = await prisma.user.findUniqueOrThrow({ where: { email: 'existing@inv.co' } });
    expect(await prisma.userToken.count({ where: { userId: existingUser.id, purpose: 'owner_invite' } })).toBe(0);
  });
```

Add `user_tokens` and `notifications` to the `truncateAll` list — they are already present (`helpers.ts` line 17–21 includes both). No change needed.

- [ ] **Step 2: Run test to verify it fails.** Command: `pnpm --filter @refearn/api test:int -- -t "item 8"`. Expected: fails — `owner_invite` purpose does not exist; route missing; `tempPassword` still set for new owner.

- [ ] **Step 3: Write minimal implementation.**

In `schema.prisma`, extend `UserTokenPurpose` (lines 326–330):

```prisma
enum UserTokenPurpose {
  email_verify
  password_reset
  login_otp
  owner_invite
}
```

Create `apps/api/prisma/migrations/20260709101000_owner_invite_token/migration.sql`:

```sql
-- Item 8: platform owner davet tokeni (UserToken purpose, append-only).
ALTER TYPE "UserTokenPurpose" ADD VALUE IF NOT EXISTS 'owner_invite';
```

In `platform.service.ts` `createCompany`, replace the new-owner temp-password branch (lines 185–192) and return. Change the `if (!ownerUser)` block so that a **new** owner gets NO temp password; instead collect a flag to mint a token after the transaction:

```ts
      const existingUser = await tx.user.findUnique({ where: { email } });
      let ownerUser = existingUser;
      let isNewOwner = false;
      if (!ownerUser) {
        isNewOwner = true;
        // sifre henuz yok — accept-owner-invite ile kullanici belirler. Gecici rastgele hash (login'i engeller).
        ownerUser = await tx.user.create({
          data: { email, passwordHash: await hash(randomCode(24), ARGON2_OPTS), fullName: input.ownerName },
        });
      }
```

Remove `tempPassword` from the returned object of the transaction; return `isNewOwner` and `ownerUserId`:

```ts
      return { tenant, ownerExisting: !!existingUser, isNewOwner, ownerUserId: ownerUser.id, ownerMembershipId: ownerMembership.id };
```

After the `$transaction` closes, mint the invite token + enqueue email outside the tx (delivery failure must not roll back). Replace the final `return { ... }`:

```ts
    if (result.isNewOwner) {
      const raw = randomToken(32);
      await this.prisma.userToken.create({
        data: {
          userId: result.ownerUserId,
          purpose: UserTokenPurpose.owner_invite,
          tokenHash: sha256(raw),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      await this.prisma.notification.create({
        data: {
          tenantId: result.tenant.id,
          recipientMembershipId: result.ownerMembershipId,
          channel: NotificationChannel.email,
          template: 'owner_invite',
          payload: { token: raw, companyName: result.tenant.name },
        },
      });
    }

    return {
      id: result.tenant.id,
      slug: result.tenant.slug,
      name: result.tenant.name,
      ownerEmail: email,
      ownerExisting: result.ownerExisting,
      tempPassword: null, // item 8: gecici sifre yok — e-posta davet gonderilir
    };
```

Add imports to `platform.service.ts`: `UserTokenPurpose, NotificationChannel` from `@prisma/client`; `sha256, randomToken` from `../common/crypto` (confirm `randomToken` export exists — used by `auth.service.ts`). Keep `randomCode` (still used for temp password hash + referral codes).

In `auth.types.ts`, add:

```ts
export const acceptOwnerInviteSchema = z.object({
  token: z.string().min(16).max(256),
  password: z.string().min(10).max(128),
  fullName: z.string().trim().min(2).max(120).optional(),
});
export type AcceptOwnerInviteInput = z.infer<typeof acceptOwnerInviteSchema>;
```

In `auth.service.ts`, add (mirror `confirmPasswordReset` + issue a session via existing `issueSession`; return a full `AuthSession`):

```ts
  /** Item 8: owner davetini kabul et — sifre belirle, e-postayi dogrula, oturum dondur. */
  async acceptOwnerInvite(tokenRaw: string, password: string, meta: RequestMeta, fullName?: string): Promise<AuthSession> {
    const token = await this.prisma.userToken.findUnique({ where: { tokenHash: sha256(tokenRaw) } });
    if (!token || token.purpose !== UserTokenPurpose.owner_invite || token.usedAt || token.expiresAt < new Date()) {
      throw new BadRequestException('davet linki gecersiz veya suresi dolmus');
    }
    const passwordHash = await hash(password, ARGON2_OPTS);
    await this.prisma.$transaction([
      this.prisma.userToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash, emailVerifiedAt: new Date(), ...(fullName ? { fullName } : {}) },
      }),
    ]);
    return this.issueSession(token.userId, meta);
  }
```

Ensure `UserTokenPurpose` is imported in `auth.service.ts` (it already imports it for verify/reset flows).

In `auth.controller.ts`, add (import `acceptOwnerInviteSchema, AcceptOwnerInviteInput`):

```ts
  @HttpCode(200)
  @Post('accept-owner-invite')
  acceptOwnerInvite(@Body(new ZodValidationPipe(acceptOwnerInviteSchema)) body: AcceptOwnerInviteInput, @Req() req: Request) {
    return this.auth.acceptOwnerInvite(body.token, body.password, meta(req), body.fullName);
  }
```

Register the `owner_invite` email body in `apps/api/src/notifications/templates.ts` (add a case mapping `owner_invite` → subject/text using `payload.token` and `payload.companyName`) so the outbox drain does not throw on an unknown template.

Run migration: `pnpm --filter @refearn/api db:migrate`.

- [ ] **Step 4: Run test to verify it passes.** Command: `pnpm --filter @refearn/api test:int -- -t "item 8"`. Expected: 1 passing. Then run the existing platform + auth suites to catch regressions from removing `tempPassword`: `pnpm --filter @refearn/api test:int -- -t "platform"` and `pnpm --filter @refearn/api lint`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "platform: owner email invite/accept flow replacing temp password (item 8)"`

---

### Task 11: Platform-admin management endpoints (spec item 9, backend)

**Files:**
- Modify: `apps/api/src/platform/platform.service.ts` (add `admins`, `grantAdmin`, `revokeAdmin`)
- Modify: `apps/api/src/platform/platform.controller.ts` (add GET/POST/DELETE)
- Modify: `apps/api/src/platform/platform.types.ts` (add `grantAdminSchema`)
- Test: `apps/api/test/platform.int-spec.ts`

> **Depends on: the `AuditLog.tenantId` decision (spec item 9).** `AuditLog.tenantId` is **already nullable** in the schema ([`schema.prisma:673`](apps/api/prisma/schema.prisma) — `tenantId String?`). Therefore platform-scoped admin-grant/revoke audits are written with `tenantId: null` (no migration, no system-tenant needed). The sealed-chain seal job groups by `tenantId` ([`reports.service.ts:65`](apps/api/src/reports/reports.service.ts)); `tenantId: null` rows are simply never sealed into any per-tenant chain — acceptable for platform-level rows (they remain readable via the global audit feed). This resolves the spec's open decision toward "nullable-`tenantId`" with **no schema change required**.

- [ ] **Step 1: Write the failing test.**

```ts
  it('item 9: grant/revoke platform admin round-trips + audits; self-revoke 403; last-admin 403; unknown email 404', async () => {
    const primary = await prisma.user.create({
      data: { email: 'plat-primary@test.refearn.local', passwordHash: 'x', fullName: 'Primary', isPlatformAdmin: true },
    });
    const platTok = token({ sub: primary.id, plat: true });
    const srv = app.getHttpServer();

    // grant to an existing non-admin user
    const cand = await prisma.user.create({ data: { email: 'cand@test.refearn.local', passwordHash: 'x', fullName: 'Cand' } });
    await request(srv).post('/v1/platform/admins').set('Authorization', `Bearer ${platTok}`).send({ email: 'cand@test.refearn.local' }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: cand.id } })).isPlatformAdmin).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'platform.admin_granted', tenantId: null } })).toBe(1);

    // list shows both
    const list = (await request(srv).get('/v1/platform/admins').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(list.length).toBe(2);

    // unknown email → 404
    await request(srv).post('/v1/platform/admins').set('Authorization', `Bearer ${platTok}`).send({ email: 'nobody@test.refearn.local' }).expect(404);

    // self-revoke → 403
    await request(srv).delete(`/v1/platform/admins/${primary.id}`).set('Authorization', `Bearer ${platTok}`).expect(403);

    // revoke the candidate → ok
    await request(srv).delete(`/v1/platform/admins/${cand.id}`).set('Authorization', `Bearer ${platTok}`).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: cand.id } })).isPlatformAdmin).toBe(false);

    // now primary is the last admin → cannot revoke (but self-guard fires first; use a fresh second admin then revoke primary)
    const second = await prisma.user.create({ data: { email: 'second@test.refearn.local', passwordHash: 'x', fullName: 'Second', isPlatformAdmin: true } });
    const secondTok = token({ sub: second.id, plat: true });
    // second revokes primary → ok (2 admins → 1)
    await request(srv).delete(`/v1/platform/admins/${primary.id}`).set('Authorization', `Bearer ${secondTok}`).expect(200);
    // second tries to revoke itself as last admin → self-guard 403
    await request(srv).delete(`/v1/platform/admins/${second.id}`).set('Authorization', `Bearer ${secondTok}`).expect(403);
  });
```

- [ ] **Step 2: Run test to verify it fails.** Command: `pnpm --filter @refearn/api test:int -- -t "item 9"`. Expected: 404 (routes missing).

- [ ] **Step 3: Write minimal implementation.**

In `platform.types.ts`, add:

```ts
/** Item 9: platform admin ver (e-posta ile). */
export const grantAdminSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
export type GrantAdminInput = z.infer<typeof grantAdminSchema>;
```

In `platform.service.ts`, add:

```ts
  /** Item 9: platform adminleri (isPlatformAdmin=true). */
  async admins() {
    const users = await this.prisma.user.findMany({
      where: { isPlatformAdmin: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, fullName: true, createdAt: true },
    });
    return users;
  }

  /** Item 9: e-posta ile platform admin ver (kabuk kullanici olusturmaz). Audit tenantId:null. */
  async grantAdmin(actorUserId: string, email: string) {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, isPlatformAdmin: true } });
    if (!user) throw new NotFoundException('bu e-postali kullanici yok');
    if (!user.isPlatformAdmin) {
      await this.prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin: true } });
      await this.prisma.auditLog.create({
        data: { tenantId: null, actorUserId, action: 'platform.admin_granted', entity: 'user', entityId: user.id, after: { email } },
      });
    }
    return { id: user.id, email, isPlatformAdmin: true };
  }

  /** Item 9: platform admin al — self-revoke ve son-admin transactional guard'li. Audit tenantId:null. */
  async revokeAdmin(actorUserId: string, targetUserId: string) {
    if (actorUserId === targetUserId) throw new ForbiddenException('kendi platform yetkinizi alamazsiniz');
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { id: true, isPlatformAdmin: true, email: true } });
      if (!target || !target.isPlatformAdmin) throw new NotFoundException('platform admin bulunamadi');
      const count = await tx.user.count({ where: { isPlatformAdmin: true } });
      if (count <= 1) throw new BadRequestException('son platform admin alinamaz');
      await tx.user.update({ where: { id: targetUserId }, data: { isPlatformAdmin: false } });
      await tx.auditLog.create({
        data: { tenantId: null, actorUserId, action: 'platform.admin_revoked', entity: 'user', entityId: targetUserId, after: { email: target.email } },
      });
      return { id: targetUserId, isPlatformAdmin: false };
    });
  }
```

Add `ForbiddenException` to the `@nestjs/common` import in `platform.service.ts`.

In `platform.controller.ts`, add `Delete` to the `@nestjs/common` import and (import `grantAdminSchema, GrantAdminInput`):

```ts
  @Get('admins')
  admins() {
    return this.platform.admins();
  }

  @HttpCode(200)
  @Post('admins')
  grantAdmin(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(grantAdminSchema)) body: GrantAdminInput) {
    return this.platform.grantAdmin(user.sub, body.email);
  }

  @HttpCode(200)
  @Delete('admins/:userId')
  revokeAdmin(@CurrentUser() user: RequestUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.platform.revokeAdmin(user.sub, userId);
  }
```

- [ ] **Step 4: Run test to verify it passes.** Command: `pnpm --filter @refearn/api test:int -- -t "item 9"`. Expected: 1 passing. Then `pnpm --filter @refearn/api lint`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "platform: platform-admin management endpoints with self/last-admin guards (item 9)"`

---

### Task 12: Billing package catalog + MRR + tenant assignment (spec item 10, backend)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (add `BillingPackage`; `TenantBilling.packageId`/`overrides`)
- Create: `apps/api/prisma/migrations/20260709102000_billing_packages/migration.sql`
- Create: `apps/api/src/platform/packages.service.ts`
- Modify: `apps/api/src/platform/platform.module.ts` (add `PackagesService`)
- Modify: `apps/api/src/platform/platform.controller.ts` (packages CRUD + MRR; extend `setBilling` to accept `packageId`)
- Modify: `apps/api/src/platform/billing.service.ts` (`setConfig` accepts `packageId`; fee defaults from package)
- Modify: `apps/api/src/platform/platform.types.ts` (package schemas; extend `setBillingSchema`)
- Test: `apps/api/test/platform.int-spec.ts`

> **Depends on: the package-model decision (spec item 10 — CONFIRMED recommendation).** Model packages as a **DB catalog** (`BillingPackage` table + `TenantBilling.packageId`) so fees/limits are editable without deploys. MRR = sum of `monthlyFeeCents` over `TenantBilling` where `active`. Deleting a referenced package soft-deactivates (`active=false`). Feature-flag **enforcement** in tenant runtime is out of scope (non-goal).

- [ ] **Step 1: Write the failing test.**

```ts
  it('item 10: package CRUD + audit; assigning sets default fee; MRR sums active; soft-delete blocks hard-delete', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-pk@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    // create package
    const pkg = (await request(srv).post('/v1/platform/packages').set('Authorization', `Bearer ${platTok}`)
      .send({ key: 'growth', name: 'Growth', monthlyFeeCents: 19900, features: { seats: true }, limits: { members: 5000 } }).expect(200)).body;
    expect(pkg.monthlyFeeCents).toBe('19900');
    expect(await prisma.auditLog.count({ where: { action: 'platform.package_created', tenantId: null } })).toBe(1);

    // list
    const list = (await request(srv).get('/v1/platform/packages').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(list.some((p: { key: string }) => p.key === 'growth')).toBe(true);

    // assign to a tenant → default fee from package
    const tenant = await createTenant(prisma);
    await request(srv).put(`/v1/platform/companies/${tenant.id}/billing`).set('Authorization', `Bearer ${platTok}`)
      .send({ packageId: pkg.id, active: true }).expect(200);
    const cfg = await prisma.tenantBilling.findUniqueOrThrow({ where: { tenantId: tenant.id } });
    expect(cfg.monthlyFeeCents).toBe(19900n);
    expect(cfg.packageId).toBe(pkg.id);

    // MRR sums only active billing
    const t2 = await createTenant(prisma);
    await request(srv).put(`/v1/platform/companies/${t2.id}/billing`).set('Authorization', `Bearer ${platTok}`)
      .send({ monthlyFeeCents: 5000, active: false }).expect(200);
    const mrr = (await request(srv).get('/v1/platform/mrr').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(mrr.mrrCents).toBe('19900');

    // soft-delete (deactivate) while referenced → active=false, not hard-deleted
    await request(srv).delete(`/v1/platform/packages/${pkg.id}`).set('Authorization', `Bearer ${platTok}`).expect(200);
    expect((await prisma.billingPackage.findUniqueOrThrow({ where: { id: pkg.id } })).active).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails.** Command: `pnpm --filter @refearn/api test:int -- -t "item 10"`. Expected: 404 / Prisma error (`billingPackage` model missing).

- [ ] **Step 3: Write minimal implementation.**

In `schema.prisma`, add the model and extend `TenantBilling`:

```prisma
// Item 10: platform billing paketi katalogu (Starter/Growth/Enterprise). Fee + flag/limit JSON.
model BillingPackage {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  key             String   @unique
  name            String
  monthlyFeeCents BigInt   @map("monthly_fee_cents")
  features        Json     @default("{}")
  limits          Json     @default("{}")
  active          Boolean  @default(true)
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  tenantBillings  TenantBilling[]

  @@map("billing_packages")
}
```

Add to `TenantBilling` (after `notes String?`, line 219):

```prisma
  packageId       String?  @map("package_id") @db.Uuid
  overrides       Json     @default("{}")
  package         BillingPackage? @relation(fields: [packageId], references: [id])
```

Create `apps/api/prisma/migrations/20260709102000_billing_packages/migration.sql`:

```sql
-- Item 10: billing paket katalogu + tenant atamasi.
CREATE TABLE "billing_packages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "monthly_fee_cents" BIGINT NOT NULL,
  "features" JSONB NOT NULL DEFAULT '{}',
  "limits" JSONB NOT NULL DEFAULT '{}',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_packages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "billing_packages_key_key" ON "billing_packages"("key");

ALTER TABLE "tenant_billing" ADD COLUMN "package_id" UUID;
ALTER TABLE "tenant_billing" ADD COLUMN "overrides" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "tenant_billing" ADD CONSTRAINT "tenant_billing_package_id_fkey"
  FOREIGN KEY ("package_id") REFERENCES "billing_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Create `apps/api/src/platform/packages.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PackagesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.billingPackage.findMany({ orderBy: { monthlyFeeCents: 'asc' } });
    return rows.map((p) => this.serialize(p));
  }

  async create(actorUserId: string, input: { key: string; name: string; monthlyFeeCents: number; features: object; limits: object }) {
    const exists = await this.prisma.billingPackage.findUnique({ where: { key: input.key }, select: { id: true } });
    if (exists) throw new BadRequestException('bu key zaten var');
    const pkg = await this.prisma.billingPackage.create({
      data: {
        key: input.key, name: input.name, monthlyFeeCents: BigInt(input.monthlyFeeCents),
        features: input.features as Prisma.InputJsonValue, limits: input.limits as Prisma.InputJsonValue,
      },
    });
    await this.audit(actorUserId, 'platform.package_created', pkg.id, { key: pkg.key });
    return this.serialize(pkg);
  }

  async update(actorUserId: string, id: string, input: Partial<{ name: string; monthlyFeeCents: number; features: object; limits: object; active: boolean }>) {
    const exists = await this.prisma.billingPackage.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('paket bulunamadi');
    const pkg = await this.prisma.billingPackage.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.monthlyFeeCents !== undefined ? { monthlyFeeCents: BigInt(input.monthlyFeeCents) } : {}),
        ...(input.features !== undefined ? { features: input.features as Prisma.InputJsonValue } : {}),
        ...(input.limits !== undefined ? { limits: input.limits as Prisma.InputJsonValue } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    await this.audit(actorUserId, 'platform.package_updated', id, { name: pkg.name });
    return this.serialize(pkg);
  }

  /** Soft-delete: referans varsa active=false; referans yoksa yine soft (hard-delete asla). */
  async softDelete(actorUserId: string, id: string) {
    const exists = await this.prisma.billingPackage.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('paket bulunamadi');
    const pkg = await this.prisma.billingPackage.update({ where: { id }, data: { active: false } });
    await this.audit(actorUserId, 'platform.package_deactivated', id, {});
    return this.serialize(pkg);
  }

  /** MRR = active billing config'lerin monthlyFeeCents toplami (BigInt → string). */
  async mrr() {
    const rows = await this.prisma.tenantBilling.findMany({ where: { active: true }, select: { monthlyFeeCents: true } });
    const total = rows.reduce((a, r) => a + r.monthlyFeeCents, 0n);
    return { mrrCents: total.toString(), activeCount: rows.length };
  }

  private serialize(p: { id: string; key: string; name: string; monthlyFeeCents: bigint; features: unknown; limits: unknown; active: boolean }) {
    return { id: p.id, key: p.key, name: p.name, monthlyFeeCents: p.monthlyFeeCents.toString(), features: p.features, limits: p.limits, active: p.active };
  }

  private async audit(actorUserId: string, action: string, entityId: string, after: object) {
    await this.prisma.auditLog.create({ data: { tenantId: null, actorUserId, action, entity: 'billing_package', entityId, after: after as Prisma.InputJsonValue } });
  }
}
```

In `platform.types.ts`, add package schemas and extend `setBillingSchema` so `monthlyFeeCents` becomes optional when a `packageId` supplies the fee:

```ts
export const createPackageSchema = z.object({
  key: z.string().trim().toLowerCase().min(2).max(40).regex(/^[a-z0-9_]+$/),
  name: z.string().trim().min(2).max(80),
  monthlyFeeCents: z.number().int().min(0).max(100_000_000),
  features: z.record(z.unknown()).default({}),
  limits: z.record(z.unknown()).default({}),
});
export type CreatePackageInput = z.infer<typeof createPackageSchema>;

export const updatePackageSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  monthlyFeeCents: z.number().int().min(0).max(100_000_000).optional(),
  features: z.record(z.unknown()).optional(),
  limits: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
});
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;
```

Replace `setBillingSchema` (lines 12–17) with a version that accepts an optional `packageId` and optional `monthlyFeeCents`:

```ts
export const setBillingSchema = z.object({
  packageId: z.string().uuid().optional(),
  monthlyFeeCents: z.number().int().min(0).max(100_000_000).optional(),
  active: z.boolean(),
  notes: z.string().trim().max(500).optional().nullable(),
}).refine((v) => v.packageId !== undefined || v.monthlyFeeCents !== undefined, { message: 'packageId veya monthlyFeeCents gerekli' });
export type SetBillingInput = z.infer<typeof setBillingSchema>;
```

In `billing.service.ts`, update `setConfig` to resolve the fee from a package when `packageId` is given (fee stays overridable):

```ts
  async setConfig(tenantId: string, input: { packageId?: string; monthlyFeeCents?: bigint; active: boolean; notes?: string | null }) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
    if (!tenant) throw new NotFoundException('sirket bulunamadi');
    let fee = input.monthlyFeeCents;
    if (fee === undefined && input.packageId) {
      const pkg = await this.prisma.billingPackage.findUnique({ where: { id: input.packageId }, select: { monthlyFeeCents: true } });
      if (!pkg) throw new NotFoundException('paket bulunamadi');
      fee = pkg.monthlyFeeCents;
    }
    if (fee === undefined) fee = 0n;
    await this.prisma.tenantBilling.upsert({
      where: { tenantId },
      create: { tenantId, monthlyFeeCents: fee, currency: tenant.currency, active: input.active, notes: input.notes ?? null, packageId: input.packageId ?? null },
      update: { monthlyFeeCents: fee, active: input.active, notes: input.notes ?? null, ...(input.packageId !== undefined ? { packageId: input.packageId } : {}) },
    });
    return this.forTenant(tenantId);
  }
```

Update the controller `setBilling` handler to pass the new shape:

```ts
  @Put('companies/:id/billing')
  setBilling(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(setBillingSchema)) body: SetBillingInput) {
    return this.billing.setConfig(id, {
      packageId: body.packageId,
      monthlyFeeCents: body.monthlyFeeCents !== undefined ? BigInt(body.monthlyFeeCents) : undefined,
      active: body.active,
      notes: body.notes,
    });
  }
```

Add package routes + MRR to `platform.controller.ts` (inject `PackagesService`; import `Delete`, the package schemas/types):

```ts
  @Get('packages')
  packages() {
    return this.packages.list();
  }

  @HttpCode(200)
  @Post('packages')
  createPackage(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(createPackageSchema)) body: CreatePackageInput) {
    return this.packages.create(user.sub, body);
  }

  @Put('packages/:id')
  updatePackage(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updatePackageSchema)) body: UpdatePackageInput) {
    return this.packages.update(user.sub, id, body);
  }

  @HttpCode(200)
  @Delete('packages/:id')
  deletePackage(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.packages.softDelete(user.sub, id);
  }

  @Get('mrr')
  mrr() {
    return this.packages.mrr();
  }
```

Add `PackagesService` to `platform.module.ts` providers and to the controller constructor.

Run migration: `pnpm --filter @refearn/api db:migrate`.

- [ ] **Step 4: Run test to verify it passes.** Command: `pnpm --filter @refearn/api test:int -- -t "item 10"`. Expected: 1 passing. Then run the full billing regression (the changed `setConfig` shape): `pnpm --filter @refearn/api test:int -- -t "C2 billing"` and `pnpm --filter @refearn/api lint`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "platform: billing package catalog + MRR + tenant assignment (item 10)"`

---

### Task 13: Frontend — shared `statusBadge()` helper + overview page + moved directory (spec items 1, 11 UI)

**Files:**
- Create: `apps/web/src/components/platform/statusBadge.tsx`
- Create: `apps/web/src/app/platform/companies/page.tsx` (moved + paginated directory)
- Modify: `apps/web/src/app/platform/page.tsx` (REPLACE with overview)
- Modify: `apps/web/src/app/platform/layout.tsx` (nav Overview / Companies)

> **Depends on: the design-system primitives track** for any future systematized components — but per spec Global Constraint #5 this track **reuses existing `ui.tsx` primitives only** (`StatCard`, `Modal`, `Pagination`, `useToast`) and `globals.css` classes (`card`, `badge`, `stat-grid`, `btn`). No new design-system components are introduced here.

- [ ] **Step 1: Write the failing test (type-level contract).** Author `apps/web/src/components/platform/statusBadge.tsx` with an explicit typed contract so `tsc --noEmit` enforces it. Define:

```tsx
export type PlatformStatus = 'active' | 'suspended' | 'setup_needed';

export interface StatusBadgeProps {
  status: PlatformStatus | string;
}

const MAP: Record<PlatformStatus, { cls: string; label: string }> = {
  active: { cls: 'active', label: 'Active' },
  suspended: { cls: 'inactive', label: 'Suspended' },
  setup_needed: { cls: 'pending', label: 'Setup needed' },
};

/** Item 4 (global constraint): tek yerden durum → badge. Ham domain string'i CSS class'ina asla interpolate edilmez. */
export function statusBadge(status: string): { cls: string; label: string } {
  return MAP[status as PlatformStatus] ?? { cls: 'inactive', label: status };
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const b = statusBadge(status);
  return <span className={`badge ${b.cls}`}>{b.label}</span>;
}
```

The verification is: this compiles under `tsc --noEmit`, and every consumer imports `StatusBadge`/`statusBadge` rather than interpolating status into a class.

- [ ] **Step 2: Run type-check to verify current state fails.** Command: `pnpm --filter @refearn/web lint`. Expected: **fails** — the moved `companies/page.tsx` does not yet exist and `page.tsx` (overview) will reference types/endpoints (`/platform/overview`) whose response shape must match; write the overview + directory first, then this becomes the passing gate. (Run before implementation to confirm the compiler catches missing files.)

- [ ] **Step 3: Write minimal implementation.**

Create `apps/web/src/app/platform/companies/page.tsx` — the moved directory, now server-paginated with a status `<select>` and debounced `q`. It reuses the existing card grid from the old `page.tsx` but reads `{ rows, total }`, wires `Pagination`, and uses `StatusBadge`. Interface:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Loading, Pagination, useToast } from '@/components/ui';
import { money } from '@/lib/format';
import { StatusBadge } from '@/components/platform/statusBadge';
import { OnboardingWizard } from '@/components/platform/OnboardingWizard';

interface Company {
  id: string; slug: string; name: string; currency: string; status: string;
  members: number; activeMembers: number; revenueThisMonthCents: string; salesThisMonth: number; createdAt: string;
}
interface Page { total: number; page: number; pageSize: number; rows: Company[] }

export default function CompaniesPage() {
  const router = useRouter();
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status) params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    const h = setTimeout(() => {
      api.get<Page>(`/platform/companies?${params}`).then(setData).catch((e) => setError(String((e as ApiError).message)));
    }, 250);
    return () => clearTimeout(h);
  }, [page, status, q]);
  // ... renders card grid over data.rows using <StatusBadge status={c.status} />,
  //     a status <select> (all/active/suspended/setup_needed), a debounced search input,
  //     a "＋ New company" button opening <OnboardingWizard>, and <Pagination page/pageSize/total onPage={setPage} />.
```

Behavior to verify: changing the status select refetches with `?status=`; typing in search debounces then refetches with `?q=`; pagination arrows change `?page=`; each card links to `/platform/companies/{id}`; the "New company" button opens the wizard (Task 14).

Replace `apps/web/src/app/platform/page.tsx` with the **overview** — KPI `StatCard` grid (`companies`, `active/suspended`, `members`, platform revenue this month, plus AR open/overdue/collected, plus MRR from `/platform/mrr`) and a "Needs attention" card listing `needsAttention` rows, each with a severity dot (red for `high`, amber for `warn`) and a deep-link CTA (`ctaHref`). Interface:

```tsx
interface Overview {
  kpis: { companies: number; active: number; suspended: number; members: number; platformRevenueThisMonthCents: string; ar: { openCents: string; overdueCents: string; paidCents: string } };
  needsAttention: Array<{ tenantId: string; tenantName: string; kind: string; severity: 'high' | 'warn'; detail: string; ctaHref: string }>;
}
```

Zero-state: when `kpis.companies === 0`, render a friendly "No companies yet — create your first" panel (not an error). Empty `needsAttention` → "All clear" message.

Update `apps/web/src/app/platform/layout.tsx` `NAV` (line 10):

```tsx
const NAV = [
  { href: '/platform', label: 'Overview', ic: '◈' },
  { href: '/platform/companies', label: 'Companies', ic: '◳' },
  { href: '/platform/audit', label: 'Audit', ic: '☰' },
  { href: '/platform/system', label: 'System', ic: '♥' },
  { href: '/platform/admins', label: 'Admins', ic: '⬡' },
  { href: '/platform/packages', label: 'Packages', ic: '◆' },
];
```

Note: the layout's `active` class check uses `pathname === n.href`; change it to `pathname === n.href || (n.href !== '/platform' && pathname.startsWith(n.href))` so nested routes highlight correctly (and `/platform` overview stays exact-match).

- [ ] **Step 4: Run type-check to verify it passes + manual verification.** Command: `pnpm --filter @refearn/web lint`. Expected: no errors. **Manual verification steps** (apps/web has no test runner — Playwright arrives in the tenant-isolation-hardening track): run `pnpm dev:web` with the API up; sign in as the platform admin (`prisma/add-platform-admin.ts` seed); (1) `/platform` shows KPI cards + MRR + needs-attention rows with severity dots; a stuck-payout row is red, a no-plan row amber; clicking a CTA lands on the right company tab; (2) with zero tenants, `/platform` shows the friendly zero-state; (3) `/platform/companies` paginates (create 25 tenants via the API), the status select filters, and search debounces; (4) nav highlights Overview vs Companies correctly.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "web/platform: statusBadge helper + overview dashboard + paginated companies directory (items 1, 11)"`

---

### Task 14: Frontend — onboarding wizard replacing NewCompanyModal (spec item 2 UI)

**Files:**
- Create: `apps/web/src/components/platform/OnboardingWizard.tsx`
- (The old `NewCompanyModal` in the former `page.tsx` is dropped when the file becomes the overview in Task 13.)

- [ ] **Step 1: Write the failing test (type contract).** Define the wizard's props/interface so `tsc` enforces the contract:

```tsx
export interface OnboardingWizardProps {
  onClose: () => void;
  onCreated: (company: { id: string; name: string; slug: string }) => void;
}

type Step = 1 | 2 | 3 | 4;
```

- [ ] **Step 2: Run type-check to verify current state.** Command: `pnpm --filter @refearn/web lint`. Expected: **fails** — `apps/web/src/app/platform/companies/page.tsx` (Task 13) imports `OnboardingWizard` which does not yet exist.

- [ ] **Step 3: Write minimal implementation.** Create `apps/web/src/components/platform/OnboardingWizard.tsx` — a `Modal`-hosted 4-step form with local `step` state (no router change):

- Step 1 (company): `name`, auto-slug (reuse the `slugify` logic from the old modal), `currency`, `timezone`. On submit, `POST /platform/companies` with `{ name, slug, currency, timezone, ownerEmail, ownerName }` (owner captured in step 4; collect all fields across steps and submit once at the end). Surface a slug-collision `ConflictException` message inline on step 1 without losing later step input.
- Step 2 (plan/package): a `<select>` populated from `GET /platform/packages` (active only), with the default preselected. Store `packageId`.
- Step 3 (branding): `logoUrl` (https), `primaryHex`, `accentHex` inputs with client-side `#hex`/https validation mirroring the server (`brandingSchema`).
- Step 4 (invite owner): `ownerName`, `ownerEmail`; copy reads "An invite email will be sent to the owner to set their password." No temp-password card.

On final submit: `POST /platform/companies` → then `PUT /platform/companies/:id/billing` with `{ packageId, active: false }` (config draft) and `PUT /platform/companies/:id/branding` with the step-3 values (both best-effort, non-fatal). Call `onCreated({ id, name, slug })` and `onClose()`. Wizard abandonment simply closes; the created-but-incomplete tenant remains `setup_needed` and surfaces in the overview queue (intended).

- [ ] **Step 4: Run type-check + manual verification.** Command: `pnpm --filter @refearn/web lint`. Expected: clean. **Manual verification:** open `/platform/companies` → "＋ New company"; step through all 4 steps; entering a duplicate slug shows the collision message on step 1 without wiping steps 2–4; entering `primaryHex = "red"` blocks step 3 with a validation message; completing the wizard creates a company that appears in the directory with a "Setup needed" badge and shows in the overview needs-attention queue.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "web/platform: 4-step onboarding wizard replacing single-screen modal (item 2)"`

---

### Task 15: Frontend — tabbed company detail + Tabs component (spec item 3 UI)

**Files:**
- Create: `apps/web/src/components/platform/Tabs.tsx`
- Modify: `apps/web/src/app/platform/companies/[id]/page.tsx` (convert to `?tab=`-routed tabbed layout)

- [ ] **Step 1: Write the failing test (type contract).** Define `Tabs`:

```tsx
export interface TabDef { key: string; label: string }
export interface TabsProps {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
}
```

- [ ] **Step 2: Run type-check.** Command: `pnpm --filter @refearn/web lint`. Expected: currently passes if `[id]/page.tsx` untouched; write the tab conversion so the import of `Tabs` and the new endpoint shapes are enforced. After editing `[id]/page.tsx` to import `Tabs`, running lint before creating `Tabs.tsx` fails.

- [ ] **Step 3: Write minimal implementation.**

Create `apps/web/src/components/platform/Tabs.tsx` — a small strip using the existing `seg-tabs`/`seg-tab` classes from `globals.css`; clicking a tab calls `onChange(key)`.

Convert `apps/web/src/app/platform/companies/[id]/page.tsx`: keep it a single `'use client'` component; read the initial tab from `useSearchParams().get('tab')` (default `overview`), hold `tab` in state, and on tab change call `router.replace(\`?tab=${key}\`, { scroll: false })` so deep links (`?tab=audit`) work on first paint. Tabs (MVP-first, matching spec item 3):

- **Overview** — KPIs (existing `Kpi`) + the setup checklist (from `company.setup`: `hasPlan`, `hasBranding`, `hasOwnerAccepted`, `memberCount`) with an "Activate company" button (`Confirm`) that `PATCH /platform/companies/:id/status { status: 'active' }`; disabled/blocked with a clear message when `!hasPlan`.
- **Users** — hosts the existing `NetworkExplorer` (from `/platform/companies/:id/network`) plus a flat paginated members table (`/platform/companies/:id/members?page=`) with `Pagination`.
- **Plans** — reads current commission plan (existing `company.plan`) read-only + the assigned billing package (`/platform/companies/:id/billing` → `config.packageId`, resolved against `/platform/packages`).
- **Payouts** — read-only table over `/platform/companies/:id/payouts?page=` with `Pagination`.
- **Audit** — table over `/platform/companies/:id/audit?page=&action=` (`SortableTh`/`Pagination`), `action` rendered through a small label map, `before/after` in a diff popover (truncate in row, full in `Modal`).
- **Health** — the tenant-relevant slice: reuse the global `/platform/health` jobs list (tenant-agnostic for MVP) with a note; or hide if out of scope — render the DB pill + jobs table.
- **Settings** — the existing Billing card (fee, active, issue/mark-paid/void) moved here, plus branding edit (`PUT /platform/companies/:id/branding`).

Replace the header "Enter workspace →" button with "Open company admin" (wired in Task 16). Use `<StatusBadge status={company.status} />` in the header. Deep-link requirement: verify `?tab=users` renders the members table on load.

- [ ] **Step 4: Run type-check + manual verification.** Command: `pnpm --filter @refearn/web lint`. Expected: clean. **Manual verification:** open a company; each tab switches without a full navigation and updates the URL `?tab=`; loading `/platform/companies/{id}?tab=audit` directly renders the Audit tab on first paint; the Overview checklist reflects real `setup` flags and "Activate company" is blocked for a plan-less tenant with a clear message; the Settings tab still issues/marks-paid invoices.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "web/platform: tabbed company detail (?tab= routing) with Users/Plans/Payouts/Audit/Health/Settings (item 3)"`

---

### Task 16: Frontend — "Open company admin" impersonation + exit band (spec item 4 UI)

**Files:**
- Modify: `apps/web/src/app/platform/companies/[id]/page.tsx` (replace `enterWorkspace` with `openCompanyAdmin`)
- Modify: `apps/web/src/app/admin/layout.tsx` (render "Viewing as … — exit" band)

> **Depends on: the safe-impersonation security decision (read-only owner-view, Task 6).** The minted token has `imp` set, so the guard 403s any non-GET — the UI must not offer mutating actions while the band is shown. Reuse the existing `startImpersonation`/`isImpersonating`/`stopImpersonation` helpers in [`apps/web/src/lib/auth.ts`](apps/web/src/lib/auth.ts) plus `applyTenantSwitch`.

- [ ] **Step 1: Write the failing test (type contract).** In `[id]/page.tsx`, replace the `enterWorkspace` function with `openCompanyAdmin` whose response type is enforced:

```tsx
interface ImpersonateResponse { accessToken: string; membershipId: string }
```

- [ ] **Step 2: Run type-check.** Command: `pnpm --filter @refearn/web lint`. Expected: fails until the new handler + band are consistent (e.g. missing `startImpersonation` import).

- [ ] **Step 3: Write minimal implementation.**

In `[id]/page.tsx`, implement `openCompanyAdmin`:

```tsx
  async function openCompanyAdmin() {
    if (!company) return;
    setEntering(true); setEnterMsg('');
    try {
      const res = await api.post<ImpersonateResponse>(`/platform/companies/${company.id}/impersonate`);
      const session = getSession();
      if (!session) { router.replace('/login'); return; }
      // build an impersonation session: platform session backed up, token scoped read-only to owner
      const impSession = { ...session, accessToken: res.accessToken, activeMembershipId: res.membershipId };
      startImpersonation(impSession);
      window.sessionStorage.setItem('refearn.platform.returnPath', `/platform/companies/${company.id}`);
      window.sessionStorage.setItem('refearn.platform.viewingTenant', company.name);
      router.push('/admin');
    } catch (e) {
      setEntering(false);
      setEnterMsg(String((e as ApiError).message));
    }
  }
```

Wire the header button to `openCompanyAdmin` (label "Open company admin"). Import `startImpersonation` from `@/lib/auth`.

In `apps/web/src/app/admin/layout.tsx`, render a persistent band at the top of `<main>` when `isImpersonating()`:

```tsx
  const [viewingTenant, setViewingTenant] = useState<string | null>(null);
  useEffect(() => {
    if (isImpersonating()) setViewingTenant(window.sessionStorage.getItem('refearn.platform.viewingTenant'));
  }, []);
  // ... in JSX, above children:
  {viewingTenant && (
    <div className="card" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, borderColor: 'var(--gold-500)' }}>
      <span>Viewing as <strong>{viewingTenant}</strong> — read-only</span>
      <span style={{ flex: 1 }} />
      <button className="btn ghost sm" onClick={exitImpersonation}>Exit</button>
    </div>
  )}
```

`exitImpersonation`: call `POST /platform/companies/:id/impersonate/end` (best-effort, using the tenant id from the return path), then `const restored = stopImpersonation(); if (restored) setSession(restored);` and `router.push(returnPath ?? '/platform')`. Import `isImpersonating, stopImpersonation` from `@/lib/auth` and `setSession`. Persist the band via `sessionStorage` (survives refresh) — read on mount, not from component state alone.

Because the impersonation token is read-only, the band's presence is the signal; the tenant admin UI's mutating buttons will 403 by design (acceptable — the band tells the operator it's read-only).

- [ ] **Step 4: Run type-check + manual verification.** Command: `pnpm --filter @refearn/web lint`. Expected: clean. **Manual verification:** as platform admin with **no** membership in a tenant, open a company → "Open company admin" → lands in `/admin` showing that tenant's dashboard with the gold "Viewing as {tenant} — read-only" band; a GET-only page renders; attempting a mutation (e.g. record a sale) returns 403 (expected); refreshing the page keeps the band; "Exit" restores the platform session and returns to the company page. Impersonating a suspended tenant shows the "company is suspended" error; a tenant with no active owner shows "company has no active owner".

- [ ] **Step 5: Commit.** `git add -A && git commit -m "web/platform: Open company admin (read-only impersonation) + exit band in admin layout (item 4)"`

---

### Task 17: Frontend — global search + audit + system + admins + packages pages + accept-invite (spec items 5, 6, 7, 8, 9, 10 UI)

**Files:**
- Create: `apps/web/src/components/platform/GlobalSearch.tsx`
- Modify: `apps/web/src/app/platform/layout.tsx` (mount `GlobalSearch` in the top bar)
- Create: `apps/web/src/app/platform/audit/page.tsx`
- Create: `apps/web/src/app/platform/system/page.tsx`
- Create: `apps/web/src/app/platform/admins/page.tsx`
- Create: `apps/web/src/app/platform/packages/page.tsx`
- Create: `apps/web/src/app/accept-invite/page.tsx`

- [ ] **Step 1: Write the failing test (type contracts).** Define the response types each page consumes so `tsc` enforces them against the backend shapes:

```tsx
// GlobalSearch
interface SearchResult {
  users: Array<{ userId: string; email: string; fullName: string; tenants: Array<{ tenantId: string; tenantName: string }> }>;
  members: Array<{ membershipId: string; referralCode: string; fullName: string; email: string; tenantId: string; tenantName: string; ctaHref: string }>;
  sales: Array<{ saleId: string; amountCents: string; externalRef: string | null; status: string; tenantId: string; tenantName: string; ctaHref: string }>;
  payouts: Array<{ payoutId: string; totalCents: string; ref: string | null; checkNumber: number | null; status: string; tenantId: string; tenantName: string; ctaHref: string }>;
}
// Audit page
interface AuditPage { total: number; page: number; pageSize: number; items: Array<{ seq: string; tenantId: string | null; tenantName: string | null; action: string; entity: string; actorName: string; before: unknown; after: unknown; createdAt: string }> }
// System page
interface Health { db: boolean; jobs: Array<{ name: string; at: string; ok: boolean; stale: boolean }>; backups: { lastBackupAt: string | null } }
// Admins page
interface Admin { id: string; email: string; fullName: string; createdAt: string }
// Packages page
interface Pkg { id: string; key: string; name: string; monthlyFeeCents: string; features: unknown; limits: unknown; active: boolean }
```

- [ ] **Step 2: Run type-check.** Command: `pnpm --filter @refearn/web lint`. Expected: fails until all six files + the layout mount compile.

- [ ] **Step 3: Write minimal implementation.**

`GlobalSearch.tsx` — a header search box with a 250ms-debounced call to `GET /platform/search?q=` (skip when `< 2` chars) rendering a grouped dropdown (Users / Members / Sales / Payouts), each row a link to its `ctaHref` (users link to the first tenant's company page). Mount it in `layout.tsx`'s `mobile-topbar`/`side` header area.

`audit/page.tsx` — the global feed: `GET /platform/audit?page=&action=` with an action filter `<select>` (label map), `Pagination`, and a diff popover (`Modal`) for `before/after`. Uses `StatusBadge`-style action labels via a small map.

`system/page.tsx` — `GET /platform/health` on mount + `setInterval` every 30s: a DB status pill, a jobs table (name / last run / ok / `stale` highlighted red), and backup freshness (`backups.lastBackupAt`, "no backup recorded" when null). When `jobs` is empty, show "No runs since restart" (not "failing").

`admins/page.tsx` — `GET /platform/admins` table; "Grant by email" (`Modal` → `POST /platform/admins`); revoke (`Confirm` → `DELETE /platform/admins/:userId`) with self-revoke and last-admin handled by the backend 403 surfaced as a toast; a note "newly-granted admins must re-login for access to take effect."

`packages/page.tsx` — `GET /platform/packages` catalog table; create (`Modal` → `POST /platform/packages`), edit (`PUT /platform/packages/:id`), deactivate (`Confirm` → `DELETE /platform/packages/:id`); show the platform MRR from `GET /platform/mrr` at the top; render a "custom fee" badge where a tenant's billing fee diverges from its package (informational).

`accept-invite/page.tsx` — a **public** page reading `?token=`; a set-password form (password + optional full name) posting `POST /auth/accept-owner-invite`; on success, `setSession(res)` and `router.push('/admin')`. Clear error + "link expired" message on 400.

- [ ] **Step 4: Run type-check + manual verification.** Command: `pnpm --filter @refearn/web lint`. Expected: clean. **Manual verification:** (5) type an email substring in the header search → grouped dropdown appears; clicking a member row deep-links to that company's Users tab; a 1-char query shows nothing. (6) `/platform/audit` lists rows from multiple tenants with tenant names; filtering by `billing.invoice_paid` narrows; the diff popover opens. (7) `/platform/system` shows DB green, a jobs table, backup freshness; auto-refreshes ~30s. (8) create a company with a new owner, copy the token from the dev email log, open `/accept-invite?token=…`, set a password, and land in `/admin`. (9) `/platform/admins` grants by email, blocks self-revoke and last-admin revoke with a toast. (10) `/platform/packages` creates/edits/deactivates packages and shows MRR.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "web/platform: global search + audit + system + admins + packages pages + accept-invite (items 5-10)"`

---

### Task 18: Full-suite verification + final cleanup

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend integration suite.** Command: `pnpm --filter @refearn/api test:int`. Expected: all `platform.int-spec.ts` and pre-existing suites (billing, impersonation, auth) pass — confirms no regression from the `setConfig`/`createCompany`/`setStatusSchema` changes.

- [ ] **Step 2: Run the backend + web type-checks.** Commands: `pnpm --filter @refearn/api lint` and `pnpm --filter @refearn/web lint`. Expected: both clean.

- [ ] **Step 3: Run the workspace lint via turbo.** Command: `pnpm lint`. Expected: all packages pass (this is the `turbo run lint` aggregate from the root `package.json`).

- [ ] **Step 4: Confirm migrations apply cleanly from scratch.** Command: `pnpm --filter @refearn/api db:deploy` against a fresh test DB (or `prisma migrate reset` in a scratch DB) — confirms the four new migrations (`tenant_setup_needed`, `owner_invite_token`, `billing_packages`, `system_status`) apply in order. Expected: no errors.

- [ ] **Step 5: Commit any final touch-ups.** `git add -A && git commit -m "platform: full-suite verification pass for Platform Command Center track"`

---

## Self-review

Each spec item maps to at least one task; MVP-first sequencing preserved (11 → 1 → 2 → 3 → 4 → 6 → 5 → 7 → 8 → 9 → 10, with UI grouped after the backend):

| Spec item | Backend task | Frontend task | Coverage notes |
|-----------|--------------|---------------|----------------|
| **1. Overview + needs-attention queue** | Task 5 (`overview()`, delegates to `BillingService.overview()`; each queue kind a cheap set query; severity derived; dedupe by `(tenantId, kind)`; suspended excluded) | Task 13 (KPIs + queue with severity dots + CTA deep-links; zero-state) | Test asserts each kind surfaces once + suspended exclusion + `high` severity. |
| **2. `setup_needed` + wizard** | Task 2 (enum + migration; guard unchanged = fully-open, per confirmed decision), Task 3 (new tenants `setup_needed`; branding PUT rejects bad hex; `setup` block; activate gate) | Task 14 (4-step wizard) | Tests: `status==='setup_needed'`, branding rejects bad hex, activate blocked without plan, enum round-trip. |
| **3. Company detail tabs** | Task 4 (paginated members + payouts, `where: { tenantId }`) | Task 15 (`?tab=` routing, all 7 tabs, deep-link on first paint) | Test asserts members/payouts tenant-scope + pagination; manual verifies `?tab=` deep link. |
| **4. Safe impersonation** | Task 6 (`imp` token as owner, no membership required, suspended blocked, start/end audit) | Task 16 ("Open company admin" + read-only exit band, `sessionStorage`-persisted) | **Depends-on note** placed on both tasks. Test: no-membership admin mints token, GET ok, POST 403, suspended 400, both audits land. |
| **5. Global cross-tenant search** | Task 8 (`search(q)` fan-out, min-2, 10/category, case-insensitive email + upper referral needle, `@PlatformAdmin()` only) | Task 17 (`GlobalSearch` debounced dropdown) | Test: email substring + tenant attribution, case-insensitive code, `q<2` empty, tenant_admin 403. |
| **6. Audit viewer** | Task 7 (per-tenant `seq desc` + global feed with tenant join; actor resolution; action filter) | Task 15 (Audit tab) + Task 17 (global `/platform/audit`) | Test: suspend + invoice-paid appear with correct action/actor; global spans tenants; `action` filter narrows. |
| **7. System health/jobs/backups** | Task 9 (`jobHealthWithStaleness()` + `SchedulerModule` export + `/platform/health` + `SystemStatus` backup marker) | Task 17 (`/platform/system` with 30s refresh) | **Depends-on note** (backups → `SystemStatus` table, confirmed). Unit test flags stale job; int test `db:true` + jobs array + backups + tenant 403; handles test-mode scheduler absence via `@Optional()`. |
| **8. Owner email invite/accept** | Task 10 (`owner_invite` `UserToken` purpose + migration; `createCompany` mints token/enqueues email for new owner, no temp password; public `accept-owner-invite`; existing-owner path unchanged; email outside tx) | Task 14 (wizard step 4 copy) + Task 17 (`/accept-invite`) | **Depends-on note** (reuse `UserToken`, confirmed). Test: new owner → token, no `tempPassword`; accept sets password + verifies + session; reuse rejected; existing owner no token. |
| **9. Platform-admin management** | Task 11 (`admins`/`grantAdmin`/`revokeAdmin`; self-revoke + transactional last-admin guards; audits with `tenantId: null` — schema already nullable, **no migration**) | Task 17 (`/platform/admins`) | **Depends-on note** resolves the `AuditLog.tenantId` decision (already nullable → no schema change). Test: grant/revoke + audit, self-revoke 403, last-admin 403, unknown email 404. |
| **10. Plan/package matrix + MRR** | Task 12 (`BillingPackage` catalog + migration; `TenantBilling.packageId`/`overrides`; CRUD audited; `setConfig` fee-from-package; `/platform/mrr`; soft-delete) | Task 14 (wizard selector) + Task 15 (Plans/Settings tab) + Task 17 (`/platform/packages` + MRR) | **Depends-on note** (DB catalog, confirmed). Test: CRUD + audit, assign sets default fee, MRR sums active only, soft-delete keeps row. |
| **11. Pagination + status filter + N-query fix** | Task 1 (`companies(query)` paginated + status filter + single grouped revenue via `groupBy(['tenantId','summaryMonth'])`, per-tz month selected app-side) | Task 13 (`Pagination` + status select + server `q`) | **Per-TZ decision** resolved (one grouped query, current-month key per tenant timezone). Test: 25 tenants → page slices + total, status filter, correct per-tenant month revenue. |

Global constraints honored: (#1) every tenant-scoped read/mutation added keeps `where: { tenantId }` (members, payouts, company audit, impersonation owner lookup, branding, billing); cross-tenant reads (search, global audit, MRR, overview) live only under `@PlatformAdmin()`. (#2) money stays BigInt cents, `.toString()` at the edge (revenue, MRR, payout/sale amounts, invoice serialize). (#3) every money/permission mutation writes an `auditLog.create` (branding, status, impersonate start/end, admin grant/revoke, package CRUD, invoice actions) reusing the existing pattern. (#4) UI text is English; all status pills route through the single `statusBadge()` helper (Task 13). (#5) no design-system migration — only `ui.tsx` primitives + `globals.css` classes reused; the design-system dependency is called out where relevant (Task 13).

Run commands confirmed from `package.json` (not guessed): backend integration `pnpm --filter @refearn/api test:int` (`jest --selectProjects integration --runInBand`), backend unit `pnpm --filter @refearn/api test`, backend type-check `pnpm --filter @refearn/api lint` (`tsc -p tsconfig.json --noEmit`), web type-check `pnpm --filter @refearn/web lint` (`tsc --noEmit`), migrations `pnpm --filter @refearn/api db:migrate`/`db:deploy`, aggregate `pnpm lint`. Jest single-test filtering uses `-- -t "<name>"`, and the integration bootstrap (`Test.createTestingModule({ imports: [AppModule] })`, `setGlobalPrefix('v1')`, `truncateAll`, JWT `token()` helper) matches the existing `platform.int-spec.ts`/`impersonation.int-spec.ts` pattern exactly — including that `truncateAll` already truncates `user_tokens` and `notifications` (needed by Task 10). Note for the implementer: `helpers.ts.truncateAll` does **not** currently truncate the new `billing_packages` / `system_status` tables; add both to the `TRUNCATE ... CASCADE` list in `apps/api/test/helpers.ts` as part of Task 12/Task 9 so cross-test isolation holds.

### Critical Files for Implementation
- C:/Users/Windows/Desktop/Refferal-sys/.claude/worktrees/trusting-mclaren-b0e5fe/apps/api/src/platform/platform.service.ts
- C:/Users/Windows/Desktop/Refferal-sys/.claude/worktrees/trusting-mclaren-b0e5fe/apps/api/src/platform/platform.controller.ts
- C:/Users/Windows/Desktop/Refferal-sys/.claude/worktrees/trusting-mclaren-b0e5fe/apps/api/prisma/schema.prisma
- C:/Users/Windows/Desktop/Refferal-sys/.claude/worktrees/trusting-mclaren-b0e5fe/apps/api/test/platform.int-spec.ts
- C:/Users/Windows/Desktop/Refferal-sys/.claude/worktrees/trusting-mclaren-b0e5fe/apps/web/src/app/platform/companies/[id]/page.tsx
