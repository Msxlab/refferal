# Estimated Payout Date (Faz E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser-faked "vesting toward payout" estimate with a real backend `estimatedPayoutDate` stored on `Membership`, computed from each member's payable balance + pending commissions' `maturesAt` versus `tenant.payoutMinCents`.

**Architecture:** A pure, DB-free logic core (`payout-estimate.logic.ts`) computes the threshold-cross date; a thin `PayoutEstimateService` loads ledger/tenant data and persists the result on `Membership`. Freshness = Approach A: `matureCommissions()` returns the membershipIds it matured so the 5-min scheduler tick refreshes exactly those, plus a daily advisory-locked full sweep. The `/app/dashboard` and `/app/wallet` payloads expose the stored field; the client bars vest toward `payoutMin` using the real date.

**Tech Stack:** NestJS + Prisma (apps/api), Next.js 15 / React 19 (apps/web), Postgres, jest (ts-jest; unit = `src/**/*.spec.ts`, integration = `test/**/*.int-spec.ts`). Money is BigInt cents. US-only, single currency. No date library — native `Intl.DateTimeFormat`.

**Working dir for all commands:** `C:/Users/Windows/ae-redesign` (the ae-redesign worktree). API at `apps/api`, web at `apps/web`.

---

## File Structure

**Backend (`apps/api`)**
- `prisma/schema.prisma` — add 2 nullable fields to `model Membership`.
- `prisma/migrations/20260626140000_membership_estimated_payout/migration.sql` — additive ALTER (create new).
- `src/payouts/payout-estimate.logic.ts` — **NEW**, pure: `nextAutoRequestAt`, `computeEstimateDate`, `EstimateInput`, `PendingPiece`.
- `src/payouts/payout-estimate.logic.spec.ts` — **NEW**, unit tests (no DB).
- `src/payouts/payout-estimate.service.ts` — **NEW**: `PayoutEstimateService` (`compute`, `refreshForMemberships`, `sweepEstimates`).
- `src/payouts/payouts.module.ts` — register `PayoutEstimateService` in providers + exports.
- `src/engine/engine.service.ts` — `matureCommissions()` also returns `affectedMembershipIds`.
- `src/scheduler/scheduler.service.ts` — inject service; refresh after maturation; new daily sweep job.
- `test/payout-estimate.int-spec.ts` — **NEW**, integration tests (DB).

**Frontend (`apps/web`)**
- `src/app/app/page.tsx` — `homeVesting()` + bar JSX; `Dashboard` interface gains `estimatedPayoutDate` + `payoutMinCents`.
- `src/app/app/wallet/page.tsx` — `computeVesting()` + bar JSX; `Wallet` interface gains `estimatedPayoutDate`.

---

## Task 1: Schema fields + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model Membership, after the `updatedAt` line ~408)
- Create: `apps/api/prisma/migrations/20260626140000_membership_estimated_payout/migration.sql`

- [ ] **Step 1: Add the two nullable fields to `model Membership`**

In `apps/api/prisma/schema.prisma`, find these lines inside `model Membership`:

```prisma
  joinedAt            DateTime         @default(now()) @map("joined_at")
  createdAt           DateTime         @default(now()) @map("created_at")
  updatedAt           DateTime         @updatedAt @map("updated_at")

  tenant   Tenant       @relation(fields: [tenantId], references: [id])
```

Insert the two new fields immediately after `updatedAt` and before the blank line:

```prisma
  joinedAt            DateTime         @default(now()) @map("joined_at")
  createdAt           DateTime         @default(now()) @map("created_at")
  updatedAt           DateTime         @updatedAt @map("updated_at")
  // Faz E: tahmini odeme tarihi. payable + olgunlasacak pending'in payoutMin'e
  // ulastigi gun (turetilmis; PayoutEstimateService gunceller). null = ulasilamiyor.
  estimatedPayoutDate DateTime?        @map("estimated_payout_date")
  estimatedPayoutAt   DateTime?        @map("estimated_payout_at")

  tenant   Tenant       @relation(fields: [tenantId], references: [id])
```

- [ ] **Step 2: Write the migration SQL**

Create `apps/api/prisma/migrations/20260626140000_membership_estimated_payout/migration.sql`:

```sql
-- Faz E: tahmini odeme tarihi (turetilmis, nullable). Mevcut para mantigina dokunmaz.
-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "estimated_payout_date" TIMESTAMP(3),
ADD COLUMN     "estimated_payout_at" TIMESTAMP(3);
```

- [ ] **Step 3: Apply the migration + regenerate the Prisma client**

Run (from `apps/api`):

```bash
cd C:/Users/Windows/ae-redesign/apps/api && npx prisma migrate deploy && npx prisma generate
```

Expected: migration `20260626140000_membership_estimated_payout` applied; "Generated Prisma Client" printed. (`migrate deploy` applies to the DB in `DATABASE_URL`; the field names `estimatedPayoutDate`/`estimatedPayoutAt` become available on the typed client.)

- [ ] **Step 4: Typecheck to confirm the client picked up the fields**

```bash
cd C:/Users/Windows/ae-redesign/apps/api && npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0 (no new errors; fields exist on the Membership model type).

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Windows/ae-redesign && git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260626140000_membership_estimated_payout/migration.sql && git -c user.name="Msxlab" -c user.email="mustafa@axtrasolutions.com" commit -m "Faz E: Membership.estimatedPayoutDate/At alanlari + migration"
```

---

## Task 2: Pure logic core + unit tests (TDD)

