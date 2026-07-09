# Feature-Gap Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 7 founder-selected feature gaps — duplicate-sale detection, mandatory payout reject reason, settings unsaved-changes guard, plan-simulator wiring, member share presets, an admin fraud triage screen, and a derive-on-read member activity feed — reusing the production-ready backend and existing `ui.tsx` primitives.

**Architecture:** NestJS 11 + Prisma 6 monorepo (`apps/api`) with a Next.js 15 App-Router client (`apps/web`), driven by `pnpm`/`turbo`. Backend money is `BigInt` cents, serialized to strings at the edge; every tenant-scoped query carries `where: { tenantId }`; money/permission mutations write an `auditLog` row. The API exposes Zod-validated controllers under a global `v1` prefix; the web client talks to it through `@/lib/api`.

**Tech Stack:** TypeScript 5.8, NestJS 11, Prisma 6 (PostgreSQL), Zod 3, Jest 29 + supertest (API tests), Next.js 15 / React 19 (web, `tsc --noEmit` for type-check — no web test runner yet; Playwright arrives in the tenant-isolation-hardening track).

---

## File Structure

### apps/api (backend)

| File | Responsibility |
|------|----------------|
| `apps/api/src/sales/sales.service.ts` | (modify) catch Prisma `P2002` on create → friendly 409; dedup `externalRef` in import preview + skip duplicates on commit |
| `apps/api/prisma/schema.prisma` | (modify) reflect the already-existing partial unique index on `Sale(tenantId, externalRef)` as a comment marker (no new index — DB migration already shipped) |
| `apps/api/src/payouts/payouts.types.ts` | (modify) `decidePayoutSchema.superRefine` requires `ref` (min 3) when rejecting; new `rejectBatchSchema` with required `reason` |
| `apps/api/src/payouts/payouts.service.ts` | (modify) `rejectBatch(actor, batchId, reason)` stores reason in audit + notifies each member |
| `apps/api/src/payouts/payouts.controller.ts` | (modify) batch-reject route validates + passes `reason` |
| `apps/api/src/activity/activity.types.ts` | (create) `ActivityItem` type + `activityQuerySchema` (cursor) |
| `apps/api/src/activity/activity.service.ts` | (create) derive-on-read unified feed from memberships/sales/ledger/payouts, tenant+member scoped, cursor paginated |
| `apps/api/src/activity/activity.controller.ts` | (create) `GET /app/activity?cursor=` |
| `apps/api/src/activity/activity.module.ts` | (create) wire service + controller |
| `apps/api/src/app.module.ts` | (modify) register `ActivityModule` |
| `apps/api/test/sales-dedup.int-spec.ts` | (create) duplicate-detection integration tests |
| `apps/api/test/payouts-reject-reason.int-spec.ts` | (create) mandatory-reject-reason integration tests |
| `apps/api/test/activity.int-spec.ts` | (create) activity-feed integration tests |

### apps/web (frontend)

| File | Responsibility |
|------|----------------|
| `apps/web/src/lib/format.ts` | (modify) add `statusBadge(status)` helper (safe default badge class) |
| `apps/web/src/components/ImportWizard.tsx` | (modify) `duplicate` PreviewRow variant + "N ready · M duplicates · K errors" summary |
| `apps/web/src/app/admin/payouts/page.tsx` | (modify) reject modal → "Reason (required)", disable submit until non-empty; batch reject prompts for a reason |
| `apps/web/src/hooks/useDirty.ts` | (create) shared dirty-state hook (deep-equal current vs baseline) |
| `apps/web/src/components/SaveBar.tsx` | (create) sticky Save/Discard bar + `beforeunload` guard |
| `apps/web/src/components/SettingsSection.tsx` | (create) `maxWidth` wrapper to normalize section widths |
| `apps/web/src/app/admin/settings/sections/General.tsx` | (modify) wire `useDirty` + `SaveBar` (reference implementation for the guard) |
| `apps/web/src/app/admin/settings/sections/Plan.tsx` | (modify) replace fake client preview with `POST /admin/plans/simulate` + amount input + seller picker |
| `apps/web/src/app/app/invite/page.tsx` | (modify) Web Share + SMS/email/WhatsApp/X preset buttons |
| `apps/web/src/app/admin/fraud/page.tsx` | (create) fraud triage queue screen |
| `apps/web/src/app/admin/layout.tsx` | (modify) add perm-gated `/admin/fraud` nav item |
| `apps/web/src/lib/i18n.ts` | (modify) add `nav.fraud` label |
| `apps/web/src/components/ActivityFeed.tsx` | (create) day-grouped activity feed component |
| `apps/web/src/app/app/page.tsx` | (modify) render `<ActivityFeed />` on Home |
| `apps/api/src/reports/reports.service.ts` | (modify) repoint dashboard to-do `fraud_review` href to `/admin/fraud` |

---

## Preconditions (read once before starting)

- Postgres test DB must be up. Tests use `DATABASE_URL_TEST` (default `postgresql://refearn:refearn@localhost:5434/refearn_test`), configured in `apps/api/test/setup-env.ts`. Bring infra up from repo root with `pnpm db:up` if needed.
- API integration tests bootstrap the full Nest app with a global `v1` prefix and sign JWTs directly (see `apps/api/test/sales-wallet.int-spec.ts`). Reuse helpers from `apps/api/test/helpers.ts` (`createTenant`, `createPlan`, `createChain`, `createSale`, `truncateAll`, `netLedger`).
- Run commands (from repo root unless noted):
  - API unit tests: `pnpm --filter @refearn/api test`
  - API integration tests: `pnpm --filter @refearn/api test:int` (a single spec: `pnpm --filter @refearn/api test:int -- activity.int-spec`)
  - API type-check/lint: `pnpm --filter @refearn/api lint`
  - Web type-check/lint: `pnpm --filter @refearn/web lint` (this is `tsc --noEmit`; there is **no** web test runner — verify UI tasks with this + the manual steps given)
- **`externalRef` DB uniqueness already exists**: migration `apps/api/prisma/migrations/20260619183000_sales_external_ref_unique/migration.sql` created the partial unique index `sales_tenant_external_ref_uidx ON sales(tenant_id, external_ref) WHERE external_ref IS NOT NULL`. Task 1 therefore adds **no new migration** — it wires the service/UI behavior the index makes possible. The spec's collision pre-check / `CREATE INDEX CONCURRENTLY` step is already satisfied by that shipped migration; do not create a duplicate.

---

## Tasks

### Task 1: Duplicate sale detection — create-path 409 + import dedup (backend)

The DB partial-unique index already exists (see Preconditions). This task makes `create()` return a friendly 409 on collision and makes `importCsv` mark/skip duplicates.

**Files:**
- Modify: `apps/api/src/sales/sales.service.ts`
- Test: `apps/api/test/sales-dedup.int-spec.ts` (create)

