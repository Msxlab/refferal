# Design-System & Primitives Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Systematize the existing hand-rolled "Obsidian & Champagne" CSS token system into a typed, lint-guarded, first-class primitives kit and prove it out end-to-end on the Admin Payouts page.

**Architecture:** A typed token contract (`lib/tokens.ts`) mirrors the CSS custom properties in `globals.css`; a `statusBadge()` mapper + `<StatusBadge>` primitive give one badge vocabulary with a safe default; presentational primitives (`Card`, `PageHeader`, `KpiStrip`, `Toolbar`, `DataTable`, `Money`, `Field`, `Tabs`, `DescriptionList`, `Icon`) wrap existing `globals.css` classes with no new color system; project-local ESLint rules forbid raw `fontSize`/inline-style regressions; TanStack Query provides a tenant-scoped client cache under `DataTable`; a shared `AppShell` unifies the three nav layouts and mounts `CommandPalette` for all personas. The kit renders on the existing tokens, so a future shadcn migration would swap implementations under the same primitive API without touching call sites.

**Tech Stack:** Next.js 15 (App Router, React 19), TypeScript 5.8 (strict), hand-rolled CSS custom properties, `@tanstack/react-query` (one new dependency), `eslint` + custom no-restricted rules (dev-only), Node 24 `node --test` (native `.ts`/`.mts` type-stripping, zero new runtime deps) for pure-logic web unit tests, `tsc --noEmit` (`npm run lint`) + manual browser verification for React/UI tasks.

> **Test-harness reality (verified against the repo):**
> - `apps/web` has **no jest, no ESLint, no test runner today**; its only check is `npm run lint` → `tsc --noEmit` (see [apps/web/package.json](../../../apps/web/package.json):9). Playwright/E2E arrives in the **tenant-isolation-hardening** track — NOT here.
> - Node 24 is installed and runs `.ts`/`.mts` directly (native type stripping) with the built-in `node:test` runner. **Verified**: `node --test path/to/file.test.mts` executes and can `import` a relative pure-TS `.ts` module (no `@/` alias, no JSX). We use this for **pure-logic** web modules (`tokens.ts`, `statusBadge` in `format.ts`) — no new dependency, no runner install. Directory globbing does not reliably match `.mts`; **always pass the test file path explicitly**.
> - React components and anything importing JSX or the `@/` path alias **cannot** run under `node --test` — verify those with `npm run lint` (type check) + explicit manual browser steps.
> - `apps/api` (Jest `unit`/`integration`) is **not touched** by this track (presentation + client data layer only); no backend/endpoint changes.
> - Root commands: `pnpm` + `turbo`. Run web checks from `apps/web` with `npm run lint` (equivalently `pnpm --filter @refearn/web lint`).

---

## File Structure

| File | Responsibility |
|---|---|
| `docs/DECISIONS.md` | **Modify** — append the "systematize on hand-rolled tokens" gate decision. |
| `apps/web/src/lib/tokens.ts` | **Create** — typed constants mirroring `:root` CSS vars (`text`/`space`/`color`/`radius`/`dur`), values are `var(--…)` strings. |
| `apps/web/src/lib/tokens.test.mts` | **Create** — `node --test` coverage: every `--text-*`/`--space-*` var in `globals.css` has a `tokens.ts` key. |
| `apps/web/src/lib/format.ts` | **Modify** — add `statusBadge(status)` mapper next to `money`/`levelLabel`. |
| `apps/web/src/lib/format.test.mts` | **Create** — `node --test` for `statusBadge` (known→cls, unknown→draft, case-insensitive, null-safe). |
| `apps/web/src/components/ui.tsx` | **Modify** — add primitives (`StatusBadge`, `Card`, `PageHeader`, `KpiStrip`+`Kpi`, `Toolbar`, `Tabs`, `DescriptionList`, `Money`, `Field`, `DataTable`); migrate own `fontSize` literals to `text.*`; fix dark-only `rgba(255,255,255,…)` in `Donut`/`Bars`/`Toggle`. |
| `apps/web/src/components/Icon.tsx` | **Create** — single inline-SVG icon set (`currentColor`, `size` prop), replacing emoji glyphs. |
| `apps/web/src/components/AppShell.tsx` | **Create** — unified nav shell (admin/platform `.shell/.side`, member `.topbar`) with a `persona` prop; mounts `CommandPalette`. |
| `apps/web/src/components/CommandPalette.tsx` | **Modify** — accept persona-scoped, permission-gated nav targets via props. |
| `apps/web/src/lib/queryClient.tsx` | **Create** — `QueryClientProvider` wrapper with tenant-aware defaults + retry-off-on-4xx. |
| `apps/web/src/lib/queries/payouts.ts` | **Create** — typed TanStack Query hooks for the Payouts surface, keyed by tenant+filters. |
| `apps/web/src/lib/queries/payouts.test.mts` | **Create** — `node --test`: query key includes tenant; two tenants never collide; 4xx not retried. |
| `apps/web/eslint.config.mjs` | **Create** — flat ESLint config wiring the two local rules with a `migrated` allowlist. |
| `apps/web/eslint-rules/no-raw-fontsize.js` | **Create** — rule: forbid numeric `fontSize` in JSX `style={{}}`. |
| `apps/web/eslint-rules/no-stray-inline-style.js` | **Create** — rule: warn on `style={{` in files in the `migrated` list; grep-gate `rgba(255,255,255,`. |
| `apps/web/package.json` | **Modify** — add `@tanstack/react-query` dep; add `eslint`+plugins devDeps; add `lint:eslint` + `test:unit` scripts. |
| `apps/web/src/app/layout.tsx` | **Modify** — wrap children in the `QueryClientProvider`. |
| `apps/web/src/app/admin/layout.tsx` | **Modify** — render via `<AppShell persona="admin">`. |
| `apps/web/src/app/platform/layout.tsx` | **Modify** — render via `<AppShell persona="platform">`. |
| `apps/web/src/app/app/layout.tsx` | **Modify** — render via `<AppShell persona="member">`. |
| `apps/web/src/app/admin/payouts/page.tsx` | **Modify** — rebuild from kit primitives + Query hooks; zero inline `fontSize`, zero raw `` `badge ${x}` ``. |

---

## Tasks

### Task 1: Record the core gating decision (item 1)

**Files:**
- Modify: `docs/DECISIONS.md` (append a new section at end of file)

- [ ] **Step 1: Read the tail of the decision log** to append cleanly.
  ```bash
  tail -n 5 docs/DECISIONS.md
  ```
  Expected: the file ends with the "Network yerlesim stratejisi" section (last line mentions "AYRI bir L+ epic olarak ele alinir.").

- [ ] **Step 2: Append the decision.** Add exactly this block to the end of `docs/DECISIONS.md`:
  ```markdown

  ## Design-system track — systematize hand-rolled tokens (2026-07-09)

  **Karar:** Tasarim-sistemi track'i, mevcut el-yapimi `globals.css` token'lari uzerine
  TYPED bir primitives kit kurar. **shadcn/Tailwind'e GECILMEZ** (bu track'te). Gerekce:
  canli redesign ayni CSS uzerinde yayinda; framework swap yuksek-riskli, token'larin zaten
  verdigi algi-kalitesine ek getirisi yok. Kit, call-site'larin render'i bilmemesi ilkesiyle
  tasarlanir — ileride shadcn/Tailwind benimsenirse ayni primitive API'sinin (`<Card>`,
  `<StatusBadge>`, `<DataTable>`) ALTINA katmanlanir, site-site yeniden yazim degil.

  **Branch:** `reconcile/advanced-base` uzerine kurulur (uretim + canli redesign burada).
  `redesign/shadcn-indigo` bu amac icin terk edilir; degerli component varsa markup/logic
  portlanir, Tailwind class'lari degil.

  **Kapsam:** items 2–7 (typed tokens + lint, statusBadge, primitives kit, TanStack Query,
  Payouts vertical slice, nav birlestirme + CommandPalette + icon set, light-theme denetimi).
  Backend/sema/para-mantigi degismez.
  ```

- [ ] **Step 3: Verify the append.**
  ```bash
  grep -c "systematize hand-rolled tokens" docs/DECISIONS.md
  ```
  Expected output: `1`