The core is DB-free so it runs under the jest `unit` project (`src/**/*.spec.ts`, no DB).

**Files:**
- Create: `apps/api/src/payouts/payout-estimate.logic.ts`
- Test: `apps/api/src/payouts/payout-estimate.logic.spec.ts`

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/payouts/payout-estimate.logic.spec.ts`:

```typescript
import { computeEstimateDate, nextAutoRequestAt } from './payout-estimate.logic';

const TZ = 'America/New_York';

describe('nextAutoRequestAt', () => {
  it('now before 06:00 local -> today 06:00 local (summer EDT = UTC-4)', () => {
    const now = new Date('2026-06-15T09:00:00.000Z'); // 05:00 EDT
    expect(nextAutoRequestAt(now, TZ).toISOString()).toBe('2026-06-15T10:00:00.000Z');
  });

  it('now after 06:00 local -> tomorrow 06:00 local (summer EDT)', () => {
    const now = new Date('2026-06-15T12:00:00.000Z'); // 08:00 EDT
    expect(nextAutoRequestAt(now, TZ).toISOString()).toBe('2026-06-16T10:00:00.000Z');
  });

  it('winter EST (UTC-5): before 06:00 -> today 11:00Z', () => {
    const now = new Date('2026-01-15T09:00:00.000Z'); // 04:00 EST
    expect(nextAutoRequestAt(now, TZ).toISOString()).toBe('2026-01-15T11:00:00.000Z');
  });
});