- [ ] **Step 1: Write the failing test.** Create `apps/api/test/sales-dedup.int-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, SaleStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createTenant, truncateAll } from './helpers';

/** Feature-gap #1 — duplicate sale detection (externalRef): create 409 + import dedup/skip. */
describe('sales dedup (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  function tokenFor(o: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const p: AccessTokenPayload = { sub: o.userId, mid: o.membershipId, tid: o.tenantId, role: o.role };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  async function setup() {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 3);
    const owner = chain[0];
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    return {
      tenant, chain, owner,
      tok: tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner }),
    };
  }

  it('(b) create with an existing externalRef → 409, no extra sale', async () => {
    const { tenant, chain, tok } = await setup();
    const seller = chain[1];
    const body = { sellerReferralCode: seller.referralCode, amountCents: 100_000, externalRef: 'ORD-1' };

    await request(app.getHttpServer()).post('/v1/admin/sales').set('Authorization', `Bearer ${tok}`).send(body).expect(201);
    const dup = await request(app.getHttpServer()).post('/v1/admin/sales').set('Authorization', `Bearer ${tok}`).send(body).expect(409);
    expect(String(dup.body.message)).toMatch(/external reference/i);

    expect(await prisma.sale.count({ where: { tenantId: tenant.id, externalRef: 'ORD-1' } })).toBe(1);
  });

  it('(a) importing the same file twice → 2nd import creates 0 sales, all rows duplicate', async () => {
    const { tenant, chain, tok } = await setup();
    const csv = [
      'referral_code,amount_cents,external_ref',
      `${chain[1].referralCode},5000000,ORD-A`,
      `${chain[2].referralCode},7500000,ORD-B`,
    ].join('\n');

    const first = (await request(app.getHttpServer()).post('/v1/admin/sales/import').set('Authorization', `Bearer ${tok}`).send({ csv }).expect(200)).body;
    expect(first.created).toBe(2);

    // preview the same file again → both rows flagged duplicate, none ok
    const prev = (await request(app.getHttpServer()).post('/v1/admin/sales/import').set('Authorization', `Bearer ${tok}`).send({ csv, preview: true }).expect(200)).body;
    expect(prev.okCount).toBe(0);
    expect(prev.duplicateCount).toBe(2);
    expect(prev.rows.every((r: { status: string }) => r.status === 'duplicate')).toBe(true);

    // real re-import → zero new sales
    const second = (await request(app.getHttpServer()).post('/v1/admin/sales/import').set('Authorization', `Bearer ${tok}`).send({ csv }).expect(200)).body;
    expect(second.created).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(await prisma.sale.count({ where: { tenantId: tenant.id } })).toBe(2);
  });

  it('(a2) a duplicate externalRef repeated WITHIN the same file is flagged on the 2nd occurrence', async () => {
    const { chain, tok } = await setup();
    const csv = [
      'referral_code,amount_cents,external_ref',
      `${chain[1].referralCode},5000000,ORD-X`,
      `${chain[2].referralCode},7500000,ORD-X`,
    ].join('\n');
    const prev = (await request(app.getHttpServer()).post('/v1/admin/sales/import').set('Authorization', `Bearer ${tok}`).send({ csv, preview: true }).expect(200)).body;
    expect(prev.okCount).toBe(1);
    expect(prev.duplicateCount).toBe(1);
  });

  it('(c) two sales, distinct refs, same amount/date → both allowed (no false positive)', async () => {
    const { tenant, chain, tok } = await setup();
    const base = { amountCents: 250_000, saleDate: '2026-06-01' };
    await request(app.getHttpServer()).post('/v1/admin/sales').set('Authorization', `Bearer ${tok}`).send({ ...base, sellerReferralCode: chain[1].referralCode, externalRef: 'ORD-100' }).expect(201);
    await request(app.getHttpServer()).post('/v1/admin/sales').set('Authorization', `Bearer ${tok}`).send({ ...base, sellerReferralCode: chain[1].referralCode, externalRef: 'ORD-101' }).expect(201);
    expect(await prisma.sale.count({ where: { tenantId: tenant.id } })).toBe(2);
  });

  it('null/blank externalRef never collides', async () => {
    const { tenant, chain, tok } = await setup();
    const body = { sellerReferralCode: chain[1].referralCode, amountCents: 100_000 };
    await request(app.getHttpServer()).post('/v1/admin/sales').set('Authorization', `Bearer ${tok}`).send(body).expect(201);
    await request(app.getHttpServer()).post('/v1/admin/sales').set('Authorization', `Bearer ${tok}`).send(body).expect(201);
    expect(await prisma.sale.count({ where: { tenantId: tenant.id } })).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**
  - Command: `pnpm --filter @refearn/api test:int -- sales-dedup.int-spec`
  - Expected: the suite fails — case (b) gets `500` (unhandled `P2002`) instead of `409`; import cases fail because `duplicateCount`/`duplicates` fields don't exist and the 2nd import still creates rows.

- [ ] **Step 3: Write minimal implementation.** In `apps/api/src/sales/sales.service.ts`:

  (3a) `create()` — wrap the `sale.create` and translate `P2002` to a 409. Replace the existing `create` method with the full replacement:

```ts
  async create(actor: ActorContext, input: CreateSaleInput) {
    const seller = await this.resolveSeller(actor.tenantId, input);
    if (seller.status !== MembershipStatus.active) {
      throw new BadRequestException('pasif uye adina satis girilemez');
    }
    let sale;
    try {
      sale = await this.prisma.sale.create({
        data: {
          tenantId: actor.tenantId,
          sellerMembershipId: seller.id,
          amountCents: BigInt(input.amountCents),
          saleDate: input.saleDate ?? new Date(),
          customerRef: input.customerRef,
          externalRef: input.externalRef,
          createdBy: actor.userId, // gorevler ayrimi: onaylayan bu kisi olamaz
          status: SaleStatus.draft,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`A sale with external reference "${input.externalRef}" already exists`);
      }
      throw e;
    }
    await this.audit(actor, 'sale.create', sale.id, { amountCents: sale.amountCents.toString() });
    return this.serialize(sale);
  }
```

  (3b) Add `ConflictException` to the `@nestjs/common` import at the top of the file:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
```

  (3c) `importCsv()` — add duplicate detection. Pre-load existing external refs for this tenant and track in-file refs; mark rows `duplicate` in preview and skip them on commit. Replace the whole `importCsv` method with:

```ts
  async importCsv(actor: ActorContext, csv: string, mapping?: ImportMapping, preview = false) {
    const rows = parseCsv(csv);
    if (rows.length < 2) {
      throw new BadRequestException('CSV bos veya yalnizca baslik iceriyor');
    }
    if (rows.length - 1 > MAX_IMPORT_ROWS) {
      throw new BadRequestException(`CSV cok fazla satir iceriyor (en fazla ${MAX_IMPORT_ROWS})`);
    }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name?: string, fallback?: string): number => {
      const target = (name ?? fallback ?? '').trim().toLowerCase();
      return target ? header.indexOf(target) : -1;
    };
    const idx = {
      code: col(mapping?.code, 'referral_code'),
      amount: col(mapping?.amount, 'amount_cents'),
      date: col(mapping?.date, 'sale_date'),
      customer: col(mapping?.customer, 'customer_ref'),
      external: col(mapping?.external, 'external_ref'),
    };
    if (idx.code < 0 || idx.amount < 0) {
      throw new BadRequestException('Esleme gecersiz: referral_code ve amount_cents kolonlari bulunamadi');
    }

    // Dedup: bu tenant'ta zaten var olan external_ref'ler (DB) + dosya icinde tekrar edenler (RAM).
    // NULL/bos ref asla catismaz. Eslesme birebir (case-sensitive), types trim'i sema uygular.
    const existingRefs = new Set(
      (
        await this.prisma.sale.findMany({
          where: { tenantId: actor.tenantId, externalRef: { not: null } },
          select: { externalRef: true },
        })
      ).map((s) => s.externalRef as string),
    );
    const seenInFile = new Set<string>();

    const created: string[] = [];
    const errors: Array<{ line: number; reason: string }> = [];
    let duplicates = 0;
    const previewRows: Array<{
      line: number; status: 'ok' | 'error' | 'duplicate'; code: string; amountCents?: string; saleDate?: string;
      customerRef?: string; sellerName?: string; reason?: string;
    }> = [];

    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (cells.length === 1 && !cells[0]?.trim()) continue; // bos satir
      const code = cells[idx.code]?.trim() ?? '';
      const amountRaw = cells[idx.amount]?.trim();
      const externalRef = idx.external >= 0 ? cells[idx.external]?.trim() || undefined : undefined;
      try {
        if (!code) throw new Error('referral_code bos');
        const amount = Number(amountRaw);
        if (!Number.isInteger(amount) || amount <= 0) throw new Error(`gecersiz amount_cents: ${amountRaw}`);

        const seller = await this.resolveSeller(actor.tenantId, { sellerReferralCode: code });
        if (seller.status !== MembershipStatus.active) throw new Error('pasif uye');
        const sellerInfo = await this.prisma.membership.findUnique({
          where: { id: seller.id },
          select: { user: { select: { fullName: true } } },
        });

        const saleDate = idx.date >= 0 && cells[idx.date]?.trim() ? new Date(cells[idx.date].trim()) : new Date();
        if (Number.isNaN(saleDate.getTime())) throw new Error('gecersiz sale_date');
        const customerRef = idx.customer >= 0 ? cells[idx.customer]?.trim() || undefined : undefined;

        // duplicate: DB'de var VEYA bu dosyada daha once gecti (yalniz dolu ref'ler)
        const isDuplicate = !!externalRef && (existingRefs.has(externalRef) || seenInFile.has(externalRef));
        if (externalRef) seenInFile.add(externalRef);
        if (isDuplicate) {
          duplicates++;
          if (preview) {
            previewRows.push({
              line: r + 1, status: 'duplicate', code, amountCents: String(amount),
              saleDate: saleDate.toISOString(), customerRef, sellerName: sellerInfo?.user.fullName,
              reason: `duplicate external_ref "${externalRef}"`,
            });
          }
          continue; // commit'te de olusturulmaz
        }

        if (preview) {
          previewRows.push({
            line: r + 1, status: 'ok', code, amountCents: String(amount),
            saleDate: saleDate.toISOString(), customerRef, sellerName: sellerInfo?.user.fullName,
          });
          continue;
        }

        const sale = await this.prisma.sale.create({
          data: {
            tenantId: actor.tenantId,
            sellerMembershipId: seller.id,
            amountCents: BigInt(amount),
            saleDate,
            customerRef,
            externalRef,
            createdBy: actor.userId,
            status: SaleStatus.draft,
          },
        });
        created.push(sale.id);
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'bilinmeyen hata';
        errors.push({ line: r + 1, reason });
        if (preview) previewRows.push({ line: r + 1, status: 'error', code, reason });
      }
    }

    if (preview) {
      return {
        preview: true as const,
        okCount: previewRows.filter((p) => p.status === 'ok').length,
        duplicateCount: previewRows.filter((p) => p.status === 'duplicate').length,
        errorCount: previewRows.filter((p) => p.status === 'error').length,
        rows: previewRows,
      };
    }

    await this.audit(actor, 'sale.import', undefined, { created: created.length, errors: errors.length, duplicates });
    return { created: created.length, duplicates, errors };
  }
```

  Note: `Prisma` is already imported in this file (`import { MembershipStatus, Prisma, SaleStatus } from '@prisma/client';`). The preview response now uses a `status` discriminator instead of the old `ok` boolean — a breaking shape change consumed only by `ImportWizard.tsx` (updated in Task 8).

- [ ] **Step 4: Run test to verify it passes.**
  - Command: `pnpm --filter @refearn/api test:int -- sales-dedup.int-spec` then `pnpm --filter @refearn/api lint`
  - Expected: all 5 cases green; lint passes (no unused imports).

- [ ] **Step 5: Commit.**
  - `git add apps/api/src/sales/sales.service.ts apps/api/test/sales-dedup.int-spec.ts && git commit -m "feat(sales): duplicate detection — 409 on create + import dedup/skip"`

---

### Task 2: Reflect the existing externalRef unique index in schema.prisma (backend, doc-only)

Prisma cannot express a `WHERE`-partial unique index, so the constraint lives in raw SQL. Add a comment marker in `schema.prisma` next to `externalRef` so future readers know the DB guarantees uniqueness (mirrors the existing `Payout` `@@map` comment convention). No migration, no test — verified by `prisma validate`.

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (Sale model, around line 509)

- [ ] **Step 1: Write the change.** In `apps/api/prisma/schema.prisma`, find:

```prisma
  externalRef        String?    @map("external_ref")
```
Replace with:
```prisma
  // Kismi unique: bir tenant'ta bir dolu external_ref bir kez (CRM/order idempotency).
  // Prisma kismi (WHERE) unique'i ifade edemez → ham SQL migration
  // 20260619183000_sales_external_ref_unique: sales_tenant_external_ref_uidx.
  externalRef        String?    @map("external_ref")
```

- [ ] **Step 2: Verify no schema drift.**
  - Command: `pnpm --filter @refearn/api exec prisma validate`
  - Expected: `The schema at prisma/schema.prisma is valid 🚀` (a comment change never alters generated SQL).

- [ ] **Step 3: Commit.**
  - `git add apps/api/prisma/schema.prisma && git commit -m "docs(schema): note existing partial-unique index on Sale.externalRef"`

---

### Task 3: Mandatory reject reason — schemas (backend)

**Files:**
- Modify: `apps/api/src/payouts/payouts.types.ts`
- Test: covered by Task 4's integration spec (schema behavior is exercised through the HTTP layer). This task is validation-only; run the API lint to confirm the types compile.

- [ ] **Step 1: Write the change.** In `apps/api/src/payouts/payouts.types.ts`, replace the `decidePayoutSchema` block and add a batch-reject schema:

```ts
export const decidePayoutSchema = z
  .object({
    action: z.enum(['approve', 'reject']),
    // approve: banka/havale referansi (opsiyonel); reject: red sebebi (ZORUNLU, min 3)
    ref: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'reject' && (!v.ref || v.ref.length < 3)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ref'], message: 'red sebebi zorunlu (en az 3 karakter)' });
    }
  });
export type DecidePayoutInput = z.infer<typeof decidePayoutSchema>;

// Maker-checker batch red: sebep ZORUNLU (audit + uye bildirimi).
export const rejectBatchSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type RejectBatchInput = z.infer<typeof rejectBatchSchema>;
```

- [ ] **Step 2: Run lint to verify it compiles.**
  - Command: `pnpm --filter @refearn/api lint`
  - Expected: passes. (`rejectBatchSchema` is consumed in Task 4; until then it is exported but unused — TS `noEmit` does not flag unused exports.)

- [ ] **Step 3: Commit.**
  - `git add apps/api/src/payouts/payouts.types.ts && git commit -m "feat(payouts): require reject reason in decide + batch-reject schemas"`

---

### Task 4: Mandatory reject reason — service + controller (backend)

**Files:**
- Modify: `apps/api/src/payouts/payouts.service.ts` (`rejectBatch`)
- Modify: `apps/api/src/payouts/payouts.controller.ts` (batch-reject route)
- Test: `apps/api/test/payouts-reject-reason.int-spec.ts` (create)

> **Decision gate: this task assumes the spec's recommended approach — batch reject emits ONE in-app notification per member with template `payout_rejected` and stores `reason` in the audit `after` payload.** The per-request reject path already persists the reason (as `payout.ref` + audit). If instead you reuse the existing `payout_sent`/a generic template or skip per-member notifications, Step 3's `notification.createMany` block and the test's notification assertion change accordingly (drop the notify block + the `notifications` count assertion).

- [ ] **Step 1: Write the failing test.** Create `apps/api/test/payouts-reject-reason.int-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LedgerStatus, LedgerType, PayoutStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createTenant, truncateAll } from './helpers';

/** Feature-gap #2 — mandatory reject reason (per-request + batch). */
describe('payout reject reason (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  function tokenFor(o: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const p: AccessTokenPayload = { sub: o.userId, mid: o.membershipId, tid: o.tenantId, role: o.role };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }
  const srv = () => app.getHttpServer();

  /** requested payout + a payable ledger line bound to it. */
  async function requestedPayout(tenantId: string, membershipId: string) {
    const payout = await prisma.payout.create({
      data: { tenantId, membershipId, totalCents: 200_000n, method: 'check', status: PayoutStatus.requested, period: '2026-06' },
    });
    await prisma.ledgerEntry.create({
      data: { tenantId, saleId: null, beneficiaryMembershipId: membershipId, level: 0, rateBpsUsed: 0, amountCents: 200_000n, type: LedgerType.adjustment, status: LedgerStatus.payable, summaryMonth: '2026-06', payoutId: payout.id },
    });
    return payout;
  }

  it('(a) per-request reject WITHOUT ref → 400; WITH reason → balance returned + reason in audit', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, member] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const payout = await requestedPayout(tenant.id, member.id);

    await request(srv()).post(`/v1/admin/payouts/${payout.id}/decide`).set('Authorization', `Bearer ${tok}`).send({ action: 'reject' }).expect(400);

    await request(srv()).post(`/v1/admin/payouts/${payout.id}/decide`).set('Authorization', `Bearer ${tok}`).send({ action: 'reject', ref: 'invalid bank details' }).expect(200);
    const line = await prisma.ledgerEntry.findFirstOrThrow({ where: { beneficiaryMembershipId: member.id } });
    expect(line.status).toBe(LedgerStatus.payable);
    expect(line.payoutId).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: 'payout.reject' }, orderBy: { createdAt: 'desc' } });
    expect(JSON.stringify(audit?.after)).toMatch(/invalid bank details/);
  });

  it('approve still allows an empty ref', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, member] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const payout = await requestedPayout(tenant.id, member.id);
    await request(srv()).post(`/v1/admin/payouts/${payout.id}/decide`).set('Authorization', `Bearer ${tok}`).send({ action: 'approve' }).expect(200);
  });

  it('(b) batch reject WITHOUT reason → 400; WITH reason → each member notified + reason in audit', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, m1, m2] = await createChain(prisma, tenant.id, 3);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const batch = await prisma.payoutBatch.create({
      data: { tenantId: tenant.id, period: '2026-06', method: 'manual', membershipIds: [m1.id, m2.id], estimateCents: 0n, proposedByUserId: m1.userId, status: 'proposed' },
    });
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    await request(srv()).post(`/v1/admin/payouts/batches/${batch.id}/reject`).set('Authorization', `Bearer ${tok}`).send({}).expect(400);

    await request(srv()).post(`/v1/admin/payouts/batches/${batch.id}/reject`).set('Authorization', `Bearer ${tok}`).send({ reason: 'suspected duplicate run' }).expect(200);
    const updated = await prisma.payoutBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(updated.status).toBe('rejected');
    const notes = await prisma.notification.findMany({ where: { tenantId: tenant.id, template: 'payout_rejected' } });
    expect(notes.map((n) => n.recipientMembershipId).sort()).toEqual([m1.id, m2.id].sort());
    const audit = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: 'payout.batch_reject' } });
    expect(JSON.stringify(audit?.after)).toMatch(/suspected duplicate run/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**
  - Command: `pnpm --filter @refearn/api test:int -- payouts-reject-reason.int-spec`
  - Expected: fails — per-request reject without `ref` returns 200 (not 400) before Task 3's schema; batch reject without reason returns 200 and writes no notifications; audit lacks the reason.

- [ ] **Step 3: Write minimal implementation.**

  (3a) In `apps/api/src/payouts/payouts.service.ts`, replace the whole `rejectBatch` method:

```ts
  async rejectBatch(actor: ActorContext, batchId: string, reason: string) {
    const batch = await this.prisma.payoutBatch.findFirst({ where: { id: batchId, tenantId: actor.tenantId } });
    if (!batch) throw new NotFoundException('payout onerisi bulunamadi');
    if (batch.status !== 'proposed') throw new ConflictException('yalnizca bekleyen oneri reddedilebilir');
    await this.prisma.$transaction(async (tx) => {
      await tx.payoutBatch.update({ where: { id: batch.id }, data: { status: 'rejected', approvedByUserId: actor.userId } });
      // uye basina in-app bildirim (per-request reject yolunu yansitir)
      if (batch.membershipIds.length) {
        await tx.notification.createMany({
          data: batch.membershipIds.map((membershipId) => ({
            tenantId: actor.tenantId,
            recipientMembershipId: membershipId,
            channel: NotificationChannel.in_app,
            template: 'payout_rejected',
            payload: { batchId: batch.id, period: batch.period, reason } as Prisma.InputJsonValue,
          })),
        });
      }
      await tx.auditLog.create({
        data: { tenantId: actor.tenantId, actorUserId: actor.userId, action: 'payout.batch_reject', entity: 'payout', entityId: batch.id, after: { reason, count: batch.membershipIds.length } as Prisma.InputJsonValue },
      });
    });
    return { rejected: true };
  }
```

  `NotificationChannel`, `Prisma`, `ConflictException`, and `NotFoundException` are already imported in this file. The old `audit2` call for batch reject is removed (replaced by the inline `auditLog.create`).

  (3b) In `apps/api/src/payouts/payouts.controller.ts`, extend the `./payouts.types` import with:

```ts
  rejectBatchSchema,
  RejectBatchInput,
```
  and change the `rejectBatch` route to validate + pass the reason:

```ts
  @HttpCode(200)
  @Post('batches/:id/reject')
  rejectBatch(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rejectBatchSchema)) body: RejectBatchInput,
  ) {
    return this.payouts.rejectBatch(this.actor(user), id, body.reason);
  }