- [ ] **Step 4: Commit.**
  ```bash
  git add docs/DECISIONS.md && git commit -m "docs: record design-system 'systematize on hand-rolled tokens' decision

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 2: Typed token module (`tokens.ts`) + drift test (item 2)

**Files:**
- Create: `apps/web/src/lib/tokens.ts`
- Test: `apps/web/src/lib/tokens.test.mts`

- [ ] **Step 1: Write the failing test.** Create `apps/web/src/lib/tokens.test.mts`:
  ```ts
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { readFileSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  import { dirname, join } from 'node:path';
  import { text, space, color, radius, dur } from './tokens.ts';

  const here = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(join(here, '../app/globals.css'), 'utf8');

  // Collect every --text-* and --space-* custom property DEFINED in :root.
  function cssVarsWithPrefix(prefix: string): string[] {
    const re = new RegExp(`--${prefix}-([a-z0-9]+)\\s*:`, 'g');
    const found = new Set<string>();
    for (const m of css.matchAll(re)) found.add(m[1]);
    return [...found];
  }

  test('tokens.text covers every --text-* var in globals.css', () => {
    const cssKeys = cssVarsWithPrefix('text'); // e.g. xs, sm, md, lg, xl, 2xl, hero
    const tsValues = Object.values(text);
    for (const k of cssKeys) {
      assert.ok(
        tsValues.includes(`var(--text-${k})`),
        `tokens.text is missing a value for --text-${k}`,
      );
    }
  });

  test('tokens.space covers every --space-* var in globals.css', () => {
    const cssKeys = cssVarsWithPrefix('space'); // 1..8
    const tsValues = Object.values(space);
    for (const k of cssKeys) {
      assert.ok(
        tsValues.includes(`var(--space-${k})`),
        `tokens.space is missing a value for --space-${k}`,
      );
    }
  });

  test('color/radius/dur values are var() strings, never raw literals', () => {
    for (const v of [...Object.values(color), ...Object.values(radius), ...Object.values(dur)]) {
      assert.match(v, /^var\(--[a-z0-9-]+\)$/, `expected a var() token, got "${v}"`);
    }
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**
  ```bash
  cd apps/web && node --test src/lib/tokens.test.mts
  ```
  Expected: fails to resolve `./tokens.ts` (module not found) — the module does not exist yet.

- [ ] **Step 3: Write the minimal implementation.** Create `apps/web/src/lib/tokens.ts`:
  ```ts
  /**
   * Typed design-token contract. Mirrors the CSS custom properties in
   * app/globals.css (:root). Values are `var(--…)` strings — NOT raw px — so
   * theming still flows through CSS and this module stays a contract, not a
   * duplicate palette. Use these instead of hardcoding fontSize/spacing/color
   * literals in `style={{}}`. Kept in sync with globals.css by tokens.test.mts.
   */
  export const text = {
    xs: 'var(--text-xs)',
    sm: 'var(--text-sm)',
    md: 'var(--text-md)',
    lg: 'var(--text-lg)',
    xl: 'var(--text-xl)',
    '2xl': 'var(--text-2xl)',
    hero: 'var(--text-hero)',
  } as const;

  export const space = {
    1: 'var(--space-1)',
    2: 'var(--space-2)',
    3: 'var(--space-3)',
    4: 'var(--space-4)',
    5: 'var(--space-5)',
    6: 'var(--space-6)',
    8: 'var(--space-8)',
  } as const;

  export const color = {
    gold500: 'var(--gold-500)',
    emerald: 'var(--emerald)',
    amber: 'var(--amber)',
    rose: 'var(--rose)',
    sky: 'var(--sky)',
    panel: 'var(--panel)',
    panel2: 'var(--panel-2)',
    panel3: 'var(--panel-3)',
    border: 'var(--border)',
    borderStrong: 'var(--border-strong)',
    text: 'var(--text)',
    muted: 'var(--muted)',
    faint: 'var(--faint)',
  } as const;

  export const radius = {
    base: 'var(--radius)',
    sm: 'var(--radius-sm)',
  } as const;

  export const dur = {
    fast: 'var(--dur-fast)',
    base: 'var(--dur-base)',
    slow: 'var(--dur-slow)',
  } as const;
  ```

- [ ] **Step 4: Run the test to verify it passes.**
  ```bash
  cd apps/web && node --test src/lib/tokens.test.mts
  ```
  Expected: `pass 3`, `fail 0`.

- [ ] **Step 5: Type-check the whole web app.**
  ```bash
  cd apps/web && npm run lint
  ```
  Expected: exits 0 (no type errors introduced). `.test.mts` is included by tsconfig `**/*.ts` but has no type errors.

- [ ] **Step 6: Commit.**
  ```bash
  git add apps/web/src/lib/tokens.ts apps/web/src/lib/tokens.test.mts && git commit -m "feat(web): typed design-token contract mirroring globals.css

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 3: `statusBadge()` mapper + drift-safe test (item 3)

**Files:**
- Modify: `apps/web/src/lib/format.ts` (append after `dateShort`, currently ends line 43)
- Test: `apps/web/src/lib/format.test.mts`

- [ ] **Step 1: Write the failing test.** Create `apps/web/src/lib/format.test.mts`:
  ```ts
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { statusBadge } from './format.ts';

  // These are the classes globals.css actually styles (see .badge.* rules).
  const STYLED = new Set([
    'draft', 'inactive', 'expired', 'reversed',
    'approved', 'active', 'paid', 'used',
    'void', 'failed', 'revoked',
    'payable',
    'pending', 'requested', 'processing',
  ]);

  function cls(s: string): string {
    return statusBadge(s).className.replace('badge ', '');
  }

  test('every known status maps to a class that globals.css styles', () => {
    for (const s of [
      'approved', 'active', 'paid', 'used', 'void', 'failed', 'revoked',
      'pending', 'requested', 'processing', 'payable',
      'draft', 'inactive', 'expired', 'reversed',
      'suspended', 'mailed', 'cleared',
    ]) {
      assert.ok(STYLED.has(cls(s)), `status "${s}" -> unstyled class "${cls(s)}"`);
    }
  });

  test('unknown status falls back to draft, never an empty class', () => {
    assert.equal(statusBadge('totally-unknown').className, 'badge draft');
    assert.notEqual(cls('totally-unknown'), '');
  });

  test('lookup is case-insensitive', () => {
    assert.equal(statusBadge('ACTIVE').className, 'badge active');
    assert.equal(statusBadge('Suspended').className, 'badge inactive');
  });

  test('null/undefined status is safe and yields draft', () => {
    assert.equal(statusBadge(undefined as unknown as string).className, 'badge draft');
    assert.equal(statusBadge(null as unknown as string).className, 'badge draft');
  });

  test('aliased statuses carry a human label; plain statuses echo input', () => {
    assert.equal(statusBadge('suspended').label, 'Suspended');
    assert.equal(statusBadge('cleared').label, 'Cleared');
    assert.equal(statusBadge('active').label, 'active');
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**
  ```bash
  cd apps/web && node --test src/lib/format.test.mts
  ```
  Expected: fails — `statusBadge` is not exported from `./format.ts`.

- [ ] **Step 3: Write the minimal implementation.** Append to `apps/web/src/lib/format.ts` (after `dateShort`, at end of file):
  ```ts
  /**
   * Tek rozet sozlugu: domain status -> `.badge` modifier sinifi (+ opsiyonel etiket).
   * Bilinmeyen status notr `draft` tonuna duser (renksiz seffaf pill YERINE).
   * `.badge.*` siniflari globals.css'te tanimli; burada yalniz eslesme yapilir.
   */
  const BADGE: Record<string, { cls: string; label?: string }> = {
    approved: { cls: 'approved' }, active: { cls: 'active' }, paid: { cls: 'paid' }, used: { cls: 'used' },
    void: { cls: 'void' }, failed: { cls: 'failed' }, revoked: { cls: 'revoked' },
    pending: { cls: 'pending' }, requested: { cls: 'requested' }, processing: { cls: 'processing' },
    payable: { cls: 'payable' },
    draft: { cls: 'draft' }, inactive: { cls: 'inactive' }, expired: { cls: 'expired' }, reversed: { cls: 'reversed' },
    // aliased to an existing tone to avoid CSS growth:
    suspended: { cls: 'inactive', label: 'Suspended' },
    mailed: { cls: 'processing', label: 'Mailed' },
    cleared: { cls: 'paid', label: 'Cleared' },
  };

  /** status -> { className, label }. Case-insensitive, null-safe, safe default. */
  export function statusBadge(status: string): { className: string; label: string } {
    const key = (status ?? '').toLowerCase();
    const m = BADGE[key] ?? { cls: 'draft' };
    return { className: `badge ${m.cls}`, label: m.label ?? status };
  }
  ```

- [ ] **Step 4: Run the test to verify it passes.**
  ```bash
  cd apps/web && node --test src/lib/format.test.mts
  ```
  Expected: `pass 5`, `fail 0`.

- [ ] **Step 5: Type-check.**
  ```bash
  cd apps/web && npm run lint
  ```
  Expected: exits 0.

- [ ] **Step 6: Commit.**
  ```bash
  git add apps/web/src/lib/format.ts apps/web/src/lib/format.test.mts && git commit -m "feat(web): statusBadge() mapper with safe default for badge vocabulary

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 4: `<StatusBadge>` primitive + migrate `ui.tsx`'s own literals (items 3, 2, 7)

**Files:**
- Modify: `apps/web/src/components/ui.tsx` (add import + `StatusBadge`; fix `Bars` literals lines 102-103, 105; fix `Donut` line 63; fix `Toggle` line 258; `StatCard` line 131)

- [ ] **Step 1: Add the token import and `StatusBadge` primitive.** At the top of `ui.tsx`, after line 5 (`import { APP_MONOGRAM, APP_NAME } from '@/lib/brand';`), add:
  ```ts
  import { statusBadge } from '@/lib/format';
  import { text, color } from '@/lib/tokens';
  ```
  Then add this primitive at the end of the file (after `SortableTh`):
  ```tsx
  /* ----------------------------------------------------- status rozeti (tek soz dagarcigi) */
  /** Domain status -> renkli rozet. Bilinmeyen status notr `draft` tonuna duser. */
  export function StatusBadge({ status }: { status: string }) {
    const { className, label } = statusBadge(status);
    return <span className={className}>{label}</span>;
  }
  ```

- [ ] **Step 2: Type-check (verifies the primitive + import compile).**
  ```bash
  cd apps/web && npm run lint
  ```
  Expected: exits 0.

- [ ] **Step 3: Migrate `ui.tsx`'s own raw `fontSize` literals to `text.*`.** Apply these exact edits (reference implementation for the lint rule in Task 13):
  - `Bars` (line 102): `<span className="muted" style={{ fontSize: 12 }}>` → `<span className="muted" style={{ fontSize: text.sm }}>`
  - `Bars` (line 103): `<span className="tnum" style={{ fontSize: 13, fontWeight: 650 }}>` → `<span className="tnum" style={{ fontSize: text.md, fontWeight: 650 }}>`
  - `StatCard` (line 131): `<div className="faint" style={{ fontSize: 11, marginTop: 6 }}>` → `<div className="faint" style={{ fontSize: text.xs, marginTop: 6 }}>`

- [ ] **Step 4: Fix dark-only `rgba(255,255,255,…)` literals to theme tokens (item 7).** Apply these exact edits:
  - `Donut` (line 63): `stroke="rgba(255,255,255,.06)"` → `stroke={color.border}`
  - `Bars` (line 105): `background: 'rgba(255,255,255,.05)'` → `background: color.panel2`
  - `Toggle` (line 258): `background: checked ? 'var(--grad-emerald)' : 'rgba(255,255,255,.12)',` → `background: checked ? color.emerald : color.panel3,` (note: `--grad-emerald` is undefined in globals.css — replaced with the defined `--emerald`; off-state now reads on light theme.)

- [ ] **Step 5: Type-check again.**
  ```bash
  cd apps/web && npm run lint
  ```
  Expected: exits 0.

- [ ] **Step 6: Manual verification (dark + light).** Start the dev server and confirm the shared primitives read in both themes.
  ```bash
  cd apps/web && npm run dev
  ```
  Open http://localhost:3000/admin/payouts (log in with a seeded admin). Then:
  - Click the theme toggle (☾/☀) to switch to **light**.
  - Confirm the `Donut` on any dashboard has a **visible** grey track (not white-on-white), any `Bars` background bar is visible, and any `Toggle` off-state is visible.
  - Switch back to **dark**; confirm nothing regressed.
  Stop the server (Ctrl+C).

- [ ] **Step 7: Commit.**
  ```bash
  git add apps/web/src/components/ui.tsx && git commit -m "feat(web): StatusBadge primitive; token-ize ui.tsx literals; fix light-theme hairlines

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 5: `<Money>` primitive (item 4)

**Files:**
- Modify: `apps/web/src/components/ui.tsx` (add `Money` next to `MoneyCounter`)

- [ ] **Step 1: Add the `Money` primitive.** In `ui.tsx`, immediately after `MoneyCounter` (ends line 37), add:
  ```tsx
  /**
   * Display-edge money primitive. Accepts BigInt cents as string | number | bigint
   * and renders via money() — never does arithmetic on Number above this boundary.
   * Use for static amounts; use MoneyCounter for the animated hero figure.
   */
  export function Money({ cents, currency = 'USD', className }: { cents: string | number | bigint; currency?: string; className?: string }) {
    return <span className={`tnum ${className ?? ''}`}>{money(cents, currency)}</span>;
  }
  ```
  And add the import at the top (combine with the Task 4 import as `import { money, statusBadge } from '@/lib/format';`).

- [ ] **Step 2: Type-check.**
  ```bash
  cd apps/web && npm run lint
  ```
  Expected: exits 0. (`money` already accepts `string | number | bigint` per format.ts line 2 — signatures stay consistent.)

- [ ] **Step 3: Commit.**
  ```bash
  git add apps/web/src/components/ui.tsx && git commit -m "feat(web): Money display-edge primitive wrapping money()

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 6: Layout & structural primitives — `PageHeader`, `Card`, `Toolbar`, `Tabs`, `Field`, `DescriptionList`, `KpiStrip`+`Kpi` (item 4)

**Files:**
- Modify: `apps/web/src/components/ui.tsx` (append primitives after `Money`)

Each primitive is presentational only — a typed props interface wrapping an existing `globals.css` class. No business logic, no fetching, no tenant assumptions.

- [ ] **Step 1: Add `Card`.** Append to `ui.tsx`:
  ```tsx
  /* ----------------------------------------------------- kart primitifi */
  export function Card({ children, hover, hero, glow, className, style }: {
    children: ReactNode; hover?: boolean; hero?: boolean; glow?: boolean; className?: string; style?: React.CSSProperties;
  }) {
    const cls = ['card', hover && 'hover', hero && 'hero', glow && 'card-glow', className].filter(Boolean).join(' ');
    return <div className={cls} style={style}>{children}</div>;
  }
  ```

- [ ] **Step 2: Add `PageHeader`.** Append:
  ```tsx
  /* ----------------------------------------------------- sayfa basligi */
  export function PageHeader({ eyebrow, title, sub, actions }: {
    eyebrow?: string; title: string; sub?: string; actions?: ReactNode;
  }) {
    return (
      <div className="spread" style={{ alignItems: 'flex-start', marginBottom: 'var(--space-5)' }}>
        <div>
          {eyebrow && <div className="eyebrow fade-in">{eyebrow}</div>}
          <h1 className="h1 fade-in" style={{ marginBottom: sub ? undefined : 0 }}>{title}</h1>
          {sub && <p className="sub fade-in" style={{ marginBottom: 0 }}>{sub}</p>}
        </div>
        {actions && <div className="row no-print" style={{ justifyContent: 'flex-end' }}>{actions}</div>}
      </div>
    );
  }
  ```

- [ ] **Step 3: Add `Toolbar`.** Append:
  ```tsx
  /* ----------------------------------------------------- arac cubugu (filtre/arama/aksiyon) */
  export function Toolbar({ left, right, className }: { left?: ReactNode; right?: ReactNode; className?: string }) {
    return (
      <div className={`spread ${className ?? ''}`} style={{ marginBottom: 'var(--space-3)' }}>
        <div className="row">{left}</div>
        <div className="row no-print" style={{ justifyContent: 'flex-end' }}>{right}</div>
      </div>
    );
  }
  ```

- [ ] **Step 4: Add `Tabs`.** Append:
  ```tsx
  /* ----------------------------------------------------- segmentli sekmeler */
  export interface TabItem { key: string; label: ReactNode }
  export function Tabs({ items, active, onChange }: { items: TabItem[]; active: string; onChange: (key: string) => void }) {
    return (
      <div className="seg-tabs" role="tablist">
        {items.map((it) => (
          <button
            key={it.key}
            role="tab"
            aria-selected={active === it.key}
            className={`seg-tab ${active === it.key ? 'on' : ''}`}
            onClick={() => onChange(it.key)}
          >
            {it.label}
          </button>
        ))}
      </div>
    );
  }
  ```

- [ ] **Step 5: Add `Field` and `DescriptionList` (`DL`).** Append:
  ```tsx
  /* ----------------------------------------------------- form alani */
  export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
    return (
      <div className="field">
        <label>{label}</label>
        {children}
        {hint && <div className="faint" style={{ fontSize: text.xs, marginTop: 4 }}>{hint}</div>}
      </div>
    );
  }

  /* ----------------------------------------------------- etiket/deger listesi (drawer) */
  export interface DLItem { label: string; value: ReactNode }
  export function DL({ items, columns = 2 }: { items: DLItem[]; columns?: 1 | 2 }) {
    return (
      <div className="grid" style={{ gridTemplateColumns: columns === 2 ? '1fr 1fr' : '1fr', gap: 'var(--space-4)' }}>
        {items.map((it, i) => (
          <div key={i}>
            <div className="faint" style={{ fontSize: text.xs }}>{it.label}</div>
            <div style={{ fontSize: text.md, marginTop: 2, wordBreak: 'break-word' }}>{it.value}</div>
          </div>
        ))}
      </div>
    );
  }
  ```

- [ ] **Step 6: Add `KpiStrip` + `Kpi` (consolidates the 3× `Kpi` + 2× `Mini`).** Append:
  ```tsx
  /* ----------------------------------------------------- KPI seridi (Kpi/Mini/StatCard birlesimi) */
  export interface KpiItem { label: string; value: ReactNode; icon?: ReactNode; hint?: string }
  /** variant='stat' -> buyuk stat-grid karti; variant='mini' -> kompakt net-kpi hucresi. */
  export function Kpi({ label, value, icon, hint, variant = 'stat' }: KpiItem & { variant?: 'stat' | 'mini' }) {
    if (variant === 'mini') {
      return (
        <div className="net-kpi">
          <div className="spread" style={{ gap: 8 }}>
            <span className="faint" style={{ fontSize: text.xs }}>{label}</span>
            {icon && <span className="net-kpi-ic">{icon}</span>}
          </div>
          <div className="tnum" style={{ fontSize: text.lg, fontWeight: 700, marginTop: 4 }}>{value}</div>
          {hint && <div className="faint" style={{ fontSize: text.xs, marginTop: 2 }}>{hint}</div>}
        </div>
      );
    }
    return (
      <div className="card hover stat fade-in">
        <div className="spread">
          <span className="k">{label}</span>
          {icon && <span className="icon">{icon}</span>}
        </div>
        <div className="v">{value}</div>
        {hint && <div className="faint" style={{ fontSize: text.xs, marginTop: 6 }}>{hint}</div>}
      </div>
    );
  }

  export function KpiStrip({ items, variant = 'stat' }: { items: KpiItem[]; variant?: 'stat' | 'mini' }) {
    return (
      <div className={variant === 'mini' ? 'net-kpis' : 'stat-grid'}>
        {items.map((it, i) => <Kpi key={i} {...it} variant={variant} />)}
      </div>
    );
  }
  ```

- [ ] **Step 7: Type-check.**
  ```bash
  cd apps/web && npm run lint
  ```
  Expected: exits 0. If `React.CSSProperties` errors, change line 3 `import { ReactNode, useEffect, useRef, useState } from 'react';` to `import React, { ReactNode, useEffect, useRef, useState } from 'react';`.

- [ ] **Step 8: Commit.**
  ```bash
  git add apps/web/src/components/ui.tsx && git commit -m "feat(web): layout primitives (Card, PageHeader, Toolbar, Tabs, Field, DL, KpiStrip/Kpi)

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 7: `DataTable` primitive integrating existing table plumbing (item 4)

**Files:**
- Modify: `apps/web/src/components/ui.tsx` (append `DataTable` after `KpiStrip`)

Wraps `table`/`.dense`/`.card:has(table)` and reuses the existing `useTablePrefs`/`SortableTh`/`ColumnsMenu`/`Pagination`. Preserves the mobile horizontal-scroll behavior: the table stays a direct child of a `.card`, so the `.card:has(table)` overflow rule (globals.css:241) still matches.

- [ ] **Step 1: Add the `DataTable` primitive.** Append to `ui.tsx`:
  ```tsx
  /* ----------------------------------------------------- veri tablosu primitifi */
  export interface DataTableProps<Row> {
    rows: Row[];
    columns: TableColumn[];
    prefs?: TablePrefs;
    renderHead?: (visible: (key: string) => boolean) => ReactNode;
    renderRow: (row: Row, visible: (key: string) => boolean) => ReactNode;
    rowKey: (row: Row) => string;
    empty?: ReactNode;
    loading?: boolean;
    toolbar?: ReactNode;
    pagination?: { page: number; pageSize: number; total: number; onPage: (p: number) => void };
    caption?: ReactNode;
  }
  /** Kart icinde tablo; .card:has(table) yatay kaydirma + prefs/pagination burada baglanir. */
  export function DataTable<Row>({
    rows, columns, prefs, renderHead, renderRow, rowKey, empty, loading, toolbar, pagination, caption,
  }: DataTableProps<Row>) {
    const visible = (key: string) => (prefs ? prefs.isVisible(key) : true);
    const dense = prefs?.density === 'compact';
    return (
      <div className="card">
        {(caption || toolbar || prefs) && (
          <div className="spread" style={{ marginBottom: 'var(--space-3)' }}>
            <div className="row">{caption}</div>
            <div className="row no-print" style={{ justifyContent: 'flex-end' }}>
              {toolbar}
              {prefs && <ColumnsMenu prefs={prefs} />}
            </div>
          </div>
        )}
        {loading ? <Loading rows={3} /> : (
          <table className={dense ? 'dense' : undefined}>
            {renderHead && <thead><tr>{renderHead(visible)}</tr></thead>}
            <tbody>
              {rows.length === 0
                ? <tr><td colSpan={columns.length || 1} className="muted">{empty ?? 'No rows.'}</td></tr>
                : rows.map((r) => <tr key={rowKey(r)}>{renderRow(r, visible)}</tr>)}
            </tbody>
          </table>
        )}
        {pagination && <Pagination {...pagination} />}
      </div>
    );
  }
  ```
  (`ColumnsMenu`, `Loading`, `Pagination`, `TableColumn`, `TablePrefs` are already defined earlier in this file — no new imports.)

- [ ] **Step 2: Type-check.**
  ```bash
  cd apps/web && npm run lint
  ```
  Expected: exits 0.

- [ ] **Step 3: Manual verification of overflow behavior.** Start `npm run dev`, open any admin table page at a narrow viewport (DevTools ~380px). Confirm a wide table scrolls **inside its card** and the page body does not scroll horizontally. Stop the server.

- [ ] **Step 4: Commit.**
  ```bash
  git add apps/web/src/components/ui.tsx && git commit -m "feat(web): DataTable primitive integrating prefs/sort/columns/pagination

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 8: `Icon.tsx` inline-SVG set (item 5)

**Files:**
- Create: `apps/web/src/components/Icon.tsx`

Replaces OS-dependent emoji/Unicode glyphs. Stroke-based, `currentColor`, sized via a `size` prop. No external icon dependency.

- [ ] **Step 1: Create the icon set.** Create `apps/web/src/components/Icon.tsx`:
  ```tsx
  import { SVGProps } from 'react';

  /**
   * Tek inline-SVG ikon seti. currentColor + `size` prop; stroke-tabanli.
   * Emoji/Unicode glif'lerin yerini alir (OS/tarayici farkiyla farkli render'i onler).
   * Yeni ikon: PATHS'e 24x24 viewBox path'i ekle.
   */
  export type IconName =
    | 'overview' | 'sales' | 'members' | 'network' | 'campaigns'
    | 'payouts' | 'checks' | 'close' | 'audit' | 'settings' | 'platform'
    | 'print' | 'trash' | 'download' | 'search' | 'warning' | 'refresh'
    | 'wallet' | 'invite' | 'home';

  const PATHS: Record<IconName, string> = {
    overview: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm8 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
    sales: 'M3 3v18h18M7 15l4-4 3 3 5-6',
    members: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11',
    network: 'M12 5a3 3 0 1 0 0-.001M6 19a3 3 0 1 0 0-.001M18 19a3 3 0 1 0 0-.001M12 8v3m0 0-4 5m4-5 4 5',
    campaigns: 'M3 11l18-5v12L3 14v-3Zm0 0v6a1 1 0 0 0 1 1h2',
    payouts: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
    checks: 'M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    close: 'M8 2v4M16 2v4M3 10h18M5 6h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
    audit: 'M4 6h16M4 12h16M4 18h10',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.14-1.4l2.1-1.6-2-3.4-2.5 1a7.3 7.3 0 0 0-2.4-1.4L14 2h-4l-.4 2.8a7.3 7.3 0 0 0-2.4 1.4l-2.5-1-2 3.4 2.1 1.6a7.4 7.4 0 0 0 0 2.8L.6 16.6l2 3.4 2.5-1a7.3 7.3 0 0 0 2.4 1.4L10 22h4l.4-2.8a7.3 7.3 0 0 0 2.4-1.4l2.5 1 2-3.4-2.1-1.6c.1-.46.14-.93.14-1.4Z',
    platform: 'M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z',
    print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6v-8Z',
    trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z',
    download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35',
    warning: 'M12 2 1 21h22L12 2Zm0 7v5m0 4h.01',
    refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8m0-5v5h-5',
    wallet: 'M3 7h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Zm0 0 2-4h12l2 4M16 13h2',
    invite: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6',
    home: 'M3 11l9-8 9 8M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10',
  };

  export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        <path d={PATHS[name]} />
      </svg>
    );
  }
  ```

- [ ] **Step 2: Type-check.**
  ```bash
  cd apps/web && npm run lint
  ```
  Expected: exits 0.

- [ ] **Step 3: Manual verification.** In `npm run dev`, temporarily render `<Icon name="payouts" />` inside `apps/web/src/app/admin/payouts/page.tsx`. Confirm the SVG renders and inherits text color. Revert the temporary render. Stop the server.

- [ ] **Step 4: Commit.**
  ```bash
  git add apps/web/src/components/Icon.tsx && git commit -m "feat(web): inline-SVG Icon set to replace emoji glyphs

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 9: TanStack Query provider + tenant-scoped hooks (item 6)

**Files:**
- Modify: `apps/web/package.json` (add dep + scripts)
- Create: `apps/web/src/lib/queryClient.tsx`
- Create: `apps/web/src/lib/queries/payouts.ts`
- Test: `apps/web/src/lib/queries/payouts.test.mts`
- Modify: `apps/web/src/app/layout.tsx` (wrap children)

> **Tenant-safety (constraint 1 / item 6):** every query key MUST include the active tenant/session identity so a persona/tenant switch never serves another tenant's cached rows. This is the client mirror of the server `where:{ tenantId }` rule.

- [ ] **Step 1: Add the dependency and scripts.** Edit `apps/web/package.json`:
  - Under `"dependencies"`, add: `"@tanstack/react-query": "^5.62.0",`
  - Under `"scripts"`, add: `"test:unit": "node --test \"src/**/*.test.mts\"",` and keep `"lint": "tsc --noEmit"`.
  Then install:
  ```bash
  cd apps/web && pnpm install
  ```
  Expected: `@tanstack/react-query` added to the lockfile.

- [ ] **Step 2: Write the failing test for tenant-scoped keys.** Create `apps/web/src/lib/queries/payouts.test.mts`:
  ```ts
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { payoutsKey } from './keys.ts';

  test('key includes the tenant identity', () => {
    const k = payoutsKey('tenant-A', { status: 'requested', page: 1 });
    assert.ok(k.includes('tenant-A'), 'tenant id must be part of the key');
  });

  test('two tenants never share a cache key', () => {
    const a = JSON.stringify(payoutsKey('tenant-A', { status: 'paid', page: 2 }));
    const b = JSON.stringify(payoutsKey('tenant-B', { status: 'paid', page: 2 }));
    assert.notEqual(a, b);
  });

  test('different filters produce different keys within a tenant', () => {
    const a = JSON.stringify(payoutsKey('tenant-A', { status: 'paid', page: 1 }));
    const b = JSON.stringify(payoutsKey('tenant-A', { status: 'failed', page: 1 }));
    assert.notEqual(a, b);
  });
  ```
  (The key builder lives in a dependency-free `keys.ts` so `node --test` can import it without hitting the `@/` alias or React — the hook module in Step 4 re-exports it.)

- [ ] **Step 3: Run to verify it fails.**
  ```bash
  cd apps/web && node --test src/lib/queries/payouts.test.mts
  ```
  Expected: fails — `./keys.ts` does not exist.

- [ ] **Step 4: Create the key builder and the hooks module.** Create `apps/web/src/lib/queries/keys.ts`:
  ```ts
  export interface PayoutHistoryFilters { status?: string; period?: string; page: number }

  /** Tenant + filtre ile anahtarlanan payout gecmisi cache key'i (dependency-free). */
  export function payoutsKey(tenantId: string, filters: PayoutHistoryFilters) {
    return ['payouts', 'history', tenantId, filters.status ?? '', filters.period ?? '', filters.page] as const;
  }
  ```
  Create `apps/web/src/lib/queries/payouts.ts`:
  ```ts
  import { useQuery, keepPreviousData } from '@tanstack/react-query';
  import { api } from '@/lib/api';
  import { getSession, activeMembership } from '@/lib/auth';
  import { payoutsKey, type PayoutHistoryFilters } from './keys';

  export type { PayoutHistoryFilters };
  export { payoutsKey };

  export interface PayoutItem {
    id: string; membershipId: string; referralCode: string; fullName: string;
    totalCents: string; method: string; status: string; period: string;
    paidAt: string | null; ref: string | null; clearedAt?: string | null; bankRef?: string | null;
  }
  export interface PayoutListResp { total: number; page: number; pageSize: number; items: PayoutItem[] }

  /** Aktif tenant kimligi — cache key'e girer; tenant switch'te capraz-okuma OLMAZ. */
  export function activeTenantId(): string {
    const s = getSession();
    return (s ? activeMembership(s)?.membershipId : null) ?? 'anon';
  }

  /** Payout gecmisi sorgusu — keepPreviousData ile sayfalama, 4xx'te retry KAPALI (provider). */
  export function usePayoutHistory(filters: PayoutHistoryFilters) {
    const tenantId = activeTenantId();
    return useQuery({
      queryKey: payoutsKey(tenantId, filters),
      queryFn: () => {
        const p = new URLSearchParams({ page: String(filters.page), pageSize: '25' });
        if (filters.status) p.set('status', filters.status);
        if (filters.period) p.set('period', filters.period);
        return api.get<PayoutListResp>(`/admin/payouts?${p.toString()}`);
      },
      placeholderData: keepPreviousData,
    });
  }
  ```

- [ ] **Step 5: Run to verify it passes.**
  ```bash
  cd apps/web && node --test src/lib/queries/payouts.test.mts
  ```
  Expected: `pass 3`, `fail 0`.

- [ ] **Step 6: Create the provider.** Create `apps/web/src/lib/queryClient.tsx`:
  ```tsx
  'use client';

  import { ReactNode, useState } from 'react';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { ApiError } from '@/lib/api';

  /** Web geneli Query saglayici. 4xx'te retry YOK (ApiError.status); mutasyonlar cache'lenmez. */
  export function AppQueryProvider({ children }: { children: ReactNode }) {
    const [client] = useState(() => new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          refetchOnWindowFocus: false,
          retry: (failureCount, error) => {
            if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
            return failureCount < 2;
          },
        },
      },
    }));
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  ```

- [ ] **Step 7: Wrap the app root.** Edit `apps/web/src/app/layout.tsx`:
  - Add import after line 6: `import { AppQueryProvider } from '@/lib/queryClient';`
  - Change the body block (lines 34-38) from:
    ```tsx
        <body>
          <OfflineBanner />
          {children}
          <ServiceWorkerRegister />
        </body>
    ```
    to:
    ```tsx
        <body>
          <OfflineBanner />
          <AppQueryProvider>{children}</AppQueryProvider>
          <ServiceWorkerRegister />
        </body>
    ```

- [ ] **Step 8: Type-check.**
  ```bash
  cd apps/web && npm run lint
  ```
  Expected: exits 0.

- [ ] **Step 9: Commit.**
  ```bash
  git status --short  # confirm lockfile location before adding
  git add apps/web/package.json apps/web/src/lib/queryClient.tsx apps/web/src/lib/queries/ apps/web/src/app/layout.tsx pnpm-lock.yaml && git commit -m "feat(web): TanStack Query provider + tenant-scoped payout hooks

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 10: `AppShell` unified nav + `CommandPalette` on all personas (item 5)

**Files:**
- Modify: `apps/web/src/components/CommandPalette.tsx` (accept persona-scoped nav targets)
- Create: `apps/web/src/components/AppShell.tsx`

> **Decision gate: assumes systematize on hand-rolled tokens (item 1 recommended option).** `AppShell` renders the existing `.shell/.side` and `.topbar` classes unchanged. If shadcn is chosen instead later, only `AppShell`'s internal markup changes — its `persona`/`nav` props stay the same, so layouts and pages are untouched. Under that alternative, only this task's `AppShell.tsx` body is rewritten; Task 11's three layouts (which consume the props) do not change.

- [ ] **Step 1: Make `CommandPalette` accept nav targets and permission-gate search.** Edit `apps/web/src/components/CommandPalette.tsx`:
  - Delete the module-level `const NAV` (lines 14-23).
  - Change the signature (line 26) from `export function CommandPalette() {` to:
    ```tsx
    export interface CmdNavTarget { label: string; path: string }
    export function CommandPalette({ nav, searchEnabled = true }: { nav: CmdNavTarget[]; searchEnabled?: boolean }) {
    ```
  - In the search effect (lines 47-53), add the `searchEnabled` guard:
    ```tsx
    useEffect(() => {
      if (!open || !searchEnabled) return;
      const term = q.trim();
      if (term.length < 2) { setRes(null); return; }
      const id = setTimeout(() => { api.get<SearchResp>(`/admin/search?q=${encodeURIComponent(term)}`).then(setRes).catch(() => {}); }, 200);
      return () => clearTimeout(id);
    }, [q, open, searchEnabled]);
    ```
  - In the `items` useMemo (lines 58-64), replace the local `NAV` reference with the `nav` prop:
    ```tsx
    const navItems = nav.filter((n) => !ql || n.label.toLowerCase().includes(ql)).map((n) => ({ key: 'nav:' + n.path, label: n.label, run: () => go(n.path) }));
    const members = (res?.members ?? []).map((m) => ({ key: 'm:' + m.id, label: m.name, hint: `member · ${m.code}`, run: () => go('/admin/members') }));
    const sales = (res?.sales ?? []).map((s) => ({ key: 's:' + s.id, label: `${money(s.amountCents, s.currency)} · ${s.sellerName}`, hint: `sale · ${s.status}${s.customerRef ? ' · ' + s.customerRef : ''}`, run: () => go('/admin/sales') }));
    return [...navItems, ...members, ...sales];
    ```

- [ ] **Step 2: Create `AppShell`.** Create `apps/web/src/components/AppShell.tsx`:
  ```tsx
  'use client';

  import { ReactNode, useEffect, useState } from 'react';
  import { usePathname } from 'next/navigation';
  import Link from 'next/link';
  import { ThemeToggle } from '@/components/ui';
  import { Icon, IconName } from '@/components/Icon';
  import { CommandPalette, CmdNavTarget } from '@/components/CommandPalette';
  import { APP_MONOGRAM, APP_NAME } from '@/lib/brand';

  export type Persona = 'admin' | 'platform' | 'member';
  export interface ShellNavItem { href: string; label: string; icon: IconName; exact?: boolean }

  /**
   * Tek yerlesim: admin+platform -> .shell/.side (yan menu), member -> .topbar (ust bar).
   * CommandPalette tum persona'larda mount (Cmd/Ctrl+K). Mobil off-canvas drawer korunur.
   */
  export function AppShell({ persona, nav, footer, topbarExtras, cmdNav, cmdSearch, children }: {
    persona: Persona;
    nav: ShellNavItem[];
    footer?: ReactNode;
    topbarExtras?: ReactNode;
    cmdNav: CmdNavTarget[];
    cmdSearch?: boolean;
    children: ReactNode;
  }) {
    const pathname = usePathname();
    const [navOpen, setNavOpen] = useState(false);
    useEffect(() => { setNavOpen(false); }, [pathname]);

    const isActive = (n: ShellNavItem) => (n.exact === false ? pathname.startsWith(n.href) : pathname === n.href);

    if (persona === 'member') {
      return (
        <div>
          <header className="topbar">
            <div className="inner">
              <span className="brand"><span className="dot">{APP_MONOGRAM}</span> {APP_NAME}</span>
              <nav>
                {nav.map((n) => (
                  <Link key={n.href} href={n.href} className={isActive(n) ? 'active' : ''}>
                    <span style={{ opacity: 0.85, marginRight: 6, display: 'inline-flex', verticalAlign: '-3px' }}><Icon name={n.icon} size={16} /></span>{n.label}
                  </Link>
                ))}
              </nav>
              {topbarExtras}
              <ThemeToggle />
            </div>
          </header>
          <main className="appmain">{children}</main>
          <CommandPalette nav={cmdNav} searchEnabled={cmdSearch ?? false} />
        </div>
      );
    }

    return (
      <div className={`shell${navOpen ? ' nav-open' : ''}`}>
        <div className="mobile-topbar no-print">
          <button className="hamburger" aria-label="Menu" aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}><Icon name="audit" /></button>
          <div className="brand"><span className="dot">{APP_MONOGRAM}</span> {APP_NAME}</div>
          <div className="row" style={{ gap: 6, marginLeft: 'auto' }}>{topbarExtras}<ThemeToggle /></div>
        </div>
        {navOpen && <div className="nav-backdrop no-print" onClick={() => setNavOpen(false)} aria-hidden="true" />}
        <aside className="side">
          <div className="brand"><span className="dot">{APP_MONOGRAM}</span> {APP_NAME}</div>
          <nav>
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={isActive(n) ? 'active' : ''} onClick={() => setNavOpen(false)}>
                <span className="ic"><Icon name={n.icon} size={16} /></span>{n.label}
              </Link>
            ))}
          </nav>
          {footer && <div className="foot">{footer}</div>}
        </aside>
        <main className="main">{children}</main>
        <CommandPalette nav={cmdNav} searchEnabled={cmdSearch ?? false} />
      </div>
    );
  }
  ```

- [ ] **Step 3: Type-check.**
  ```bash
  cd apps/web && npm run lint
  ```
  Expected: fails only in the three layout files that still call `<CommandPalette />` with no props / render inline shells — those are rewired in Task 11. If `AppShell.tsx` or `CommandPalette.tsx` themselves have type errors, fix them now.

- [ ] **Step 4: Commit.**
  ```bash
  git add apps/web/src/components/AppShell.tsx apps/web/src/components/CommandPalette.tsx && git commit -m "feat(web): AppShell unified nav; CommandPalette accepts persona-scoped targets

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 11: Rewire the three layouts onto `AppShell` (item 5)