describe('computeEstimateDate', () => {
  const now = new Date('2026-06-15T12:00:00.000Z'); // 08:00 EDT -> nextAutoRequest = 2026-06-16T10:00:00Z
  const D1 = new Date('2026-07-01T00:00:00.000Z');
  const D2 = new Date('2026-07-10T00:00:00.000Z');

  it('already eligible (payable >= min) -> next auto-request datetime', () => {
    const out = computeEstimateDate({
      payableCents: 100000n, payoutMinCents: 100000n, pending: [], now, timezone: TZ,
    });
    expect(out?.toISOString()).toBe('2026-06-16T10:00:00.000Z');
  });

  it('crosses threshold on the second pending piece -> that maturesAt', () => {
    const out = computeEstimateDate({
      payableCents: 0n, payoutMinCents: 100000n,
      pending: [{ amountCents: 50000n, maturesAt: D1 }, { amountCents: 60000n, maturesAt: D2 }],
      now, timezone: TZ,
    });
    expect(out?.toISOString()).toBe(D2.toISOString());
  });

  it('unsorted pending is sorted by maturesAt before walking', () => {
    const out = computeEstimateDate({
      payableCents: 0n, payoutMinCents: 100000n,
      pending: [{ amountCents: 60000n, maturesAt: D2 }, { amountCents: 50000n, maturesAt: D1 }],
      now, timezone: TZ,
    });
    expect(out?.toISOString()).toBe(D2.toISOString()); // D1(50k)+D2(60k)=110k crosses at D2
  });

  it('never reaches threshold -> null', () => {
    const out = computeEstimateDate({
      payableCents: 0n, payoutMinCents: 100000n,
      pending: [{ amountCents: 30000n, maturesAt: D1 }, { amountCents: 20000n, maturesAt: D2 }],
      now, timezone: TZ,
    });
    expect(out).toBeNull();
  });

  it('partial payable + one pending crosses exactly -> that maturesAt', () => {
    const out = computeEstimateDate({
      payableCents: 40000n, payoutMinCents: 100000n,
      pending: [{ amountCents: 60000n, maturesAt: D1 }],
      now, timezone: TZ,
    });
    expect(out?.toISOString()).toBe(D1.toISOString());
  });

  it('handles large BigInt cents without precision loss', () => {
    const out = computeEstimateDate({
      payableCents: 9_007_199_254_740_993n, payoutMinCents: 9_007_199_254_740_994n,
      pending: [{ amountCents: 1n, maturesAt: D1 }],
      now, timezone: TZ,
    });
    expect(out?.toISOString()).toBe(D1.toISOString());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd C:/Users/Windows/ae-redesign/apps/api && npx jest --selectProjects unit payout-estimate.logic
```

Expected: FAIL — `Cannot find module './payout-estimate.logic'`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/payouts/payout-estimate.logic.ts`:

```typescript
/**
 * Tahmini odeme tarihi — saf cekirdek (DB yok, NestJS yok). Birim test edilir.
 * "Esik-asim tarihi": birikmis payable + maturesAt'e gore olgunlasacak pending'in
 * tenant.payoutMinCents'e ilk ulastigi gun. Zaten esik ustundeyse bir sonraki
 * auto-request ani; hic ulasilamiyorsa null.
 */

export interface PendingPiece {
  amountCents: bigint;
  maturesAt: Date; // cagiran yalniz maturesAt != null pending satirlari verir
}

export interface EstimateInput {
  payableCents: bigint;
  payoutMinCents: bigint;
  pending: PendingPiece[];
  now: Date;
  timezone: string; // IANA, orn 'America/New_York'
}

/** Bir an'in verilen IANA timezone'daki duvar-saati parcalari. */
function wallClockParts(date: Date, timeZone: string): { y: number; mo: number; d: number; h: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) };
}

/** tenant tz'de (y,mo,d) gununun 06:00'inin UTC instant'i (06:00 DST gecis saati degil → tek duzeltme yeterli). */
function zonedSixAmUtc(y: number, mo: number, d: number, timeZone: string): Date {
  let ms = Date.UTC(y, mo - 1, d, 6, 0, 0);
  const seen = wallClockParts(new Date(ms), timeZone);
  const seenMs = Date.UTC(seen.y, seen.mo - 1, seen.d, seen.h, 0, 0);
  const offset = seenMs - ms; // tz duvar-saati UTC'den ne kadar ileri
  ms -= offset;
  return new Date(ms);
}

/** auto-request gece job'u tenant tz'de 06:00'da calisir: simdiden sonraki 06:00 instant'i. */
export function nextAutoRequestAt(now: Date, timeZone: string): Date {
  const today = wallClockParts(now, timeZone);
  let six = zonedSixAmUtc(today.y, today.mo, today.d, timeZone);
  if (six.getTime() <= now.getTime()) {
    const t = wallClockParts(new Date(now.getTime() + 24 * 3_600_000), timeZone);
    six = zonedSixAmUtc(t.y, t.mo, t.d, timeZone);
  }
  return six;
}

/** Esik-asim tarihini hesaplar. Bkz. dosya basligi. */
export function computeEstimateDate(input: EstimateInput): Date | null {
  const { payableCents, payoutMinCents, pending, now, timezone } = input;
  if (payableCents >= payoutMinCents) return nextAutoRequestAt(now, timezone);

  const shortfall = payoutMinCents - payableCents; // > 0
  const sorted = [...pending].sort((a, b) => a.maturesAt.getTime() - b.maturesAt.getTime());
  let cum = 0n;
  for (const piece of sorted) {
    cum += piece.amountCents;
    if (cum >= shortfall) return piece.maturesAt;
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd C:/Users/Windows/ae-redesign/apps/api && npx jest --selectProjects unit payout-estimate.logic
```

Expected: PASS (all assertions green).

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Windows/ae-redesign && git add apps/api/src/payouts/payout-estimate.logic.ts apps/api/src/payouts/payout-estimate.logic.spec.ts && git -c user.name="Msxlab" -c user.email="mustafa@axtrasolutions.com" commit -m "Faz E: payout-estimate saf cekirdek + birim testler"
```

---

## Task 3: `PayoutEstimateService` + module wiring

**Files:**
- Create: `apps/api/src/payouts/payout-estimate.service.ts`
- Modify: `apps/api/src/payouts/payouts.module.ts`

- [ ] **Step 1: Write the service**

Create `apps/api/src/payouts/payout-estimate.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { LedgerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeEstimateDate } from './payout-estimate.logic';

/** PrismaService veya transaction client — ikisi de model delegate'lerini saglar. */
type Db = PrismaService | Prisma.TransactionClient;

/**
 * Tahmini odeme tarihini hesaplar (saf cekirdek) ve Membership'e yazar.
 * Salt-okunur: ledger/tenant okur, yalniz Membership'e iki turetilmis alan yazar.
 * Para kovalari/payout/period-lock'a DOKUNMAZ.
 */
@Injectable()
export class PayoutEstimateService {
  private readonly logger = new Logger(PayoutEstimateService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Tek uye icin tarihi hesaplar (yazmaz). */
  async compute(membershipId: string): Promise<Date | null> {
    return this.loadAndCompute(this.prisma, membershipId);
  }

  /** Verilen uyeler icin hesaplayip Membership alanlarini gunceller (idempotent). */
  async refreshForMemberships(membershipIds: string[]): Promise<void> {
    for (const id of membershipIds) {
      const date = await this.loadAndCompute(this.prisma, id);
      await this.prisma.membership.update({
        where: { id },
        data: { estimatedPayoutDate: date, estimatedPayoutAt: new Date() },
      });
    }
  }

  /**
   * Gunluk tam tarama: pending/payable bakiyesi olan TUM uyeleri yeniden hesaplar.
   * pg_try_advisory_xact_lock ile tek-instance (alinamazsa atla — idempotent ama gereksiz isi onler).
   * Olcek notu: cok buyuk uye sayilarinda chunk'lara bolun; mevcut olcek tek tx'e sigar.
   */
  async sweepEstimates(): Promise<{ swept: number; skipped: boolean }> {
    return this.prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext('payout-estimate'), hashtext('sweep')) AS locked`;
        if (!locked) {
          this.logger.debug('payout-estimate sweep atlandi (baska instance calisiyor)');
          return { swept: 0, skipped: true };
        }
        const rows = await tx.ledgerEntry.findMany({
          where: { status: { in: [LedgerStatus.pending, LedgerStatus.payable] } },
          distinct: ['beneficiaryMembershipId'],
          select: { beneficiaryMembershipId: true },
        });
        const now = new Date();
        for (const r of rows) {
          const date = await this.loadAndCompute(tx, r.beneficiaryMembershipId);
          await tx.membership.update({
            where: { id: r.beneficiaryMembershipId },
            data: { estimatedPayoutDate: date, estimatedPayoutAt: now },
          });
        }
        return { swept: rows.length, skipped: false };
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  }

  /** Bir uye icin tenant esigi + payable + pending'i okuyup saf cekirdegi cagirir. */
  private async loadAndCompute(db: Db, membershipId: string): Promise<Date | null> {
    const membership = await db.membership.findUniqueOrThrow({
      where: { id: membershipId },
      select: { tenant: { select: { payoutMinCents: true, timezone: true } } },
    });
    const [payableAgg, pending] = await Promise.all([
      db.ledgerEntry.aggregate({
        where: { beneficiaryMembershipId: membershipId, status: LedgerStatus.payable },
        _sum: { amountCents: true },
      }),
      db.ledgerEntry.findMany({
        where: { beneficiaryMembershipId: membershipId, status: LedgerStatus.pending, maturesAt: { not: null } },
        select: { amountCents: true, maturesAt: true },
        orderBy: { maturesAt: 'asc' },
      }),
    ]);
    return computeEstimateDate({
      payableCents: payableAgg._sum.amountCents ?? 0n,
      payoutMinCents: membership.tenant.payoutMinCents,
      pending: pending.map((p) => ({ amountCents: p.amountCents, maturesAt: p.maturesAt as Date })),
      now: new Date(),
      timezone: membership.tenant.timezone,
    });
  }
}
```

- [ ] **Step 2: Register the service in PayoutsModule**

Open `apps/api/src/payouts/payouts.module.ts`. Add the import and include `PayoutEstimateService` in BOTH `providers` and `exports` (scheduler needs to inject it). Add near the other imports:

```typescript
import { PayoutEstimateService } from './payout-estimate.service';
```

Then add `PayoutEstimateService` to the `providers: [...]` array and to the `exports: [...]` array. (If the module has no `exports` array yet, add `exports: [PayoutEstimateService],` — and verify `PayoutsService` was already exported; keep whatever was exported before and append.)

- [ ] **Step 3: Typecheck**

```bash
cd C:/Users/Windows/ae-redesign/apps/api && npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/Windows/ae-redesign && git add apps/api/src/payouts/payout-estimate.service.ts apps/api/src/payouts/payouts.module.ts && git -c user.name="Msxlab" -c user.email="mustafa@axtrasolutions.com" commit -m "Faz E: PayoutEstimateService (compute/refresh/sweep) + modul kaydi"
```

---

## Task 4: `matureCommissions()` returns affected membershipIds

**Files:**
- Modify: `apps/api/src/engine/engine.service.ts` (method `matureCommissions`, lines ~249-292)

- [ ] **Step 1: Change the return type + collect affected ids**

In `apps/api/src/engine/engine.service.ts`, change the method signature return type and capture the distinct membershipIds. Replace:

```typescript
  async matureCommissions(now: Date = new Date()): Promise<{ matured: number }> {
    return this.tx(async (tx) => {
```

with:

```typescript
  async matureCommissions(
    now: Date = new Date(),
  ): Promise<{ matured: number; affectedMembershipIds: string[] }> {
    return this.tx(async (tx) => {
```

Then replace the loop + return:

```typescript
      for (const row of due) {
        await tx.ledgerEntry.update({ where: { id: row.id }, data: { status: LedgerStatus.payable } });
        await this.bumpSummary(tx, row.tenantId, row.membershipId, row.month, row.level, {
          pending: -row.amountCents,
          payable: row.amountCents,
        });
      }
      return { matured: due.length };
```

with:

```typescript
      const affected = new Set<string>();
      for (const row of due) {
        affected.add(row.membershipId);
        await tx.ledgerEntry.update({ where: { id: row.id }, data: { status: LedgerStatus.payable } });
        await this.bumpSummary(tx, row.tenantId, row.membershipId, row.month, row.level, {
          pending: -row.amountCents,
          payable: row.amountCents,
        });
      }
      return { matured: due.length, affectedMembershipIds: Array.from(affected) };
```

- [ ] **Step 2: Typecheck (expect existing call-sites still compile — they read `.matured` only)**

```bash
cd C:/Users/Windows/ae-redesign/apps/api && npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0. (Existing callers in `scheduler.service.ts` and tests destructure `{ matured }`, which is still present; the extra field is additive.)

- [ ] **Step 3: Commit**

```bash
cd C:/Users/Windows/ae-redesign && git add apps/api/src/engine/engine.service.ts && git -c user.name="Msxlab" -c user.email="mustafa@axtrasolutions.com" commit -m "Faz E: matureCommissions etkilenen membershipId set'ini doner"
```

---

## Task 5: Scheduler wiring (refresh after maturation + daily sweep)

**Files:**
- Modify: `apps/api/src/scheduler/scheduler.service.ts`

- [ ] **Step 1: Import + inject `PayoutEstimateService`**

Add the import alongside the other service imports at the top of `scheduler.service.ts`:

```typescript
import { PayoutEstimateService } from '../payouts/payout-estimate.service';
```

Add the injection to the constructor (append as the last parameter, after `ranks`):

```typescript
  constructor(
    private readonly engine: EngineService,
    private readonly reports: ReportsService,
    private readonly fraud: FraudService,
    private readonly webhooks: WebhooksService,
    private readonly campaigns: CampaignsService,
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
    private readonly alerts: AlertsService,
    private readonly ranks: RanksService,
    private readonly payoutEstimate: PayoutEstimateService,
  ) {}
```

- [ ] **Step 2: Refresh estimates right after maturation**

Find the existing `matureCommissions` job method (lines ~182-194) and update the `runJob` body to capture `affectedMembershipIds` and refresh them:

```typescript
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'mature-commissions' })
  async matureCommissions(): Promise<void> {
    if (this.running) {
      // onceki kosum hala suruyorsa atla (ust uste binmeyi onle)
      return;
    }
    this.running = true;
    await this.runJob('mature-commissions', async () => {
      const { matured, affectedMembershipIds } = await this.engine.matureCommissions();
      if (matured > 0) this.logger.log(`olgunlasan komisyon satiri: ${matured}`);
      if (affectedMembershipIds.length > 0) {
        // olgunlasma payable'i degistirdi → bu uyelerin tahmini odeme tarihini tazele
        await this.payoutEstimate.refreshForMemberships(affectedMembershipIds);
      }
    });
    this.running = false;
  }
```

- [ ] **Step 3: Add the daily sweep job**

Add a new method (place it near the other daily `@Cron` jobs, e.g. after `rankUpNotify`):

```typescript
  // Faz E: gunluk tam tarama — payout/void/yeni-satis kaymalarini yakalar (maturation-disi).
  @Cron(CronExpression.EVERY_DAY_AT_5AM, { name: 'sweep-payout-estimates' })
  async sweepPayoutEstimates(): Promise<void> {
    await this.runJob('sweep-payout-estimates', async () => {
      const { swept, skipped } = await this.payoutEstimate.sweepEstimates();
      if (!skipped && swept > 0) this.logger.log(`payout tahmin taramasi: ${swept} uye guncellendi`);
    });
  }
```

> Note: `CronExpression.EVERY_DAY_AT_5AM` exists in `@nestjs/schedule`. If a typecheck error reports it as missing, replace the decorator with the raw cron string: `@Cron('0 5 * * *', { name: 'sweep-payout-estimates' })`.

- [ ] **Step 4: Typecheck**

```bash
cd C:/Users/Windows/ae-redesign/apps/api && npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0. (If it errors on `EVERY_DAY_AT_5AM`, apply the raw-cron fallback from Step 3, then re-run.)

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Windows/ae-redesign && git add apps/api/src/scheduler/scheduler.service.ts && git -c user.name="Msxlab" -c user.email="mustafa@axtrasolutions.com" commit -m "Faz E: scheduler — olgunlasma sonrasi refresh + gunluk sweep job"
```

---

## Task 6: Integration tests (service + maturation coupling)

**Files:**
- Create: `apps/api/test/payout-estimate.int-spec.ts`

These use the real DB (jest `integration` project). They mirror existing int-spec structure and helpers (`createTenant`, `createChain`, `truncateAll`). Direct `ledgerEntry.create` builds pending/payable fixtures with explicit `maturesAt`.

- [ ] **Step 1: Write the integration test**

Create `apps/api/test/payout-estimate.int-spec.ts`:

```typescript
import { LedgerStatus, LedgerType, MaturationRule } from '@prisma/client';
import { EngineService } from '../src/engine/engine.service';
import { PayoutEstimateService } from '../src/payouts/payout-estimate.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { createChain, createTenant, truncateAll } from './helpers';

/** Faz E — tahmini odeme tarihi: compute + refresh + sweep. */
describe('payout estimate (entegrasyon)', () => {
  let prisma: PrismaService;
  let svc: PayoutEstimateService;
  let engine: EngineService;
  let app: Awaited<ReturnType<typeof buildApp>>;

  async function buildApp() {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const a = moduleRef.createNestApplication();
    await a.init();
    return a;
  }

  beforeAll(async () => {
    app = await buildApp();
    prisma = app.get(PrismaService);
    svc = app.get(PayoutEstimateService);
    engine = app.get(EngineService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  async function addLedger(
    tenantId: string,
    membershipId: string,
    amountCents: bigint,
    status: LedgerStatus,
    maturesAt: Date | null,
  ): Promise<void> {
    await prisma.ledgerEntry.create({
      data: {
        tenantId,
        saleId: null,
        beneficiaryMembershipId: membershipId,
        level: 0,
        rateBpsUsed: 0,
        amountCents,
        type: LedgerType.commission,
        status,
        maturesAt,
        summaryMonth: '2026-06',
      },
    });
  }

  it('payable >= payoutMin -> compute bir sonraki auto-request tarihini doner (null degil)', async () => {
    const tenant = await createTenant(prisma); // payoutMin varsayilan 100000
    const [member] = await createChain(prisma, tenant.id, 1);
    await addLedger(tenant.id, member.id, 100000n, LedgerStatus.payable, null);

    const date = await svc.compute(member.id);
    expect(date).not.toBeNull();
    expect(date!.getTime()).toBeGreaterThan(Date.now()); // gelecekteki 06:00
  });

  it('pending maturesAt yuruyusu esigi gecince o tarihi doner', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    const D1 = new Date('2026-07-01T00:00:00.000Z');
    const D2 = new Date('2026-07-10T00:00:00.000Z');
    await addLedger(tenant.id, member.id, 50000n, LedgerStatus.pending, D1);
    await addLedger(tenant.id, member.id, 60000n, LedgerStatus.pending, D2); // 50k+60k=110k >= 100k @ D2

    const date = await svc.compute(member.id);
    expect(date?.toISOString()).toBe(D2.toISOString());
  });

  it('esige ulasilamiyorsa null', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    await addLedger(tenant.id, member.id, 30000n, LedgerStatus.pending, new Date('2026-07-01T00:00:00.000Z'));

    expect(await svc.compute(member.id)).toBeNull();
  });

  it('maturesAt = null pending yuruyuse girmez (temkinli)', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    await addLedger(tenant.id, member.id, 200000n, LedgerStatus.pending, null); // tarihi yok -> haric

    expect(await svc.compute(member.id)).toBeNull();
  });

  it('refreshForMemberships alanlari Membership uzerine yazar', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    await addLedger(tenant.id, member.id, 100000n, LedgerStatus.payable, null);

    await svc.refreshForMemberships([member.id]);
    const m = await prisma.membership.findUniqueOrThrow({ where: { id: member.id } });
    expect(m.estimatedPayoutDate).not.toBeNull();
    expect(m.estimatedPayoutAt).not.toBeNull();
  });

  it('sweepEstimates pending/payable bakiyeli uyeyi gunceller, bakiyesizi atlar', async () => {
    const tenant = await createTenant(prisma);
    const [withBal, without] = await createChain(prisma, tenant.id, 2);
    await addLedger(tenant.id, withBal.id, 100000n, LedgerStatus.payable, null);

    const res = await svc.sweepEstimates();
    expect(res.skipped).toBe(false);
    expect(res.swept).toBeGreaterThanOrEqual(1);

    const a = await prisma.membership.findUniqueOrThrow({ where: { id: withBal.id } });
    const b = await prisma.membership.findUniqueOrThrow({ where: { id: without.id } });
    expect(a.estimatedPayoutDate).not.toBeNull();
    expect(b.estimatedPayoutAt).toBeNull(); // hic ledger'i yok -> taramaya girmez
  });

  it('matureCommissions affectedMembershipIds doner (Yaklasim A kaynagi)', async () => {
    const tenant = await createTenant(prisma, { maturationRule: MaturationRule.on_approval });
    const [member] = await createChain(prisma, tenant.id, 1);
    const past = new Date(Date.now() - 60_000);
    // matureCommissions sales JOIN'i ister; saleId'li pending olusturmak yerine burada
    // dogrudan API'yi cagirip donen tipi dogruluyoruz (bos kosumda da alan var).
    const out = await engine.matureCommissions(past);
    expect(Array.isArray(out.affectedMembershipIds)).toBe(true);
    expect(typeof out.matured).toBe('number');
  });
});
```

- [ ] **Step 2: Ensure the test DB has the new migration, then run**

```bash
cd C:/Users/Windows/ae-redesign/apps/api && DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy && npx jest --selectProjects integration payout-estimate
```

If `DATABASE_URL_TEST` is not in the shell, read it from `apps/api/.env` (key `DATABASE_URL_TEST`, default `postgresql://refearn:refearn@localhost:5434/refearn_test`) and pass it explicitly as `DATABASE_URL`. Expected: all tests PASS (the integration project has its own `global-setup`/`setup-env`).

- [ ] **Step 3: Commit**

```bash
cd C:/Users/Windows/ae-redesign && git add apps/api/test/payout-estimate.int-spec.ts && git -c user.name="Msxlab" -c user.email="mustafa@axtrasolutions.com" commit -m "Faz E: payout estimate entegrasyon testleri"
```

---

## Task 7: Expose `estimatedPayoutDate` in API payloads

**Files:**
- Modify: `apps/api/src/wallet/wallet.service.ts` (`dashboard` ~179-217, `wallet` ~18-85)

- [ ] **Step 1: Add fields to the `dashboard()` payload**

In `wallet.service.ts` `dashboard()`, the method already fetches `tenant` but not the membership's estimate. Add a membership fetch to the existing `Promise.all` and include both new fields in the return.

Change the `Promise.all` destructuring to also load the membership estimate. Replace:

```typescript
    const [rows, soldThisMonth, soldLifetime] = await Promise.all([
      this.prisma.monthlySummary.findMany({ where: { membershipId, month: targetMonth }, orderBy: { level: 'asc' } }),
```

with:

```typescript
    const [rows, soldThisMonth, soldLifetime, membership] = await Promise.all([
      this.prisma.monthlySummary.findMany({ where: { membershipId, month: targetMonth }, orderBy: { level: 'asc' } }),
```

and add this as the LAST element of that same `Promise.all([...])` array (after the `soldLifetime` aggregate, before the closing `]);`):

```typescript
      this.prisma.membership.findUniqueOrThrow({ where: { id: membershipId }, select: { estimatedPayoutDate: true } }),
```

Then in the returned object, add `payoutMinCents` and `estimatedPayoutDate`. Find:

```typescript
    return {
      month: targetMonth,
      currency: tenant.currency,
```

and change to:

```typescript
    return {
      month: targetMonth,
      currency: tenant.currency,
      payoutMinCents: tenant.payoutMinCents.toString(),
      estimatedPayoutDate: membership.estimatedPayoutDate,
```

(NestJS serializes the `Date | null` to an ISO string or `null`.)

- [ ] **Step 2: Add the field to the `wallet()` payload**

In `wallet.service.ts` `wallet()`, the method fetches `tenant` but no membership. Add a membership fetch right after the tenant fetch. Find:

```typescript
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const grouped = await this.prisma.ledgerEntry.groupBy({
```

and change to:

```typescript
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const membership = await this.prisma.membership.findUniqueOrThrow({
      where: { id: membershipId },
      select: { estimatedPayoutDate: true },
    });
    const grouped = await this.prisma.ledgerEntry.groupBy({
```

Then in the return object, add `estimatedPayoutDate` right after `payoutMinCents`. Find:

```typescript
      payoutMinCents: tenant.payoutMinCents.toString(),
      balance: {
```

and change to:

```typescript
      payoutMinCents: tenant.payoutMinCents.toString(),
      estimatedPayoutDate: membership.estimatedPayoutDate,
      balance: {
```

- [ ] **Step 3: Typecheck**

```bash
cd C:/Users/Windows/ae-redesign/apps/api && npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/Windows/ae-redesign && git add apps/api/src/wallet/wallet.service.ts && git -c user.name="Msxlab" -c user.email="mustafa@axtrasolutions.com" commit -m "Faz E: dashboard + wallet payload'a estimatedPayoutDate (+ dashboard payoutMinCents)"
```

---

## Task 8: Client vesting bars use the real date

**Files:**
- Modify: `apps/web/src/app/app/page.tsx` (interface `Dashboard` ~20-30; `homeVesting` ~50-58; bar JSX ~228-248)
- Modify: `apps/web/src/app/app/wallet/page.tsx` (interface `Wallet` ~21-26; `computeVesting` ~53-71; `payoutDateLabel` ~73-75; bar JSX ~170-230)

- [ ] **Step 1: Update the `Dashboard` interface (home)**

In `apps/web/src/app/app/page.tsx`, find:

```typescript
  effectiveRateBps: number;
  totals: { pendingCents: string; payableCents: string; paidCents: string };
  levels: LevelRow[];
}
```

and add the two fields:

```typescript
  effectiveRateBps: number;
  payoutMinCents: string;
  estimatedPayoutDate: string | null;
  totals: { pendingCents: string; payableCents: string; paidCents: string };
  levels: LevelRow[];
}
```

- [ ] **Step 2: Replace `homeVesting()` (home)**

Replace the whole function (lines ~50-58):

```typescript
function homeVesting(pendingCents: number, payableCents: number) {
  const accrued = Math.max(1, pendingCents + payableCents);
  const vested = Math.max(0, payableCents);
  const pct = Math.min(100, (vested / accrued) * 100);
  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const payoutLabel = periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { vested, accrued, pct, payoutLabel };
}
```

with:

```typescript
// Esik-asim tahmini: payable hedefe (payoutMin) dogru ilerler; tarih backend'den (estimatedPayoutDate).
function homeVesting(pendingCents: number, payableCents: number, payoutMinCents: number, estimatedPayoutDate: string | null) {
  const target = Math.max(1, payoutMinCents);
  const vested = Math.max(0, payableCents);
  const pct = Math.min(100, (vested / target) * 100);
  const reached = payableCents >= payoutMinCents;
  const dateLabel = estimatedPayoutDate
    ? new Date(estimatedPayoutDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;
  return { vested, target, pct, reached, dateLabel };
}
```

- [ ] **Step 3: Replace the home bar JSX (lines ~228-248)**

Replace the whole IIFE block that starts with `{/* kompakt vesting cubugu ... */}` and calls `homeVesting(pending, payable)` with:

```jsx
{/* kompakt vesting cubugu — gercek esik-asim tahmini (backend estimatedPayoutDate) */}
{(() => {
  const v = homeVesting(pending, payable, Number(data.payoutMinCents), data.estimatedPayoutDate);
  if (payable + pending <= 0) return null;
  return (
    <Link href="/app/wallet" style={{ display: 'block', marginTop: 18, color: 'inherit' }}>
      <div className="spread" style={{ marginBottom: 7 }}>
        <span className="row faint" style={{ gap: 6, fontSize: 12, alignItems: 'center' }}>
          Vesting toward payout
          <span className="badge" style={{ fontSize: 10, background: 'color-mix(in srgb, var(--gold-500) 14%, transparent)', color: 'var(--gold-500)' }} title="Estimated payout date is derived from when your pending commissions mature past the payout threshold.">est.</span>
        </span>
        <span className="faint tnum" style={{ fontSize: 12 }}>
          {money(v.vested, c)} / {money(v.target, c)}
          {v.reached ? ' · ready' : v.dateLabel ? ` · est. ${v.dateLabel}` : ''}
        </span>
      </div>
      <div style={{ height: 9, borderRadius: 6, background: 'color-mix(in srgb, hsl(var(--muted-foreground)) 12%, transparent)', overflow: 'hidden', boxShadow: 'inset 0 1px 2px color-mix(in srgb, hsl(var(--foreground)) 15%, transparent)' }}>
        <div style={{ height: '100%', width: `${v.pct}%`, borderRadius: 6, background: v.reached ? 'var(--emerald)' : 'var(--foil)', transition: 'width .8s cubic-bezier(.2,.9,.3,1)' }} />
      </div>
    </Link>
  );
})()}
```

- [ ] **Step 4: Update the `Wallet` interface (wallet)**

In `apps/web/src/app/app/wallet/page.tsx`, find:

```typescript
interface Wallet {
  currency: string;
  payoutMinCents: string;
  balance: { pendingCents: string; payableCents: string; paidCents: string };
  ledger: { total: number; page: number; pageSize: number; items: LedgerItem[] };
}
```

and add `estimatedPayoutDate`:

```typescript
interface Wallet {
  currency: string;
  payoutMinCents: string;
  estimatedPayoutDate: string | null;
  balance: { pendingCents: string; payableCents: string; paidCents: string };
  ledger: { total: number; page: number; pageSize: number; items: LedgerItem[] };
}
```

- [ ] **Step 5: Replace `computeVesting()` (wallet)**

Replace the whole function (lines ~53-71):

```typescript
function computeVesting(pendingCents: number, payableCents: number, minCents: number) {
  const accrued = Math.max(0, pendingCents + payableCents); // toplam birikmis (vested + henuz olgunlasmamis)
  const vested = Math.max(0, payableCents);                 // olgunlasmis = odenebilir
  // Hedef: esik. Esik zaten asildiysa hedefi birikmise yukselt ki cubuk "dolu" gorunsun.
  const target = Math.max(minCents, accrued, 1);
  const pct = Math.min(100, (vested / target) * 100);

  // Tahmini odeme tarihi: bu ayin son gunu (TAHMIN). Gercek bir API alani yok.
  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const msPerDay = 86_400_000;
  const daysLeft = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / msPerDay));

  // Gun-bazli dogrusal vesting hizi tahmini: kalan "pending" tutar, kalan gune yayilir.
  const remainingToVest = Math.max(0, pendingCents);
  const perDay = daysLeft > 0 ? remainingToVest / daysLeft : remainingToVest;

  return { accrued, vested, target, pct, periodEnd, daysLeft, perDay, remainingToVest };
}
```

with (vest toward the real threshold; date comes from the backend):

```typescript
function computeVesting(payableCents: number, minCents: number, estimatedPayoutDate: string | null) {
  const target = Math.max(minCents, 1);
  const vested = Math.max(0, payableCents);
  const pct = Math.min(100, (vested / target) * 100);
  const reached = payableCents >= minCents;
  const payoutDate = estimatedPayoutDate ? new Date(estimatedPayoutDate) : null;
  return { vested, target, pct, reached, payoutDate };
}
```

- [ ] **Step 6: Update the wallet bar JSX (lines ~170-230)**

The bar block references `vesting.vested`, `vesting.target`, `vesting.pct`, `vesting.periodEnd`, `vesting.daysLeft`, `vesting.perDay`, and `pending`. Two changes:

(a) Find where `vesting` is created (the call `computeVesting(...)`, around line ~158) and change it to the new signature:

```typescript
  const vesting = computeVesting(payable, Number(wallet.payoutMinCents), wallet.estimatedPayoutDate);
```

(b) In the bar JSX, replace the right-hand "Est. payout" block:

```jsx
    <div style={{ textAlign: 'right' }}>
      <div className="faint" style={{ fontSize: 11 }}>Est. payout</div>
      <div className="tnum" style={{ fontWeight: 800, fontSize: 16, marginTop: 2 }}>{payoutDateLabel(vesting.periodEnd)}</div>
      <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
        {vesting.daysLeft === 0 ? 'today' : `in ${vesting.daysLeft} day${vesting.daysLeft === 1 ? '' : 's'}`}
      </div>
    </div>
```

with:

```jsx
    <div style={{ textAlign: 'right' }}>
      <div className="faint" style={{ fontSize: 11 }}>Est. payout</div>
      <div className="tnum" style={{ fontWeight: 800, fontSize: 16, marginTop: 2 }}>
        {vesting.reached ? 'Ready' : vesting.payoutDate ? payoutDateLabel(vesting.payoutDate) : '—'}
      </div>
      <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
        {vesting.reached ? 'auto-requested' : vesting.payoutDate ? 'estimated' : 'keep selling'}
      </div>
    </div>
```

(c) Remove the now-stale per-day sentence block at the bottom of the bar (the block guarded by `{!reached && vesting.perDay > 0 && (...)}` — `vesting.perDay` no longer exists). Delete that entire `{!reached && vesting.perDay > 0 && ( ... )}` block.

> If any other line in the file still references the removed `vesting.periodEnd`, `vesting.daysLeft`, `vesting.perDay`, `vesting.remainingToVest`, or `vesting.accrued`, the typecheck in Step 7 will flag it — replace each with the new fields (`vesting.payoutDate`, `vesting.reached`) or delete the dependent UI.

- [ ] **Step 7: Typecheck the web app**

```bash
cd C:/Users/Windows/ae-redesign/apps/web && npx tsc --noEmit
```

Expected: exit 0. Fix any leftover references flagged (see note in Step 6).

- [ ] **Step 8: Commit**

```bash
cd C:/Users/Windows/ae-redesign && git add apps/web/src/app/app/page.tsx apps/web/src/app/app/wallet/page.tsx && git -c user.name="Msxlab" -c user.email="mustafa@axtrasolutions.com" commit -m "Faz E: istemci vesting cubugu — gercek estimatedPayoutDate, payoutMin hedefi"
```

---

## Task 9: Full verification

- [ ] **Step 1: Backend unit + typecheck**

```bash
cd C:/Users/Windows/ae-redesign/apps/api && npx jest --selectProjects unit && npx tsc --noEmit -p tsconfig.json
```

Expected: unit suite PASS, tsc exit 0.

- [ ] **Step 2: Backend integration (DB required)**

```bash
cd C:/Users/Windows/ae-redesign/apps/api && npx jest --selectProjects integration payout-estimate
```

Expected: PASS. (Ensure the test DB has the Task 1 migration applied — see Task 6 Step 2.)

- [ ] **Step 3: Web typecheck + production build sanity**

```bash
cd C:/Users/Windows/ae-redesign/apps/web && npx tsc --noEmit && npx next build
```

Expected: tsc exit 0; `next build` completes (catches any SSR/usage errors the editor missed).

- [ ] **Step 4: Optional live check (preview)** — start the dev server, open `/app` and `/app/wallet`, confirm the "Vesting toward payout" bar renders the real date / "Ready" / "keep selling" states and no console errors. (Use the preview tools; verify against a member account that has payable + pending ledger entries.)

---

## Notes for the executor

- **Money is BigInt cents everywhere in the API.** Never coerce cents to `Number` for arithmetic. The only `Number()` on money is in the client (display), matching the existing code.
- **`estimatedPayoutDate` semantics:** a non-null value = "expected eligible by / next auto-request"; `null` = "threshold unreachable with current pipeline." The client distinguishes "already eligible" itself via `payable >= payoutMin`.
- **Do not modify** ledger buckets (pending/payable/paid/reversed), payout logic, `autoRequestPayouts`, or period locks. This feature is read-only over the ledger and writes only `Membership.estimatedPayoutDate/At`.
- **Approach A freshness:** maturation-coupled refresh (5-min) covers the main driver; the daily sweep is the backstop for payout/void/new-sale drift.