```

- [ ] **Step 4: Run test to verify it passes.**
  - Command: `pnpm --filter @refearn/api test:int -- payouts-reject-reason.int-spec` then `pnpm --filter @refearn/api lint`
  - Expected: all cases green; lint passes.

- [ ] **Step 5: Commit.**
  - `git add apps/api/src/payouts/payouts.service.ts apps/api/src/payouts/payouts.controller.ts apps/api/test/payouts-reject-reason.int-spec.ts && git commit -m "feat(payouts): mandatory reject reason on per-request + batch reject"`

---

### Task 5: Activity feed — types + service (backend)

Derive-on-read unified feed, tenant+member scoped, cursor-paginated by `(ts, id)` desc. Field names mirror a future `ActivityEvent` table so the client contract is stable.

> **Decision gate: this task assumes the spec's recommended sources.** The schema has **no `invites.usedAt`** column; the accepting recruit's `membership.joinedAt` already powers "X joined your team", so a separate invite-accepted item would double-count. This plan therefore **does not** emit a separate invite item and documents that as chosen. If you want a distinct invite-accepted item, add a source reading `Invite` where `status = 'used'` and `usedByMembershipId` is set, using `invite.updatedAt` as `ts` — and de-dupe against the join item.

**Files:**
- Create: `apps/api/src/activity/activity.types.ts`
- Create: `apps/api/src/activity/activity.service.ts`
- Test: covered by Task 7's integration spec.

- [ ] **Step 1: Write the types.** Create `apps/api/src/activity/activity.types.ts`:

```ts
import { z } from 'zod';

/**
 * Alan adlari + type union, gelecekteki ActivityEvent tablosunu birebir taklit eder
 * (type / ts / subject / amount). Bugun derive-on-read; kaynak sonradan gercek tabloya
 * degistirilebilir (read/unread + realtime) — istemci sozlesmesi degismez.
 */
export type ActivityType =
  | 'team_join'
  | 'sale_approved'
  | 'commission_credited'
  | 'check_mailed'
  | 'check_paid';

export interface ActivityItem {
  id: string;            // kaynak-benzersiz id (ts sirasi icin stabil)
  type: ActivityType;
  ts: string;            // ISO datetime
  title: string;         // uye-dostu satir
  amountCents?: string;  // para satirlarinda (BigInt string)
  subject?: string;      // opsiyonel ad (yalniz gizlilik-guvenli: direkt recruit)
}

export const ACTIVITY_PAGE_SIZE = 20;