**Files:**
- Modify: `apps/web/src/app/admin/layout.tsx`
- Modify: `apps/web/src/app/platform/layout.tsx`
- Modify: `apps/web/src/app/app/layout.tsx`

Each layout keeps its own auth/session/logout logic and passes persona-specific `nav`, `footer`, `topbarExtras`, and `cmdNav` into `AppShell`. Permission gating (admin-only nav filtering, member routes only for members) stays in the layout that owns it.

- [ ] **Step 1: Rewire admin layout.** In `apps/web/src/app/admin/layout.tsx`, keep all auth `useEffect`s, `logout`, and `isStaff`/`isPlatform` derivation. Replace the `NAV` const (lines 14-25), add `CMD_NAV`, and replace the returned JSX (lines 65-107):
  ```tsx
  import { AppShell, ShellNavItem } from '@/components/AppShell';
  import { CmdNavTarget } from '@/components/CommandPalette';
  // remove the direct CommandPalette import and the inline shell markup imports no longer used

  const NAV: Array<ShellNavItem & { adminOnly?: boolean }> = [
    { href: '/admin', label: 'Overview', icon: 'overview' },
    { href: '/admin/sales', label: 'Sales', icon: 'sales' },
    { href: '/admin/members', label: 'Members', icon: 'members' },
    { href: '/admin/tree', label: 'Network', icon: 'network' },
    { href: '/admin/campaigns', label: 'Campaigns', icon: 'campaigns' },
    { href: '/admin/payouts', label: 'Payouts', icon: 'payouts', adminOnly: true },
    { href: '/admin/checks', label: 'Checks', icon: 'checks', adminOnly: true },
    { href: '/admin/periods', label: 'Close', icon: 'close', adminOnly: true },
    { href: '/admin/audit', label: 'Audit', icon: 'audit', adminOnly: true },
    { href: '/admin/settings', label: 'Settings', icon: 'settings', adminOnly: true },
  ];

  const CMD_NAV: CmdNavTarget[] = [
    { label: 'Go to Overview', path: '/admin' },
    { label: 'Go to Sales', path: '/admin/sales' },
    { label: 'Go to Members', path: '/admin/members' },
    { label: 'Go to Network', path: '/admin/tree' },
    { label: 'Go to Campaigns', path: '/admin/campaigns' },
    { label: 'Go to Payouts', path: '/admin/payouts' },
    { label: 'Go to Audit', path: '/admin/audit' },
    { label: 'Go to Settings', path: '/admin/settings' },
  ];
  ```
  Return (replacing lines 65-107):
  ```tsx
    return (
      <AppShell
        persona="admin"
        nav={NAV.filter((n) => !(n.adminOnly && isStaff)).concat(isPlatform ? [{ href: '/platform', label: 'Platform', icon: 'platform', exact: false }] : [])}
        cmdNav={CMD_NAV}
        cmdSearch
        topbarExtras={<NotificationBell />}
        footer={
          <>
            <div className="faint" style={{ fontSize: 11 }}>{active?.tenantName}</div>
            <Link href="/account" title="Account settings" style={{ fontSize: 13, fontWeight: 600, margin: '2px 0 4px', display: 'inline-block', color: 'var(--text)' }}>{session.user.fullName} <span className="faint" style={{ fontWeight: 400 }}>⚙</span></Link>
            <div className="row spread">
              <span className="badge active" style={{ fontSize: 10 }}>{active?.role}</span>
              <div className="row" style={{ gap: 6 }}>
                <LiveIndicator />
                <NotificationBell placement="up" />
                <button className="btn ghost sm" onClick={logout}>{t('nav.logout')}</button>
              </div>
            </div>
          </>
        }
      >
        {children}
      </AppShell>
    );
  ```
  Remove now-unused `CommandPalette`/`ThemeToggle`/`APP_MONOGRAM`/`APP_NAME` imports, the `navOpen` state, the `setNavOpen` effect, and `usePathname`/`Link`(if unused) as the type-check flags them.