// Cursor: "<isoTs>|<id>" (ts,id) desc anahtari. Opsiyonel — yoksa bastan.
export const activityQuerySchema = z.object({
  cursor: z.string().trim().max(120).optional(),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
```

- [ ] **Step 2: Write the service.** Create `apps/api/src/activity/activity.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { LedgerType, PayoutMethod, PayoutStatus, SaleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVITY_PAGE_SIZE, ActivityItem, ActivityQuery } from './activity.types';

/**
 * Uye aktivite akisi (derive-on-read). Tum kaynaklar member+tenant scoped.
 * GIZLILIK (wallet.service ile ayni model): yalniz DIREKT recruit'ler isimle gosterilir;
 * daha derin downline join'leri bu akista hic gosterilmez (yalniz kendi davet ettigi 1. seviye).
 */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async feed(membershipId: string, tenantId: string, q: ActivityQuery): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
    const items: ActivityItem[] = [];

    // 1) DIREKT recruit join'leri (isimle — kendi davet ettikleri). sponsor = me.
    const directs = await this.prisma.membership.findMany({
      where: { tenantId, sponsorMembershipId: membershipId },
      select: { id: true, joinedAt: true, user: { select: { fullName: true } } },
    });
    for (const d of directs) {
      items.push({
        id: `join:${d.id}`,
        type: 'team_join',
        ts: d.joinedAt.toISOString(),
        title: `${d.user.fullName} joined your team`,
        subject: d.user.fullName,
      });
    }

    // 2) Kendi satislari onaylandi (approvedAt dolu).
    const sales = await this.prisma.sale.findMany({
      where: { tenantId, sellerMembershipId: membershipId, status: SaleStatus.approved, approvedAt: { not: null } },
      select: { id: true, approvedAt: true, amountCents: true },
    });
    for (const s of sales) {
      items.push({
        id: `sale:${s.id}`,
        type: 'sale_approved',
        ts: (s.approvedAt as Date).toISOString(),
        title: 'Your sale was approved',
        amountCents: s.amountCents.toString(),
      });
    }

    // 3) Komisyon kredilendi (ledger, type=commission — kendi beneficiary satirlari).
    const ledger = await this.prisma.ledgerEntry.findMany({
      where: { tenantId, beneficiaryMembershipId: membershipId, type: LedgerType.commission },
      select: { id: true, createdAt: true, amountCents: true },
    });
    for (const l of ledger) {
      items.push({
        id: `comm:${l.id}`,
        type: 'commission_credited',
        ts: l.createdAt.toISOString(),
        title: 'Commission credited',
        amountCents: l.amountCents.toString(),
      });
    }

    // 4) Cek postalandi / odendi (Payout, method=check).
    const payouts = await this.prisma.payout.findMany({
      where: { tenantId, membershipId, method: PayoutMethod.check },
      select: { id: true, totalCents: true, mailedAt: true, paidAt: true, status: true },
    });
    for (const p of payouts) {
      if (p.mailedAt) {
        items.push({ id: `mailed:${p.id}`, type: 'check_mailed', ts: p.mailedAt.toISOString(), title: 'Check mailed', amountCents: p.totalCents.toString() });
      }
      if (p.status === PayoutStatus.paid && p.paidAt) {
        items.push({ id: `paid:${p.id}`, type: 'check_paid', ts: p.paidAt.toISOString(), title: 'Check paid', amountCents: p.totalCents.toString() });
      }
    }

    // (ts, id) desc siralama — kararlı: ts esitse id ile tie-break.
    items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

    // cursor: "<ts>|<id>" — bu anahtardan KESIN kucuk olan ilk sayfa disi eleman.
    let start = 0;
    if (q.cursor) {
      const bar = q.cursor.lastIndexOf('|');
      const curTs = q.cursor.slice(0, bar);
      const curId = q.cursor.slice(bar + 1);
      start = items.findIndex((it) => it.ts < curTs || (it.ts === curTs && it.id < curId));
      if (start < 0) start = items.length;
    }

    const page = items.slice(start, start + ACTIVITY_PAGE_SIZE);
    const last = page[page.length - 1];
    const hasMore = start + ACTIVITY_PAGE_SIZE < items.length;
    const nextCursor = hasMore && last ? `${last.ts}|${last.id}` : null;
    return { items: page, nextCursor };
  }
}
```

- [ ] **Step 3: Run lint to verify it compiles.**
  - Command: `pnpm --filter @refearn/api lint`
  - Expected: passes (module wiring in Task 6; service/types compile standalone).

- [ ] **Step 4: Commit.**
  - `git add apps/api/src/activity/activity.types.ts apps/api/src/activity/activity.service.ts && git commit -m "feat(activity): derive-on-read feed service + ActivityItem contract"`

---

### Task 6: Activity feed — controller + module wiring (backend)

**Files:**
- Create: `apps/api/src/activity/activity.controller.ts`
- Create: `apps/api/src/activity/activity.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the controller.** Create `apps/api/src/activity/activity.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, RequireMembership } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActivityService } from './activity.service';
import { activityQuerySchema, ActivityQuery } from './activity.types';

/** Uye aktivite akisi (/app/activity). Aktif uyelik gerekli; her zaman KENDI verisi. */
@RequireMembership()
@Controller('app/activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  feed(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(activityQuerySchema)) q: ActivityQuery) {
    return this.activity.feed(user.mid as string, user.tid as string, q);
  }
}
```

- [ ] **Step 2: Write the module.** Create `apps/api/src/activity/activity.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

@Module({
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}
```

- [ ] **Step 3: Register the module.** In `apps/api/src/app.module.ts`, add the import and include `ActivityModule` in the `@Module({ imports: [...] })` array (place it alongside `WalletModule` / `FraudModule` — order is not significant):

```ts
import { ActivityModule } from './activity/activity.module';
```

- [ ] **Step 4: Run lint to verify wiring compiles.**
  - Command: `pnpm --filter @refearn/api lint`
  - Expected: passes.

- [ ] **Step 5: Commit.**
  - `git add apps/api/src/activity/activity.controller.ts apps/api/src/activity/activity.module.ts apps/api/src/app.module.ts && git commit -m "feat(activity): GET /app/activity controller + module wiring"`

---

### Task 7: Activity feed — integration tests (backend)

**Files:**
- Test: `apps/api/test/activity.int-spec.ts` (create)

- [ ] **Step 1: Write the failing test.** Create `apps/api/test/activity.int-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LedgerStatus, LedgerType, PayoutMethod, PayoutStatus, Role, SaleStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createTenant, truncateAll } from './helpers';

/** Feature-gap #7 — activity feed: source coverage, time order, privacy scoping, cursor. */
describe('activity feed (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  function tokenFor(o: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const p: AccessTokenPayload = { sub: o.userId, mid: o.membershipId, tid: o.tenantId, role: o.role };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }
  const srv = () => app.getHttpServer();

  it('returns items from each source in correct (desc) time order; direct join shows a name', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [me, recruit] = await createChain(prisma, tenant.id, 2);

    const t = (iso: string) => new Date(iso);
    await prisma.membership.update({ where: { id: recruit.id }, data: { joinedAt: t('2026-06-01T10:00:00Z') } });
    await prisma.sale.create({ data: { tenantId: tenant.id, sellerMembershipId: me.id, amountCents: 100_000n, saleDate: t('2026-06-02T00:00:00Z'), status: SaleStatus.approved, approvedAt: t('2026-06-02T12:00:00Z') } });
    await prisma.ledgerEntry.create({ data: { tenantId: tenant.id, saleId: null, beneficiaryMembershipId: me.id, level: 0, rateBpsUsed: 500, amountCents: 5_000n, type: LedgerType.commission, status: LedgerStatus.payable, summaryMonth: '2026-06', createdAt: t('2026-06-03T09:00:00Z') } });
    await prisma.payout.create({ data: { tenantId: tenant.id, membershipId: me.id, totalCents: 5_000n, method: PayoutMethod.check, status: PayoutStatus.paid, period: '2026-06', mailedAt: t('2026-06-04T08:00:00Z'), paidAt: t('2026-06-05T08:00:00Z') } });

    const tok = tokenFor({ userId: me.userId, membershipId: me.id, tenantId: tenant.id, role: Role.member });
    const res = await request(srv()).get('/v1/app/activity').set('Authorization', `Bearer ${tok}`).expect(200);

    const types = res.body.items.map((i: { type: string }) => i.type);
    // desc by ts: check_paid(6-5) > check_mailed(6-4) > commission(6-3) > sale(6-2) > join(6-1)
    expect(types).toEqual(['check_paid', 'check_mailed', 'commission_credited', 'sale_approved', 'team_join']);
    const join = res.body.items.find((i: { type: string }) => i.type === 'team_join');
    expect(join.subject).toBe((await prisma.user.findUniqueOrThrow({ where: { id: recruit.userId } })).fullName);
    expect(join.title).toMatch(/joined your team/);
  });

  it('privacy: a DEEP downline join (2 levels) does NOT appear in my feed', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [me, direct, grandchild] = await createChain(prisma, tenant.id, 3);

    const tok = tokenFor({ userId: me.userId, membershipId: me.id, tenantId: tenant.id, role: Role.member });
    const res = await request(srv()).get('/v1/app/activity').set('Authorization', `Bearer ${tok}`).expect(200);
    const joinIds = res.body.items.filter((i: { type: string }) => i.type === 'team_join').map((i: { id: string }) => i.id);
    expect(joinIds).toContain(`join:${direct.id}`);
    expect(joinIds).not.toContain(`join:${grandchild.id}`);
  });

  it('cursor pagination is stable: page1 + page2 = all items, no overlap', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [me] = await createChain(prisma, tenant.id, 1);
    for (let i = 0; i < 25; i++) {
      await prisma.ledgerEntry.create({ data: { tenantId: tenant.id, saleId: null, beneficiaryMembershipId: me.id, level: 0, rateBpsUsed: 0, amountCents: 100n, type: LedgerType.commission, status: LedgerStatus.payable, summaryMonth: '2026-06', createdAt: new Date(Date.UTC(2026, 5, 1, 0, 0, i)) } });
    }
    const tok = tokenFor({ userId: me.userId, membershipId: me.id, tenantId: tenant.id, role: Role.member });
    const p1 = (await request(srv()).get('/v1/app/activity').set('Authorization', `Bearer ${tok}`).expect(200)).body;
    expect(p1.items).toHaveLength(20);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await request(srv()).get(`/v1/app/activity?cursor=${encodeURIComponent(p1.nextCursor)}`).set('Authorization', `Bearer ${tok}`).expect(200)).body;
    expect(p2.items).toHaveLength(5);
    expect(p2.nextCursor).toBeNull();
    const ids = new Set([...p1.items, ...p2.items].map((i: { id: string }) => i.id));
    expect(ids.size).toBe(25);
  });

  it('tenant isolation: another tenant\'s activity never leaks', async () => {
    const t1 = await createTenant(prisma);
    await createPlan(prisma, t1.id);
    const [me] = await createChain(prisma, t1.id, 1);
    const t2 = await createTenant(prisma);
    await createPlan(prisma, t2.id);
    const [other] = await createChain(prisma, t2.id, 1);
    await prisma.ledgerEntry.create({ data: { tenantId: t2.id, saleId: null, beneficiaryMembershipId: other.id, level: 0, rateBpsUsed: 0, amountCents: 999n, type: LedgerType.commission, status: LedgerStatus.payable, summaryMonth: '2026-06' } });

    const tok = tokenFor({ userId: me.userId, membershipId: me.id, tenantId: t1.id, role: Role.member });
    const res = await request(srv()).get('/v1/app/activity').set('Authorization', `Bearer ${tok}`).expect(200);
    expect(res.body.items).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then passes.**
  - Command: `pnpm --filter @refearn/api test:int -- activity.int-spec`
  - Expected: before Tasks 5–6 it 404s; after Tasks 5–6 it passes. If any case fails on ordering, re-check the `(ts,id)` sort/tie-break in `activity.service.ts`.

- [ ] **Step 3: Commit.**
  - `git add apps/api/test/activity.int-spec.ts && git commit -m "test(activity): source coverage, privacy scoping, cursor stability, tenant isolation"`

---

### Task 8: `statusBadge` helper + ImportWizard duplicate variant (web)

**Files:**
- Modify: `apps/web/src/lib/format.ts`
- Modify: `apps/web/src/components/ImportWizard.tsx`

- [ ] **Step 1: Add the `statusBadge` helper.** In `apps/web/src/lib/format.ts`, append:

```ts
/**
 * Domain status → guvenli `.badge` modifier sinifi. Bilinmeyen statu (or. 'suspended')
 * icin renksiz pill yerine 'draft' fallback'i verir. (Tam rollout ayri design-system
 * track'inde; burada yalniz dokundugumuz rozetleri gecireriz.)
 */
export function statusBadge(status: string): string {
  const known = new Set([
    'draft', 'approved', 'void', 'active', 'inactive', 'pending', 'payable', 'paid',
    'requested', 'processing', 'failed', 'rejected', 'cleared', 'confirmed', 'open', 'used', 'expired',
    'duplicate', 'error', 'ok',
  ]);
  const s = (status ?? '').toLowerCase();
  return `badge ${known.has(s) ? s : 'draft'}`;
}
```

- [ ] **Step 2: Update ImportWizard to the new preview shape.** In `apps/web/src/components/ImportWizard.tsx`:

  (2a) Replace the `PreviewRow` / `PreviewResp` interfaces:

```ts
interface PreviewRow { line: number; status: 'ok' | 'duplicate' | 'error'; code: string; amountCents?: string; saleDate?: string; sellerName?: string; reason?: string }
interface PreviewResp { preview: true; okCount: number; duplicateCount: number; errorCount: number; rows: PreviewRow[] }
```

  (2b) Add to the existing top imports:

```ts
import { statusBadge } from '@/lib/format';
```

  (2c) Replace the preview summary row (the `<div className="row" style={{ gap: 16, marginBottom: 12 }}>` block) with a three-way summary:

```tsx
            <div className="row" style={{ gap: 16, marginBottom: 12 }}>
              <span className={statusBadge('active')}>{preview.okCount} ready</span>
              {preview.duplicateCount > 0 && <span className={statusBadge('pending')}>{preview.duplicateCount} duplicates skipped</span>}
              {preview.errorCount > 0 && <span className={statusBadge('failed')}>{preview.errorCount} errors</span>}
            </div>
```

  (2d) Replace the per-row seller/error `<td>`:

```tsx
                      <td>
                        {r.status === 'ok' && <span style={{ color: 'var(--emerald)' }}>{r.sellerName}</span>}
                        {r.status === 'duplicate' && <span style={{ color: 'var(--amber)', fontSize: 12 }}>{r.reason ?? 'duplicate — skipped'}</span>}
                        {r.status === 'error' && <span style={{ color: 'var(--rose)', fontSize: 12 }}>{r.reason}</span>}
                      </td>
```

  (2e) Change the amount cell to key off the discriminator:

```tsx
                      <td className="tnum">{r.status !== 'error' && r.amountCents ? `$${(Number(r.amountCents) / 100).toLocaleString('en-US')}` : '—'}</td>
```

  (2f) The confirm button already disables on `preview?.okCount === 0` and its label reads `Import ${preview?.okCount ?? 0} sales` — now correct because duplicates are excluded from `okCount`. Leave it as-is.

- [ ] **Step 3: Type-check.**
  - Command: `pnpm --filter @refearn/web lint`
  - Expected: passes (no `PreviewRow.ok` references remain).

- [ ] **Step 4: Manual verification (record in the PR).**
  1. `pnpm dev:api` + `pnpm dev:web`; sign in as an admin (seed owner).
  2. Sales → Import wizard → paste a CSV with two rows sharing one `external_ref` and one already-imported ref. Preview shows "N ready · M duplicates skipped · K errors"; duplicate rows render amber "duplicate — skipped".
  3. Import → only the ready count is created; re-open with the same CSV → all rows show duplicate and the button reads `Import 0 sales` (disabled).

- [ ] **Step 5: Commit.**
  - `git add apps/web/src/lib/format.ts apps/web/src/components/ImportWizard.tsx && git commit -m "feat(web): statusBadge helper + ImportWizard duplicate variant/summary"`

---

### Task 9: Payouts UI — mandatory reject reason (web)

**Files:**
- Modify: `apps/web/src/app/admin/payouts/page.tsx`

- [ ] **Step 1: Per-request reject modal — label + disable.** In the `{decide && ( ... )}` modal:

  (1a) Change the label line so reject reads "required":

```tsx
              <label>{decide.action === 'approve' ? 'Bank / transfer reference (optional)' : 'Reason (required)'}</label>
```

  (1b) Replace the submit button so reject is disabled until ≥3 chars:

```tsx
              <button
                className={`btn ${decide.action === 'reject' ? 'danger' : 'success'}`}
                onClick={submitDecide}
                disabled={busy || (decide.action === 'reject' && decideRef.trim().length < 3)}
              >
                {busy ? '…' : decide.action === 'approve' ? 'Approve & mark paid' : 'Reject'}
              </button>
```

- [ ] **Step 2: Batch reject must collect a reason.** Replace the `decideBatch` function so reject routes through the existing `reasonModal`:

```tsx
  async function decideBatch(id: string, action: 'approve' | 'reject') {
    if (action === 'reject') {
      setReasonText('');
      setReasonModal({
        title: 'Reject payout batch',
        label: 'Reason (required)',
        run: async (reason) => {
          if (reason.trim().length < 3) throw new Error('Reason is required (min 3 characters).');
          await api.post(`/admin/payouts/batches/${id}/reject`, { reason: reason.trim() });
          showToast('Batch rejected');
          await refreshAll();
        },
      });
      return;
    }
    if (busyId) return;
    setBusyId(id);
    try {
      await api.post(`/admin/payouts/batches/${id}/approve`);
      showToast('Batch approved & paid ✓');
      await refreshAll();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusyId(null); }
  }
```

  The generic `reasonModal` block already exists at the bottom of the component and surfaces thrown errors, so a `<3` reason keeps the modal open with the error shown.

- [ ] **Step 3: Type-check.**
  - Command: `pnpm --filter @refearn/web lint`
  - Expected: passes.

- [ ] **Step 4: Manual verification.**
  1. Open a `requested` payout → Reject: the button is disabled until ≥3 chars.
  2. With maker-checker enabled (Settings → General → "Maker-checker"), propose a batch as one admin, then as a second admin click Reject → a reason modal appears; empty/short reason is refused; a valid reason rejects and each targeted member gets an in-app notification.

- [ ] **Step 5: Commit.**
  - `git add apps/web/src/app/admin/payouts/page.tsx && git commit -m "feat(web): require a reason for per-request + batch payout rejects"`

---

### Task 10: Unsaved-changes guard — hook + SaveBar + SettingsSection (web)

**Files:**
- Create: `apps/web/src/hooks/useDirty.ts`
- Create: `apps/web/src/components/SaveBar.tsx`
- Create: `apps/web/src/components/SettingsSection.tsx`

- [ ] **Step 1: Create the dirty hook.** Create `apps/web/src/hooks/useDirty.ts`:

```ts
import { useEffect, useMemo, useState } from 'react';

/** Stabil deep-equal (JSON round-trip yeterli: form slice'lari plain object/array/number/string/bool). */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * `current`i son yuklenen `baseline` ile karsilastirir. Yalniz DUZENLENEBILIR form slice'i
 * gecirilmeli (sunucu-eklentili alanlar disarida) — aksi halde her yuklemede kirli gorunur.
 * Baseline'i basarili save sonrasi setBaseline ile guncelle.
 */
export function useDirty<T>(current: T, initialBaseline: T): {
  dirty: boolean;
  baseline: T;
  setBaseline: (next: T) => void;
} {
  const [baseline, setBaseline] = useState<T>(initialBaseline);
  const dirty = useMemo(() => !deepEqual(current, baseline), [current, baseline]);

  // Tarayici kapatma/yenileme guardi — yalniz kirliyken.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return { dirty, baseline, setBaseline };
}
```

- [ ] **Step 2: Create the SaveBar.** Create `apps/web/src/components/SaveBar.tsx`:

```tsx
'use client';