- [ ] **Step 2: Rewire platform layout.** In `apps/web/src/app/platform/layout.tsx`, keep the auth logic; replace the shell JSX with `AppShell persona="platform"`:
  ```tsx
  import { AppShell, ShellNavItem } from '@/components/AppShell';
  import { CmdNavTarget } from '@/components/CommandPalette';

  const NAV: ShellNavItem[] = [{ href: '/platform', label: 'Companies', icon: 'platform' }];
  const CMD_NAV: CmdNavTarget[] = [{ label: 'Go to Companies', path: '/platform' }];
  ```
  Return:
  ```tsx
    return (
      <AppShell
        persona="platform"
        nav={NAV}
        cmdNav={CMD_NAV}
        footer={
          <>
            <div className="faint" style={{ fontSize: 11 }}>Platform owner</div>
            <div style={{ fontSize: 13, fontWeight: 600, margin: '2px 0 4px' }}>{session.user.fullName}</div>
            <div className="row spread">
              <span className="badge active" style={{ fontSize: 10 }}>platform</span>
              <button className="btn ghost sm" onClick={logout}>Log out</button>
            </div>
          </>
        }
      >
        {children}
      </AppShell>
    );
  ```
  Delete now-unused `navOpen`/`usePathname`/`APP_MONOGRAM`/`APP_NAME`/`ThemeToggle`/`Link` imports as flagged.

- [ ] **Step 3: Rewire member layout.** In `apps/web/src/app/app/layout.tsx`, keep the impersonation banner and auth logic; render it **above** `AppShell persona="member"`:
  ```tsx
  import { AppShell, ShellNavItem } from '@/components/AppShell';
  import { CmdNavTarget } from '@/components/CommandPalette';

  const NAV: ShellNavItem[] = [
    { href: '/app', label: 'Home', icon: 'home' },
    { href: '/app/wallet', label: 'Wallet', icon: 'wallet' },
    { href: '/app/sales', label: 'Sales', icon: 'sales' },
    { href: '/app/team', label: 'Team', icon: 'members' },
    { href: '/app/invite', label: 'Invite', icon: 'invite' },
  ];
  const CMD_NAV: CmdNavTarget[] = [
    { label: 'Go to Home', path: '/app' },
    { label: 'Go to Wallet', path: '/app/wallet' },
    { label: 'Go to Sales', path: '/app/sales' },
    { label: 'Go to Team', path: '/app/team' },
    { label: 'Go to Invite', path: '/app/invite' },
  ];
  ```
  Return:
  ```tsx
    return (
      <div>
        {imp && (
          <div className="no-print" style={{ background: 'var(--amber)', color: '#1a1404', padding: '8px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontSize: 13, fontWeight: 600 }}>
            <span>👁 Viewing as <b>{session.user.fullName}</b> — read only</span>
            <button className="btn sm" style={{ background: '#1a1404', color: 'var(--amber)' }} onClick={exitImpersonation}>Exit impersonation</button>
          </div>
        )}
        <AppShell
          persona="member"
          nav={NAV}
          cmdNav={CMD_NAV}
          topbarExtras={
            <>
              <span className="faint" style={{ fontSize: 12 }}>{active?.tenantName}</span>
              <NotificationBell />
              <Link href="/account" className="btn ghost sm" title="Account settings">Account</Link>
              <button className="btn ghost sm" onClick={logout}>{t('nav.logout')}</button>
            </>
          }
        >
          {children}
        </AppShell>
      </div>
    );
  ```
  Delete now-unused `Brand`/`usePathname`/`ThemeToggle` imports as flagged.