/** Sticky "Unsaved changes" cubugu: Save / Discard. dirty=false iken hicbir sey gostermez. */
export function SaveBar({
  dirty,
  busy,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  busy?: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!dirty) return null;
  return (
    <div
      className="card"
      role="region"
      aria-label="Unsaved changes"
      style={{
        position: 'sticky',
        bottom: 12,
        zIndex: 20,
        marginTop: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        borderColor: 'var(--gold-500)',
        boxShadow: '0 6px 24px rgba(0,0,0,.25)',
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600 }}>Unsaved changes</span>
      <div className="row" style={{ gap: 10 }}>
        <button className="btn ghost sm" onClick={onDiscard} disabled={busy}>Discard</button>
        <button className="btn sm" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the SettingsSection wrapper.** Create `apps/web/src/components/SettingsSection.tsx`:

```tsx
'use client';

import { ReactNode } from 'react';

/** Ayar sekmelerinde tutarsiz 560/620/640/680 genisliklerini normalize eden ince sarmalayici. */
export function SettingsSection({ maxWidth = 620, children }: { maxWidth?: number; children: ReactNode }) {
  return <div style={{ maxWidth }}>{children}</div>;
}
```

- [ ] **Step 4: Type-check.**
  - Command: `pnpm --filter @refearn/web lint`
  - Expected: passes.

- [ ] **Step 5: Commit.**
  - `git add apps/web/src/hooks/useDirty.ts apps/web/src/components/SaveBar.tsx apps/web/src/components/SettingsSection.tsx && git commit -m "feat(web): useDirty hook + SaveBar + SettingsSection primitives"`

---

### Task 11: Apply the unsaved-changes guard to General settings (web, reference impl)

Wire the guard into `General.tsx` as the canonical example; the same pattern applies to Brand/Plan/Reports/Ranks (call out in the PR that those tabs adopt it next).

**Files:**
- Modify: `apps/web/src/app/admin/settings/sections/General.tsx`

- [ ] **Step 1: Wire `useDirty` + `SaveBar` + `SettingsSection`.**

  (1a) Add imports:

```ts
import { useDirty } from '@/hooks/useDirty';
import { SaveBar } from '@/components/SaveBar';
import { SettingsSection } from '@/components/SettingsSection';
```

  (1b) After `const [busy, setBusy] = useState(false);`, add the editable slice + hook:

```ts
  // yalniz DUZENLENEBILIR alanlar dirty karsilastirmasina girer (read-only name/slug/currency haric)
  const editable = s && {
    timezone: s.timezone,
    maturationRule: s.maturationRule,
    maturationDays: s.maturationDays,
    payoutMinCents: s.payoutMinCents,
    notifyNewMemberName: s.notifyNewMemberName,
    compressionEnabled: s.compressionEnabled,
    inactiveMembersEarn: s.inactiveMembersEarn,
    requireSeparateApprover: s.requireSeparateApprover,
    requireKycForPayout: s.requireKycForPayout,
    requirePayoutApproval: s.requirePayoutApproval,
    autoRequestPayouts: s.autoRequestPayouts,
  };
  const { dirty, setBaseline } = useDirty(editable ?? null, null);
```

  (1c) Change the load effect to seed the baseline once loaded:

```ts
  useEffect(() => {
    api.get<Settings>('/admin/settings').then((res) => {
      setS(res);
      setBaseline({
        timezone: res.timezone,
        maturationRule: res.maturationRule,
        maturationDays: res.maturationDays,
        payoutMinCents: res.payoutMinCents,
        notifyNewMemberName: res.notifyNewMemberName,
        compressionEnabled: res.compressionEnabled,
        inactiveMembersEarn: res.inactiveMembersEarn,
        requireSeparateApprover: res.requireSeparateApprover,
        requireKycForPayout: res.requireKycForPayout,
        requirePayoutApproval: res.requirePayoutApproval,
        autoRequestPayouts: res.autoRequestPayouts,
      });
    }).catch((e) => setError(String((e as ApiError).message)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

  (1d) In `save()`, after `setS(res);`, reset the baseline:

```ts
      setBaseline({
        timezone: res.timezone,
        maturationRule: res.maturationRule,
        maturationDays: res.maturationDays,
        payoutMinCents: res.payoutMinCents,
        notifyNewMemberName: res.notifyNewMemberName,
        compressionEnabled: res.compressionEnabled,
        inactiveMembersEarn: res.inactiveMembersEarn,
        requireSeparateApprover: res.requireSeparateApprover,
        requireKycForPayout: res.requireKycForPayout,
        requirePayoutApproval: res.requirePayoutApproval,
        autoRequestPayouts: res.autoRequestPayouts,
      });
```

  (1e) Add a `discard()` that reloads the last-saved settings:

```ts
  function discard() {
    api.get<Settings>('/admin/settings').then((res) => setS(res)).catch((e) => setError(String((e as ApiError).message)));
  }
```

  (1f) Wrap the returned form in `<SettingsSection>` and mount `<SaveBar>`. Change the opening line:

```tsx
    <SettingsSection maxWidth={620}>
      <form className="grid" onSubmit={save} style={{ gap: 18 }}>
```
  and before the final `</form>` (right after the existing `<div className="row"><button ...>Save changes</button></div>` line) add:

```tsx
        <SaveBar dirty={dirty} busy={busy} onSave={() => save(new Event('submit') as unknown as FormEvent)} onDiscard={discard} />
```
  then close with `</form></SettingsSection>` instead of the single `</form>`.

- [ ] **Step 2: Type-check.**
  - Command: `pnpm --filter @refearn/web lint`
  - Expected: passes. If `save(new Event(...))` typing complains, keep the shown cast (the handler only calls `e.preventDefault()`).

- [ ] **Step 3: Manual verification.**
  1. Settings → General; change the payout threshold → the sticky "Unsaved changes" bar appears.
  2. Click Discard → the field reverts and the bar disappears.
  3. Change a toggle, then reload the tab → the native "Leave site?" prompt fires (proves `beforeunload`). Cancel, click Save → bar disappears; reloading no longer prompts.

- [ ] **Step 4: Commit.**
  - `git add apps/web/src/app/admin/settings/sections/General.tsx && git commit -m "feat(web): unsaved-changes guard on General settings (reference impl)"`

---

### Task 12: Plan-simulator UI wiring (web)

Replace the fake client-side `$1,000` preview with the real `POST /admin/plans/simulate`, add an amount input + optional seller picker (reuse `GET /admin/members?search=`).

**Files:**
- Modify: `apps/web/src/app/admin/settings/sections/Plan.tsx`

Confirmed request shape (`simulatePlanSchema`): `{ amountCents: number (int, positive), sellerMembershipId?: uuid }`. Response (`plans.service.simulate`): `{ planName, poolRateBps, depth, amountCents: string, levels: Array<{ level, rateBps, amountCents: string, beneficiary: { name, code } | null, retainedByCompany: boolean }>, distributedCents: string, companyKeepsCents: string }`. Members list item shape: `{ membershipId, fullName, referralCode, ... }` from `GET /admin/members?search=<q>`.

- [ ] **Step 1: Add simulator types.** Add near the existing interfaces:

```ts
interface SimLevel { level: number; rateBps: number; amountCents: string; beneficiary: { name: string; code: string } | null; retainedByCompany: boolean }
interface SimResult { planName: string; poolRateBps: number; depth: number; amountCents: string; levels: SimLevel[]; distributedCents: string; companyKeepsCents: string }
interface MemberHit { membershipId: string; fullName: string; referralCode: string }
```

- [ ] **Step 2: Replace the fake preview with a real simulate call.** Remove the `PREVIEW_CENTS` constant, the two `useMemo` preview computations (`preview` and `previewTotal`), and add simulator state + functions inside the component:

```ts
  const [simDollars, setSimDollars] = useState('1000');
  const [sellerQuery, setSellerQuery] = useState('');
  const [sellerHits, setSellerHits] = useState<MemberHit[]>([]);
  const [seller, setSeller] = useState<MemberHit | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [simError, setSimError] = useState('');

  // dolar -> cent (float'siz, iki ondaliga kadar)
  function dollarsToCents(v: string): number {
    const s = v.replace(/[$\s,]/g, '');
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return NaN;
    const dot = s.indexOf('.');
    const whole = dot === -1 ? s : s.slice(0, dot);
    const frac = dot === -1 ? '' : s.slice(dot + 1);
    return parseInt(whole || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
  }

  async function searchSellers(q: string) {
    setSellerQuery(q);
    if (q.trim().length < 2) { setSellerHits([]); return; }
    try {
      const res = await api.get<{ items: MemberHit[] }>(`/admin/members?search=${encodeURIComponent(q.trim())}&pageSize=8`);
      setSellerHits(res.items);
    } catch { setSellerHits([]); }
  }

  async function runSimulate() {
    const cents = dollarsToCents(simDollars);
    if (!Number.isFinite(cents) || cents <= 0) { setSimError('Enter a positive amount.'); return; }
    if (cents > 1_000_000_000) { setSimError('Amount too large.'); return; }
    setSimBusy(true); setSimError('');
    try {
      const res = await api.post<SimResult>('/admin/plans/simulate', {
        amountCents: cents,
        ...(seller ? { sellerMembershipId: seller.membershipId } : {}),
      });
      setSim(res);
    } catch (e) { setSimError(String((e as ApiError).message)); } finally { setSimBusy(false); }
  }
```

- [ ] **Step 3: Render the simulator card.** Replace the old `$1,000` preview card with:

```tsx
        <div className="card" style={{ background: 'var(--panel-2)', marginTop: 12, padding: 12 }}>
          <strong style={{ fontSize: 13 }}>Commission simulator</strong>
          <div className="faint" style={{ fontSize: 11, marginBottom: 8 }}>
            Uses the active plan + real upline chain. Pick a seller to resolve who actually receives each tier; leave empty for a full-depth hypothetical.
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Sale amount ($)</label>
              <input value={simDollars} onChange={(e) => setSimDollars(e.target.value)} inputMode="decimal" style={{ width: 130 }} />
            </div>
            <div className="field" style={{ margin: 0, position: 'relative', flex: 1, minWidth: 200 }}>
              <label>Seller (optional)</label>
              {seller ? (
                <div className="row" style={{ gap: 8 }}>
                  <span className="badge active">{seller.fullName} · {seller.referralCode}</span>
                  <button className="btn ghost sm" onClick={() => { setSeller(null); setSellerQuery(''); setSellerHits([]); }}>✕</button>
                </div>
              ) : (
                <>
                  <input value={sellerQuery} onChange={(e) => searchSellers(e.target.value)} placeholder="Search name or code…" />
                  {sellerHits.length > 0 && (
                    <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, maxHeight: 200, overflow: 'auto', padding: 4 }}>
                      {sellerHits.map((h) => (
                        <button key={h.membershipId} className="btn ghost sm" style={{ display: 'block', width: '100%', textAlign: 'left' }}
                          onClick={() => { setSeller(h); setSellerHits([]); setSellerQuery(''); }}>
                          {h.fullName} <span className="faint">· {h.referralCode}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <button className="btn" onClick={runSimulate} disabled={simBusy}>{simBusy ? 'Simulating…' : 'Simulate'}</button>
          </div>
          {simError && <div className="error" style={{ marginTop: 10 }}>{simError}</div>}
          {sim && (
            <div style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th>Tier</th><th>Beneficiary</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {sim.levels.map((l) => (
                    <tr key={l.level}>
                      <td>{levelLabel(l.level)}</td>
                      <td className="faint" style={{ fontSize: 12 }}>
                        {l.beneficiary ? `${l.beneficiary.name} · ${l.beneficiary.code}` : l.retainedByCompany ? 'Company (no upline)' : '—'}
                      </td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{(l.rateBps / 100).toFixed(2)}%</td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{money(l.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row spread" style={{ marginTop: 8 }}>
                <span className="faint" style={{ fontSize: 12 }}>Distributed {money(sim.distributedCents)} · Company keeps {money(sim.companyKeepsCents)}</span>
                <strong className="tnum" style={{ color: 'var(--gold-500)' }}>{money(sim.amountCents)}</strong>
              </div>
            </div>
          )}
        </div>
```

  Also remove the now-unused `<td className="tnum" style={{ textAlign: 'right' }}>{money(preview[i]?.amountCents ?? 0)}</td>` cell in the editable levels table and its `<th>On a $1,000 sale</th>` header so that table shows only Tier / Rate / remove-action.

- [ ] **Step 4: Type-check.**
  - Command: `pnpm --filter @refearn/web lint`
  - Expected: passes; no `PREVIEW_CENTS`/`preview` leftovers.

- [ ] **Step 5: Manual verification.**
  1. Settings → Commission plan. Enter `1000`, no seller → Simulate: the table shows every tier's hypothetical amount and "Distributed / Company keeps" totals from the server.
  2. Type ≥2 chars in the seller box → the dropdown lists matches; pick one → Simulate resolves real upline names; tiers with no upline show "Company (no upline)".
  3. Enter `0` or a huge amount → inline error; no bad request is sent / server rejects.

- [ ] **Step 6: Commit.**
  - `git add apps/web/src/app/admin/settings/sections/Plan.tsx && git commit -m "feat(web): wire plan simulator to POST /admin/plans/simulate with seller picker"`

---

### Task 13: Share presets on the invite screen (web)

**Files:**
- Modify: `apps/web/src/app/app/invite/page.tsx`

- [ ] **Step 1: Add a `ShareButtons` component at the bottom of the file:**

```tsx
function ShareButtons({ url, message }: { url: string; message: string }) {
  const text = (message.trim() || 'Join my team and start earning together.') + ' ' + url;
  const enc = encodeURIComponent;
  const canWebShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  // sms: yalniz dokunmatik/mobil ortamda anlamli — kaba tespit (desktop'ta gizle)
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  async function webShare() {
    try { await navigator.share({ text: message.trim() || undefined, url }); } catch { /* kullanici iptal etti */ }
  }

  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 14 }}>
      {canWebShare && <button className="btn sm" onClick={webShare}>Share…</button>}
      {isMobile && <a className="btn ghost sm" href={`sms:?&body=${enc(text)}`}>SMS</a>}
      <a className="btn ghost sm" href={`mailto:?subject=${enc('Join my team')}&body=${enc(text)}`}>Email</a>
      <a className="btn ghost sm" href={`https://wa.me/?text=${enc(text)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
      <a className="btn ghost sm" href={`https://x.com/intent/tweet?text=${enc(text)}`} target="_blank" rel="noopener noreferrer">X</a>
    </div>
  );
}
```

- [ ] **Step 2: Render it under the QR/link block.** In the `latest` branch of the QR card (after the `New invite` button, still inside the `<>...</>`), add:

```tsx
            <ShareButtons url={linkFor(latest)} message={message} />
```

  `message` and `linkFor` are already in scope.

- [ ] **Step 3: Type-check.**
  - Command: `pnpm --filter @refearn/web lint`
  - Expected: passes.

- [ ] **Step 4: Manual verification.**
  1. Member app → Invite. With an active link, the share row shows Email / WhatsApp / X (and SMS on a mobile UA, and a native "Share…" button where `navigator.share` exists).
  2. Click Email → the mail client opens with subject + URL-encoded body containing the welcome message and the link. Clear the message and re-check → a sensible default share text is used.
  3. Emulate a mobile device/UA → SMS appears and `sms:?&body=` is populated.

- [ ] **Step 5: Commit.**
  - `git add apps/web/src/app/app/invite/page.tsx && git commit -m "feat(web): invite share presets (Web Share + SMS/email/WhatsApp/X)"`

---

### Task 14: Fraud triage screen — nav + i18n (web)

**Files:**
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/app/admin/layout.tsx`

- [ ] **Step 1: Add the nav label.** In `apps/web/src/lib/i18n.ts`, add inside the `en` object next to the other nav keys:

```ts
  'nav.fraud': 'Fraud',
```
  If a `tr` map mirrors these keys in the same file, add `'nav.fraud': 'Dolandırıcılık',` there too so `t()` never falls back.

- [ ] **Step 2: Add the perm-gated nav item.** In `apps/web/src/app/admin/layout.tsx`, add to the `NAV` array (after the `payouts` entry, before `checks`):

```ts
  { href: '/admin/fraud', key: 'nav.fraud', ic: '⚠', adminOnly: true },
```

  This reuses the existing `NAV.filter((n) => !(n.adminOnly && isStaff))` render filter, so staff never see it and admins do.

- [ ] **Step 3: Type-check.**
  - Command: `pnpm --filter @refearn/web lint`
  - Expected: passes (route target created in Task 15; a `<Link>` to a not-yet-existing route still type-checks).

- [ ] **Step 4: Commit.**
  - `git add apps/web/src/lib/i18n.ts apps/web/src/app/admin/layout.tsx && git commit -m "feat(web): add perm-gated Fraud nav item + i18n label"`

---

### Task 15: Fraud triage screen — page (web)

Build the triage queue using the ready endpoints: `GET /admin/fraud?status=`, `POST /admin/fraud/scan`, `POST /admin/fraud/:membershipId/decide` (`{ action: 'clear'|'confirm', note? }`). The backend `decide` supports only `clear`/`confirm` (per `decideFraudSchema`), so the screen offers Clear / Confirm — each through a note modal.

**Files:**
- Create: `apps/web/src/app/admin/fraud/page.tsx`

Component contract: a client page component (default export, no props) that loads flags via `GET /admin/fraud?status=<filter>` into `FraudFlag[]`, renders a status filter, a "Scan now" button (`POST /admin/fraud/scan`), and a table (member, score+blocked pill, reasons, status, actions); per row Clear/Confirm each open a note modal that posts the decision; links each member to `/admin/members#<membershipId>`; shows an empty state.

- [ ] **Step 1: Write the page.** Create `apps/web/src/app/admin/fraud/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Loading, Modal, useToast } from '@/components/ui';
import { statusBadge } from '@/lib/format';
import { t } from '@/lib/i18n';

interface FraudFlag {
  membershipId: string; fullName: string; email: string; referralCode: string;
  score: number; reasons: string[]; status: string; note: string | null; blocked: boolean; createdAt: string;
}

const FILTERS = ['', 'open', 'confirmed', 'cleared'] as const;

export default function FraudPage() {
  const [rows, setRows] = useState<FraudFlag[] | null>(null);
  const [filter, setFilter] = useState<string>('open');
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decide, setDecide] = useState<{ f: FraudFlag; action: 'clear' | 'confirm' } | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const q = filter ? `?status=${filter}` : '';
      setRows(await api.get<FraudFlag[]>(`/admin/fraud${q}`));
    } catch (e) { setError(String((e as ApiError).message)); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  async function scan() {
    setScanning(true); setError('');
    try {
      const r = await api.post<{ flagged: number; blocked: number }>('/admin/fraud/scan');
      showToast(`Scan done — ${r.flagged} flagged, ${r.blocked} blocked`);
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setScanning(false); }
  }

  async function submitDecide() {
    if (!decide) return;
    setBusyId(decide.f.membershipId); setError('');
    try {
      await api.post(`/admin/fraud/${decide.f.membershipId}/decide`, {
        action: decide.action,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      showToast(decide.action === 'clear' ? 'Cleared ✓' : 'Confirmed');
      setDecide(null); setNote('');
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusyId(null); }
  }

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.fraud')}</div>
      <h1 className="h1 fade-in">Fraud Triage</h1>
      <p className="sub fade-in">Review risk-flagged members. Cleared members can be paid; confirmed members stay held.</p>
      {error && <div className="error">{error}</div>}

      <div className="card fade-in delay-1" style={{ marginBottom: 16 }}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="faint" style={{ fontSize: 12 }}>Status</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }} aria-label="Status filter">
              {FILTERS.map((s) => <option key={s} value={s}>{s || 'All'}</option>)}
            </select>
          </div>
          <button className="btn ghost" onClick={scan} disabled={scanning}>{scanning ? 'Scanning…' : '⚠ Scan now'}</button>
        </div>

        {!rows ? <Loading rows={3} /> : rows.length === 0 ? (
          <div className="muted" style={{ textAlign: 'center', padding: '28px 0' }}>
            No members flagged.<br />
            <span className="faint" style={{ fontSize: 12.5 }}>Run a scan to re-evaluate risk signals.</span>
          </div>
        ) : (
          <table>
            <thead><tr><th>Member</th><th>Score</th><th>Signals</th><th>Status</th><th className="no-print" style={{ textAlign: 'right' }}>Decision</th></tr></thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.membershipId}>
                  <td>
                    <Link href={`/admin/members#${f.membershipId}`} style={{ color: 'var(--text)', fontWeight: 600 }}>{f.fullName}</Link>
                    <div className="faint" style={{ fontSize: 12 }}>{f.referralCode} · {f.email}</div>
                  </td>
                  <td><span className={statusBadge(f.blocked ? 'failed' : 'pending')}>{f.score}{f.blocked ? ' · blocked' : ''}</span></td>
                  <td className="faint" style={{ fontSize: 12 }}>{f.reasons.join(', ')}</td>
                  <td><span className={statusBadge(f.status)}>{f.status}</span>{f.note ? <div className="faint" style={{ fontSize: 11 }}>“{f.note}”</div> : null}</td>
                  <td className="no-print" style={{ textAlign: 'right' }}>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn success sm" disabled={busyId === f.membershipId} onClick={() => { setNote(''); setDecide({ f, action: 'clear' }); }}>Clear</button>
                      <button className="btn danger sm" disabled={busyId === f.membershipId} onClick={() => { setNote(''); setDecide({ f, action: 'confirm' }); }}>Confirm</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {decide && (
        <Modal title={decide.action === 'clear' ? 'Clear flag' : 'Confirm fraud'} onClose={() => setDecide(null)}>
          <div style={{ width: 'min(440px, 92vw)' }}>
            <p className="muted" style={{ marginTop: 0 }}>
              {decide.action === 'clear'
                ? `Clear ${decide.f.fullName}? They become payable again.`
                : `Confirm ${decide.f.fullName} as fraud? Their payouts stay held.`}
            </p>
            <div className="field">
              <label>Note (optional)</label>
              <textarea aria-label="Decision note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} autoFocus />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
              <button className="btn ghost" onClick={() => setDecide(null)} disabled={busyId === decide.f.membershipId}>Cancel</button>
              <button className={`btn ${decide.action === 'confirm' ? 'danger' : 'success'}`} onClick={submitDecide} disabled={busyId === decide.f.membershipId}>
                {busyId === decide.f.membershipId ? '…' : decide.action === 'clear' ? 'Clear' : 'Confirm fraud'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Repoint the dashboard to-do.** In `apps/api/src/reports/reports.service.ts`, change the `fraud_review` item's `href`:

```ts
      { key: 'fraud_review', label: 'Members flagged for review', count: fraudOpen, href: '/admin/fraud' },
```

- [ ] **Step 3: Type-check both packages.**
  - Command: `pnpm --filter @refearn/web lint && pnpm --filter @refearn/api lint`
  - Expected: both pass.

- [ ] **Step 4: Manual verification.**
  1. As an admin, open `/admin/fraud` (also reachable from the sidebar "Fraud" item). As `tenant_staff`, the nav item is hidden and the admin API returns 403.
  2. "Scan now" runs a scan and refreshes; flagged members list with score + blocked pill + signals.
  3. Clear/Confirm each open a note modal; submitting posts the note and updates the row. Empty state shows "No members flagged" when nothing matches.
  4. Admin dashboard → "Members flagged for review" to-do now links to `/admin/fraud`.

- [ ] **Step 5: Commit.**
  - `git add apps/web/src/app/admin/fraud/page.tsx apps/api/src/reports/reports.service.ts && git commit -m "feat(fraud): admin triage screen + repoint dashboard to-do to /admin/fraud"`

---

### Task 16: Activity feed component + Home wiring (web)

**Files:**
- Create: `apps/web/src/components/ActivityFeed.tsx`
- Modify: `apps/web/src/app/app/page.tsx`

Component contract: a client component (default export, no required props) that fetches `GET /app/activity`, groups items by day, renders a per-type icon + title (+ amount when present), supports "Load more" via `nextCursor`, and shows a teaching empty state.

- [ ] **Step 1: Write the component.** Create `apps/web/src/components/ActivityFeed.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading } from '@/components/ui';
import { money, dateShort } from '@/lib/format';

type ActivityType = 'team_join' | 'sale_approved' | 'commission_credited' | 'check_mailed' | 'check_paid';
interface ActivityItem { id: string; type: ActivityType; ts: string; title: string; amountCents?: string; subject?: string }
interface FeedResp { items: ActivityItem[]; nextCursor: string | null }

const ICON: Record<ActivityType, string> = {
  team_join: '⬡',
  sale_approved: '◇',
  commission_credited: '◆',
  check_mailed: '✉',
  check_paid: '✓',
};

/** Gunun anahtari (yerel) — gruplama basligi icin. */
function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function ActivityFeed() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');

  const loadFirst = useCallback(async () => {
    try {
      const res = await api.get<FeedResp>('/app/activity');
      setItems(res.items);
      setCursor(res.nextCursor);
    } catch (e) { setError(String((e as ApiError).message)); } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadFirst(); }, [loadFirst]);

  async function loadMore() {
    if (!cursor) return;
    setMore(true);
    try {
      const res = await api.get<FeedResp>(`/app/activity?cursor=${encodeURIComponent(cursor)}`);
      setItems((prev) => [...prev, ...res.items]);
      setCursor(res.nextCursor);
    } catch (e) { setError(String((e as ApiError).message)); } finally { setMore(false); }
  }

  if (loading) return <Loading rows={3} />;

  // gune gore grupla (sirali — feed zaten desc)
  const groups: Array<{ day: string; rows: ActivityItem[] }> = [];
  for (const it of items) {
    const day = dayKey(it.ts);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(it);
    else groups.push({ day, rows: [it] });
  }

  return (
    <div className="card fade-in delay-2" style={{ marginTop: 16 }}>
      <div className="spread" style={{ marginBottom: 12 }}>
        <strong>Activity</strong>
        <span className="faint" style={{ fontSize: 12 }}>Your recent team & earnings events</span>
      </div>
      {error && <div className="error">{error}</div>}
      {items.length === 0 ? (
        <div className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
          No activity yet.<br />
          <span className="faint" style={{ fontSize: 12.5 }}>Invite someone to get started — joins, approvals and payouts show up here.</span>
        </div>
      ) : (
        <div className="grid" style={{ gap: 14 }}>
          {groups.map((g) => (
            <div key={g.day}>
              <div className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{dateShort(g.day)}</div>
              <div className="grid" style={{ gap: 6 }}>
                {g.rows.map((it) => (
                  <div key={it.id} className="row spread" style={{ gap: 10 }}>
                    <span className="row" style={{ gap: 10 }}>
                      <span style={{ width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center', background: 'var(--panel-2)', fontSize: 12 }}>{ICON[it.type]}</span>
                      <span style={{ fontSize: 13.5 }}>{it.title}</span>
                    </span>
                    {it.amountCents && <span className="tnum" style={{ fontWeight: 650, color: 'var(--gold-500)' }}>{money(it.amountCents)}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {cursor && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 4 }}>
              <button className="btn ghost sm" onClick={loadMore} disabled={more}>{more ? 'Loading…' : 'Load more'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount it on Home.** In `apps/web/src/app/app/page.tsx`:

  (2a) Add the import near the other component imports:

```ts
import { ActivityFeed } from '@/components/ActivityFeed';
```

  (2b) Insert immediately before the final income-note div (`<div className="faint fade-in" style={{ fontSize: 11, marginTop: 16, ... }}>{t('me.incomeNote')}</div>`):

```tsx
      <ActivityFeed />
```

- [ ] **Step 3: Type-check.**
  - Command: `pnpm --filter @refearn/web lint`
  - Expected: passes.

- [ ] **Step 4: Manual verification.**
  1. Member Home shows an "Activity" card. For a member with recruits/approved sales/commissions/mailed checks, events appear grouped by day, newest first, with icons + amounts.
  2. For a brand-new member, the teaching empty state renders.
  3. With >20 events, "Load more" appends the next page and disappears when the cursor is exhausted; no duplicate rows.

- [ ] **Step 5: Commit.**
  - `git add apps/web/src/components/ActivityFeed.tsx apps/web/src/app/app/page.tsx && git commit -m "feat(web): member activity feed on Home (day-grouped, cursor paginated)"`

---

## Final verification (run before opening the PR)

- [ ] API tests + lint: `pnpm --filter @refearn/api test:int && pnpm --filter @refearn/api test && pnpm --filter @refearn/api lint`
- [ ] Web type-check: `pnpm --filter @refearn/web lint`
- [ ] Full monorepo build: `pnpm build`
- [ ] Re-run each task's manual verification steps once end-to-end.

---

## Self-review — spec coverage

Every item in `docs/superpowers/specs/2026-07-09-feature-gap-sprint-design.md` is covered, in the spec's money-safety-first sequence:

1. **Duplicate detection (🔴)** — Tasks 1–2. The partial unique index the spec asks for *already shipped* (`20260619183000_sales_external_ref_unique`), so no destructive re-migration; Task 1 adds the create-path `P2002`→409 (spec §1 "Create path"), import-preview dedup with a `duplicate` variant + skip-on-commit (spec §1 "Import preview"), covers file-vs-file and DB-vs-file cases, null/blank never collides, and the exact three spec integration cases (a/b/c). Task 2 documents the constraint in `schema.prisma`.
2. **Mandatory reject reason (🔴)** — Tasks 3–4. `decidePayoutSchema.superRefine` requires `ref` on reject (min 3), stays optional on approve (spec §2); `rejectBatch` gains a required `reason`, stores it in audit, and notifies each member (spec §2 "Batch"). Both spec integration cases (a per-request, b batch) included; a decision-gate note flags the notification-template choice.
3. **Unsaved-changes guard (🟡)** — Tasks 10–11. `useDirty(current, baseline)` compares only the editable slice (spec "ignore server-added fields"), `SaveBar` shows Save/Discard and resets baseline after save, `beforeunload` guards the browser exit, Discard restores the last-loaded baseline, and `SettingsSection maxWidth` normalizes the 560/620/640/680 widths (spec §3). Applied to General as the reference tab; PR notes Brand/Plan/Reports/Ranks adopt the same pattern. Verified via `tsc` + manual steps (no web runner yet).
4. **Plan-simulator wiring (🟡)** — Task 12. Replaces the fake client `$1,000` preview with `POST /admin/plans/simulate` (confirmed `simulatePlanSchema` shape: cents + optional seller), adds a dollars→cents amount input and a seller picker reusing `GET /admin/members?search=`, renders per-beneficiary tier/rate/amount + company-kept, with loading/error states and amount validation (spec §4).
5. **Share presets (🟡)** — Task 13. Feature-detects `navigator.share()` first on mobile, falls back to SMS/email/WhatsApp/X built from `linkFor(latest)` + the saved welcome message (URL-encoded), degrades SMS off desktop, uses a sensible default when the message is empty (spec §5).
6. **Fraud triage screen (🟠)** — Tasks 14–15. New perm-gated `/admin/fraud` route + nav item, triage table (member/score/reasons/status), "Scan now", per-item clear/confirm with a note modal (matching the real `decideFraudSchema` — clear/confirm only), cross-links to the members list, empty state, and repoints the dashboard `fraud_review` to-do to `/admin/fraud` (spec §6, `reports.service.ts:169`). Smoke coverage is the documented manual steps (no web runner).
7. **Activity feed (🟢 hybrid)** — Tasks 5–7 (backend) + 16 (frontend). `GET /app/activity?cursor=` derives a unified `(ts,id)`-desc feed from memberships (direct recruits by name), approved sales, commission ledger, and check mailed/paid — all tenant+member scoped, with the privacy model reused from `wallet.service` (deep downline excluded). The `ActivityItem` union + field names (`type/ts/subject/amount`) mirror a future `ActivityEvent` table so the client contract is swap-stable; non-goals (read/unread, realtime) are left out per spec. Integration tests cover source order, privacy scoping, cursor stability, tenant isolation. A decision-gate note explains why no separate "invite accepted" item is emitted (schema has no `invites.usedAt`; the join item already covers it).

**Cross-cutting `statusBadge` (spec §"Cross-cutting")** — Task 8 adds `statusBadge(status)` to `lib/format.ts` with a safe default and routes the badges touched by items 1/6/7 (ImportWizard, fraud screen) through it; full ~80-site rollout is left to the design-system track per the spec.

**Global constraints honored:** every new query is `where: { tenantId }`/membership-scoped (verified by the tenant-isolation tests in Tasks 1 & 7); money stays `BigInt` cents server-side and only becomes `Number` at the display edge; money/permission mutations audit inside the same transaction (Task 4's `rejectBatch` uses `$transaction`); UI text is English; no design-system migration — only existing `ui.tsx`/`globals.css` primitives are reused. **Test-harness reality honored:** backend items (1/2/7) get real supertest integration specs bootstrapped exactly like `sales-wallet.int-spec.ts` and run via `test:int --runInBand`; UI-only items use `pnpm --filter @refearn/web lint` (`tsc --noEmit`) plus explicit manual steps, with E2E deferred to the tenant-isolation-hardening track.