- [ ] **Step 4: Type-check the whole app.**
  ```bash
  cd apps/web && npm run lint
  ```
  Expected: exits 0. Fix any "declared but never read" errors by removing the dead imports/state noted above.

- [ ] **Step 5: Manual verification — CommandPalette on all three personas.** In `npm run dev`:
  - Admin: at `/admin`, press Cmd/Ctrl+K → palette opens with "Go to …" targets and member/sale search works. Sidebar shows SVG icons (no emoji).
  - Platform: at `/platform`, Cmd/Ctrl+K → "Go to Companies" only (no admin routes leaked, search returns nothing since disabled).
  - Member: at `/app`, Cmd/Ctrl+K → member "Go to …" targets only (search disabled).
  - On each, shrink to ~380px: hamburger/off-canvas drawer (admin/platform) and member topbar wrap still work.
  Stop the server.

- [ ] **Step 6: Commit.**
  ```bash
  git add apps/web/src/app/admin/layout.tsx apps/web/src/app/platform/layout.tsx apps/web/src/app/app/layout.tsx && git commit -m "refactor(web): unify 3 layouts on AppShell; CommandPalette on all personas; SVG nav icons

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 12: Payouts vertical slice — rebuild on primitives + Query (items 5, 6, 3, 7)

**Files:**
- Modify: `apps/web/src/app/admin/payouts/page.tsx`

Rebuild the page to consume kit primitives and the Query hook. Scope (representative migration, NOT every sub-table at once): migrate the **PageHeader**, all `` `badge ${x}` `` sites, the history table's inline `money()` to `<Money>`, the history table to `<DataTable>` + `usePayoutHistory`, and the drawer's label/value pairs to `<DL>`. Leave the reject/reconcile/reason modals' internal markup intact except for badge/`Money` swaps. Do NOT change any API endpoint or the `PayoutDrawer` fetch logic beyond badge/`Money`/`DL` swaps.

- [ ] **Step 1: Update imports.** In `payouts/page.tsx`, change line 6 to:
  ```tsx
  import { Confirm, DataTable, DL, Loading, Modal, Money, MoneyCounter, PageHeader, StatusBadge, useToast } from '@/components/ui';
  ```
  Change line 10 to: `import { dateShort, money, statusBadge } from '@/lib/format';`
  Add: `import { text } from '@/lib/tokens';` and `import { usePayoutHistory, type PayoutItem, type PayoutListResp } from '@/lib/queries/payouts';`
  Remove the local `PayoutItem`/`PayoutListResp` interface declarations (lines 15-16) since they now come from the hook module (identical shape).

- [ ] **Step 2: Replace the page header (lines 210-212) with `PageHeader`.**
  ```tsx
        <PageHeader
          eyebrow={t('nav.payouts')}
          title="Payout Management"
          sub="Approve member requests, pay members above the threshold, and download the bank CSV."
        />
  ```

- [ ] **Step 3: Adopt `usePayoutHistory` for the history table.** Remove `const [history, setHistory] = useState<PayoutListResp | null>(null);` (line 39), the `historyQuery` memo (lines 62-67), the `loadHistory` callback (lines 157-160), and the `useEffect(() => { void loadHistory(); }, [loadHistory]);` (line 163). Add near the other hooks:
  ```tsx
  const historyQ = usePayoutHistory({ status: hStatus || undefined, period: hPeriod || undefined, page: hPage });
  const history = historyQ.data ?? null;
  ```
  In `refreshAll` (line 165), replace `loadHistory()` with `historyQ.refetch()` (keep `loadCore()`).

- [ ] **Step 4: Swap badge interpolations to `<StatusBadge>` / `statusBadge().className`.**
  - Drawer (line 557): `<div><span className={`badge ${d.status}`}>{d.status}</span></div>` → `<div><StatusBadge status={d.status} /></div>`
  - Fraud row (line 319): keep the score inside the pill but use the mapper's class: `<td><span className={statusBadge(f.blocked ? 'failed' : 'pending').className}>{f.score}{f.blocked ? ' · blocked' : ''}</span></td>`
  (The literal `.badge requested`/`.badge pending`/`.badge failed`/`.badge payable` count pills at lines 237/264/292/311/338 are static styled classes and may remain; convert them to `<StatusBadge>` only if the badge shows a status value, which these do not — they show counts.)

- [ ] **Step 5: Rebuild the history card as `<DataTable>` with `<Money>`.** Replace the history `<div className="card fade-in delay-3">…</div>` block (lines 392-421) with:
  ```tsx
        <DataTable<PayoutItem>
          rows={history?.items ?? []}
          columns={[{ key: 'member', label: 'Member' }, { key: 'amount', label: 'Amount' }, { key: 'method', label: 'Method' }, { key: 'status', label: 'Status' }, { key: 'period', label: 'Period' }, { key: 'date', label: 'Date' }]}
          rowKey={(p) => p.id}
          loading={historyQ.isLoading}
          empty="No payouts match these filters."
          caption={<strong>{t('payouts.history')}{history ? ` · ${history.total}` : ''}</strong>}
          toolbar={
            <>
              <input type="month" value={hPeriod} onChange={(e) => { setHPeriod(e.target.value); setHPage(1); }} aria-label="Period" style={{ width: 'auto' }} />
              <select value={hStatus} onChange={(e) => { setHStatus(e.target.value); setHPage(1); }} style={{ width: 'auto' }} aria-label="Status">
                {HISTORY_STATUS.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
              </select>
            </>
          }
          renderHead={() => (<><th>Member</th><th>Amount</th><th>Method</th><th>Status</th><th>Period</th><th>Date</th></>)}
          renderRow={(p) => (
            <>
              <td onClick={() => setDetailId(p.id)} style={{ cursor: 'pointer' }}>{p.fullName}<div className="faint" style={{ fontSize: text.sm }}>{p.referralCode}</div></td>
              <td className="tnum"><Money cents={p.totalCents} currency={c} /></td>
              <td className="faint">{p.method}</td>
              <td><StatusBadge status={p.status} />{p.clearedAt ? <span className="badge paid" style={{ marginLeft: 6, fontSize: text.xs }} title={p.bankRef ? `Bank ref: ${p.bankRef}` : 'Bank reconciled'}>✓ cleared</span> : null}</td>
              <td>{p.period}</td>
              <td className="muted">{dateShort(p.paidAt)}</td>
            </>
          )}
          pagination={history ? { page: history.page, pageSize: history.pageSize, total: history.total, onPage: setHPage } : undefined}
        />
  ```

- [ ] **Step 6: Replace standalone inline `money(...)` in table cells with `<Money>`** (JSX contexts only): line 246 `{money(r.totalCents, c)}` → `<Money cents={r.totalCents} currency={c} />`; line 273, line 300, and the payable rows lines 380-382 similarly. Leave `money()` calls that build interpolated strings (Confirm `message` lines 427-428, threshold text line 220, drawer title line 543, print sheet) as `money()` — `<Money>` is JSX-only.

- [ ] **Step 7: Migrate the drawer's label/value pairs to `<DL>`.** Replace lines 558-565 (the `Field`-grid) with:
  ```tsx
            <DL items={[
              { label: 'Member', value: `${d.member.fullName} · ${d.member.referralCode}` },
              { label: 'Email', value: d.member.email },
              { label: 'Method', value: d.method },
              { label: 'Reference', value: d.ref ?? '—' },
              { label: 'Period', value: d.period },
              { label: 'Paid at', value: d.paidAt ? dateShort(d.paidAt) : '—' },
            ]} />
  ```
  Delete the now-unused local `Field` function (lines 625-632).

- [ ] **Step 8: Type-check.**
  ```bash
  cd apps/web && npm run lint
  ```
  Expected: exits 0. Resolve any unused-symbol errors from removed state/helpers (e.g. leftover `PayoutListResp` import if unused, or `useMemo`).

- [ ] **Step 9: Confirm the slice is clean of the two target smells.**
  ```bash
  cd apps/web && grep -nE "badge \\$\\{" src/app/admin/payouts/page.tsx; echo "badge-interp exit:$?"
  grep -nE "fontSize: *-?[0-9]" src/app/admin/payouts/page.tsx; echo "raw-fontsize exit:$?"
  ```
  Expected: both greps print **no matches** and exit `1`. Convert any remaining numeric `fontSize` (e.g. the `10`/`11`/`12`/`13.5` literals in the untouched count-pill spans and the reason/reject modals within this file) to `text.*` tokens so the whole file is lint-clean for Task 13.

- [ ] **Step 10: Manual verification (dark + light).** In `npm run dev`, open `/admin/payouts` as a seeded admin:
  - History renders via DataTable, paginates without flashing empty (keepPreviousData), amounts via `<Money>`, statuses via `<StatusBadge>` (no uncolored pills; an unknown/`suspended` status renders a neutral grey pill, not transparent).
  - Toggle to light theme: badges, borders, hero read correctly.
  - Open a payout row → drawer shows the `DL` pairs and a `<StatusBadge>`.
  Stop the server.

- [ ] **Step 11: Commit.**
  ```bash
  git add apps/web/src/app/admin/payouts/page.tsx && git commit -m "refactor(web): rebuild Payouts slice on kit primitives + TanStack Query

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 13: ESLint guardrails + `migrated` allowlist (items 2, 7)

**Files:**
- Modify: `apps/web/package.json` (devDeps + `lint:eslint` script)
- Create: `apps/web/eslint-rules/no-raw-fontsize.js`
- Create: `apps/web/eslint-rules/no-stray-inline-style.js`
- Create: `apps/web/eslint.config.mjs`

The repo has no ESLint today; add a self-contained flat config with two local rules. Rule 1 (`no-raw-fontsize`) reports a numeric `fontSize` in any JSX `style` object literal (geometry props like `strokeWidth`/`r` are untouched — the rule keys only on `fontSize`). Rule 2 (`no-stray-inline-style`) warns on `style={{` in files in the `migrated` allowlist and flags `rgba(255,255,255,` literals there (item 7 CI gate). Rule 1 ships at `error` because `ui.tsx` + the Payouts slice are clean after Tasks 4 and 12.

- [ ] **Step 1: Add ESLint deps + script.** Edit `apps/web/package.json`:
  - Under `"devDependencies"`, add: `"eslint": "^9.17.0",` and `"@typescript-eslint/parser": "^8.20.0",`
  - Under `"scripts"`, add: `"lint:eslint": "eslint \"src/**/*.{ts,tsx}\"",`
  ```bash
  cd apps/web && pnpm install
  ```

- [ ] **Step 2: Create Rule 1.** Create `apps/web/eslint-rules/no-raw-fontsize.js`:
  ```js
  'use strict';
  /** Forbid a numeric `fontSize` inside a JSX style object literal. Use a --text-* var / tokens.text.* instead. */
  module.exports = {
    meta: {
      type: 'problem',
      docs: { description: 'disallow raw numeric fontSize in JSX style objects; use --text-* tokens' },
      schema: [],
      messages: { raw: 'Raw numeric fontSize is not allowed. Use a `var(--text-*)` value or tokens.text.* (see lib/tokens.ts).' },
    },
    create(context) {
      return {
        Property(node) {
          if (
            node.key &&
            ((node.key.type === 'Identifier' && node.key.name === 'fontSize') ||
             (node.key.type === 'Literal' && node.key.value === 'fontSize')) &&
            node.value &&
            ((node.value.type === 'Literal' && typeof node.value.value === 'number') ||
             (node.value.type === 'UnaryExpression' && node.value.operator === '-' &&
              node.value.argument.type === 'Literal' && typeof node.value.argument.value === 'number'))
          ) {
            context.report({ node: node.value, messageId: 'raw' });
          }
        },
      };
    },
  };
  ```

- [ ] **Step 3: Create Rule 2.** Create `apps/web/eslint-rules/no-stray-inline-style.js`:
  ```js
  'use strict';
  /**
   * In files already migrated to primitives (config option `migrated`), warn on:
   *  - any inline `style={{ ... }}` JSX attribute (prefer a primitive/class), and
   *  - any string literal containing `rgba(255,255,255,` (dark-only hairline; use --border/--panel-*).
   * Non-migrated files are ignored (rollout allowlist).
   */
  module.exports = {
    meta: {
      type: 'suggestion',
      docs: { description: 'warn on stray inline styles / dark-only rgba in migrated files' },
      schema: [{ type: 'object', properties: { migrated: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }],
      messages: {
        stray: 'Inline style in a migrated file — prefer a kit primitive or a globals.css class.',
        rgba: 'Hardcoded rgba(255,255,255,…) does not read on the light theme. Use var(--border)/var(--panel-2) etc.',
      },
    },
    create(context) {
      const opts = context.options[0] || {};
      const migrated = opts.migrated || [];
      const filename = context.getFilename().replace(/\\/g, '/');
      const isMigrated = migrated.some((m) => filename.endsWith(m));
      if (!isMigrated) return {};
      return {
        JSXAttribute(node) {
          if (node.name && node.name.name === 'style' && node.value && node.value.type === 'JSXExpressionContainer' &&
              node.value.expression.type === 'ObjectExpression') {
            context.report({ node, messageId: 'stray' });
          }
        },
        Literal(node) {
          if (typeof node.value === 'string' && node.value.includes('rgba(255,255,255,')) {
            context.report({ node, messageId: 'rgba' });
          }
        },
      };
    },
  };
  ```

- [ ] **Step 4: Create the flat config.** Create `apps/web/eslint.config.mjs`:
  ```js
  import tsParser from '@typescript-eslint/parser';
  import noRawFontsize from './eslint-rules/no-raw-fontsize.js';
  import noStrayInlineStyle from './eslint-rules/no-stray-inline-style.js';

  // Files fully migrated to the primitives kit. Rule 2 is enforced only here (rollout allowlist).
  const MIGRATED = [
    'src/app/admin/payouts/page.tsx',
    'src/components/ui.tsx',
  ];

  export default [
    {
      files: ['src/**/*.{ts,tsx}'],
      languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } } },
      plugins: { local: { rules: { 'no-raw-fontsize': noRawFontsize, 'no-stray-inline-style': noStrayInlineStyle } } },
      rules: {
        'local/no-raw-fontsize': 'error',
        'local/no-stray-inline-style': ['warn', { migrated: MIGRATED }],
      },
    },
  ];
  ```

- [ ] **Step 5: Run ESLint — expect the slice + `ui.tsx` clean of Rule 1.**
  ```bash
  cd apps/web && npm run lint:eslint
  ```
  Expected: **no `local/no-raw-fontsize` errors**. If a pre-existing file outside this track's scope trips it, add that file to an `ignores` block in `eslint.config.mjs` with a `// TODO(design-system): tokenize in a later slice` comment (do NOT weaken the rule to `warn`). `no-stray-inline-style` may emit **warnings** for intentional geometry inline styles in `ui.tsx` — warnings don't fail the run.

- [ ] **Step 6: Verify the light-theme grep gate on migrated files.**
  ```bash
  cd apps/web && grep -n "rgba(255,255,255," src/app/admin/payouts/page.tsx src/components/ui.tsx; echo "exit:$?"
  ```
  Expected: no matches, exit `1`.

- [ ] **Step 7: Commit.**
  ```bash
  git status --short  # confirm lockfile location
  git add apps/web/package.json apps/web/eslint.config.mjs apps/web/eslint-rules/ pnpm-lock.yaml && git commit -m "chore(web): local ESLint guardrails (no-raw-fontsize, no-stray-inline-style) with migrated allowlist

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 14: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run all web pure-logic unit tests.**
  ```bash
  cd apps/web && node --test src/lib/tokens.test.mts src/lib/format.test.mts src/lib/queries/payouts.test.mts
  ```
  Expected: `pass 11`, `fail 0` (3 + 5 + 3).

- [ ] **Step 2: Type-check the whole web app.**
  ```bash
  cd apps/web && npm run lint
  ```
  Expected: exits 0.

- [ ] **Step 3: ESLint guardrails pass.**
  ```bash
  cd apps/web && npm run lint:eslint
  ```
  Expected: 0 errors (warnings allowed).

- [ ] **Step 4: Production build sanity (catches App Router/provider wiring issues).**
  ```bash
  cd apps/web && npm run build
  ```
  Expected: build succeeds. If it fails on `QueryClientProvider` needing a client boundary, confirm `queryClient.tsx` starts with `'use client'` (it does).

- [ ] **Step 5: Confirm the API is untouched (no cross-track regression).**
  ```bash
  git diff --name-only main...HEAD -- apps/api | head
  ```
  Expected: **no output** (this track changes no backend files).

- [ ] **Step 6: Final commit (only if incidental fixes were needed).**
  ```bash
  git add -A && git commit -m "chore(web): design-system track verification pass

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" || echo "nothing to commit"
  ```

---

## Self-review — spec coverage

- **Item 1 (core decision gate):** Task 1 records "systematize on hand-rolled tokens, layer any future shadcn under the same kit" in `docs/DECISIONS.md`. A bold decision-gate note is placed on Task 10 (AppShell) — the one task whose markup would change under the shadcn alternative — stating that only `AppShell.tsx`'s body changes and Task 11's props-consuming layouts do not.
- **Item 2 (typed tokens + lint):** Task 2 creates `lib/tokens.ts` (values are `var(--…)` strings, not raw px) with a drift test asserting coverage of every `--text-*`/`--space-*` var (regex over `globals.css`). Task 4 migrates `ui.tsx`'s own `fontSize` literals as the reference implementation. Task 13 adds the two project-local flat-config ESLint rules, starts `no-stray-inline-style` at `warn`, and ships `no-raw-fontsize` at `error` after the slice is clean. Geometry props are exempt (the rule keys only on `fontSize`), matching the spec's `Donut`/`Bars` edge case.
- **Item 3 (statusBadge):** Task 3 adds `statusBadge()` in `lib/format.ts` (co-located with `money`/`levelLabel`), case-insensitive, null-safe, unknown→`draft` (never an uncolored pill), with `suspended`/`mailed`/`cleared` aliased to existing tones (no CSS growth). Unit tests assert every known status maps to a class `globals.css` actually styles. Task 4 adds `<StatusBadge>`; Task 12 rolls it out on the slice, deleting inline `` `badge ${x}` `` (the same fix pattern the spec cites at `platform/page.tsx:128`).
- **Item 4 (primitives kit):** Tasks 4–7 add `StatusBadge`, `Money`, `Card`, `PageHeader`, `Toolbar`, `Tabs`, `Field`, `DL`, `KpiStrip`+`Kpi` (collapsing 3×`Kpi`/2×`Mini`/`StatCard` into one `Kpi` with a `variant`, preserving `.stat .icon`/`.net-kpi-ic`), and `DataTable` (integrating `useTablePrefs`/`SortableTh`/`ColumnsMenu`/`Pagination`, keeping the table a direct `.card` child so `.card:has(table)` mobile scroll survives). Each is presentational with a typed props interface, no data/tenant logic. Method/type names (`TableColumn`, `TablePrefs`, `IconName`, `CmdNavTarget`, `ShellNavItem`, `PayoutItem`) stay consistent across tasks.
- **Item 5 (vertical slice + nav + icons):** Task 8 adds the inline-SVG `Icon` set (no new dependency, per item 1). Tasks 10–11 extract `AppShell`, collapse the 3 layouts into one persona-driven component, mount `CommandPalette` on all three personas (permission-gated: member/platform get no admin routes and search is disabled; admin keeps search), and preserve the mobile off-canvas/topbar-wrap behavior. Task 12 is the representative Payouts migration (header, badges, `<Money>`, history `<DataTable>`, drawer `DL`) — explicitly NOT all N sites; remaining surfaces are deferred to slices 2..N.
- **Item 6 (TanStack Query):** Task 9 adds `@tanstack/react-query` (the one intentional dependency), a `'use client'` provider with `staleTime`/`refetchOnWindowFocus:false`/retry-off-on-4xx (via `ApiError.status`), and `usePayoutHistory` with `keepPreviousData`. **Query keys include the active tenant identity** (client mirror of `where:{tenantId}`), unit-tested (dependency-free `keys.ts` so `node --test` can import it) so two tenants never collide. `api.ts` stays the transport (auth refresh untouched); mutations are not cached.
- **Item 7 (light-theme audit):** Task 4 fixes the shared-primitive offenders (`Donut` track → `var(--border)`, `Bars` bg → `var(--panel-2)`, `Toggle` off → `var(--panel-3)`, and the undefined `--grad-emerald` → `--emerald`) so they propagate everywhere, with dark+light manual verification. Task 13's Rule 2 + the grep gate block new `rgba(255,255,255,` in migrated files; Task 12 verifies the slice in both themes. SVG hairlines use per-theme `var(--border)`; intentional `qr`/print literals are left as-is per the spec's edge cases.
- **Sequencing / MVP:** Matches the spec — decision (1) → tokens+lint & statusBadge (2,3) → primitives (4) → Query in the slice (6) → Payouts slice + light-theme primitive fixes (5.1, 7) → nav/CommandPalette/icons (5) → guardrails enforced. MVP = items 1–3 + slice + Query, all covered by Tasks 1–13; Task 14 is the acceptance gate.
- **Test-harness honesty (verified in-repo):** Pure-logic modules use `node --test <file>.test.mts` — confirmed to execute with Node 24's native TS type-stripping and to import relative pure-`.ts` modules, zero new deps; the key builder was split into a `@/`-free `keys.ts` so the tenant-cache test loads cleanly. React/UI tasks use `tsc --noEmit` (`npm run lint`) + explicit manual browser steps, with the note that E2E lands in the tenant-isolation-hardening track. No web test runner is invented. `apps/api` (Jest `unit`/`integration`) is confirmed untouched (Task 14 Step 5 gate).
- **Non-goals respected:** no shadcn/Tailwind migration, no new product features, no Platform Command Center, no structural RLS (only client cache-key mirroring), no backend/schema/money-logic changes.
