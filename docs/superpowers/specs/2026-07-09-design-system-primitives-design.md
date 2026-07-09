# Design-System & Primitives Track — Design Spec

- **Date:** 2026-07-09
- **Branch:** `claude/serene-rosalind-6a05c6` (base: `reconcile/advanced-base`)
- **Author:** Mustafa + Claude
- **Status:** Draft — awaiting review

## Context

The 2026-07-09 ground-truth audit found the product's "perceived emptiness" is mostly a UI-execution problem, not missing features — and the single highest-ROI lever on perceived quality is the design layer. Today that layer is **one hand-rolled system** (`apps/web/src/app/globals.css`, 427 lines, "Obsidian & Champagne") plus ~414 lines of React primitives in `apps/web/src/components/ui.tsx`. It is genuinely good, but it is applied inconsistently: **1,428 inline `style={{}}` occurrences across 50 files**, **498 raw `fontSize:` px literals across 49 files** that bypass the `--text-*` token scale, a `.badge` system with **no status→class mapper** (34 `` `badge ${status}` `` interpolation sites, 91 badge references total), **3 nav paradigms**, `CommandPalette` mounted in only one of three personas, and **3 duplicate `Kpi` + 2 duplicate `Mini`** stat re-implementations. This track systematizes the existing system into a typed primitives kit and rolls it out — it does **not** rewrite to a new framework while a live redesign is already shipping on this CSS.

> Path links below are relative to this file (`docs/superpowers/specs/`); repo root is three levels up.

## Global constraints & conventions (apply to every item)

1. **Multi-tenant isolation is manual and is the #1 structural risk.** This is a frontend-heavy track, but any new/edited endpoint (e.g. an activity or list feed backing a `DataTable`) MUST include `where: { tenantId }` (or route through existing membership scoping). No new endpoint may read/write across tenants.
2. **Money is BigInt cents server-side**; `Number()` only at the display edge. The new `<Money>` primitive is a display-edge component — it accepts `string | number | bigint` cents and never does arithmetic on `Number` above the display boundary (mirror `money()` in [lib/format.ts](../../../apps/web/src/lib/format.ts)).
3. **Audit** every money- or permission-affecting mutation inside the same transaction. This track touches almost no mutations; where it does (e.g. re-wiring a payout action button), the existing `audit()` path is preserved untouched.
4. **UI text is English.** All new primitive labels, empty states, and helper strings are English.
5. **This spec IS the design-system track**, so the usual "reuse `ui.tsx` + `globals.css`, no design-system migration" rule is inverted here: we *extend* `ui.tsx`/`globals.css` into a first-class kit. But we still **build on the existing tokens** — no new color system, no new framework — and every other track continues to consume the kit.

## 1. Core decision: systematize the hand-rolled kit vs migrate to shadcn/Tailwind

**Problem.** There is exactly one system today and it is hand-rolled: `globals.css` defines CSS custom-property tokens (`--gold-500`, `--emerald/--amber/--rose/--sky`, `--panel`/`--panel-2/3`, `--text`/`--muted`/`--faint`, `--space-1..8`, `--text-xs..--text-hero`, `--radius`, `--dur-*`) with two full themes (`[data-theme=dark|light]`, [globals.css:41-88](../../../apps/web/src/app/globals.css)) and a FOUC-preventing inline script in layout. `apps/web/package.json` has **no Tailwind, no `components.json`, no class-variance-authority, no icon library** — only `next/react/@xyflow/d3-hierarchy/qrcode.react/html-to-image`. Memory notes a separate `redesign/shadcn-indigo` branch *does* have shadcn, but **this** branch (`reconcile/advanced-base`) is the one where a live redesign already shipped on the hand-rolled CSS.

**Decision. ⚠️ DECISION TO CONFIRM.** **Build the in-repo typed primitives kit on the hand-rolled `globals.css` tokens now. Do NOT migrate to shadcn/Tailwind in this track.** A framework swap while a live redesign is riding the same CSS is a high-risk rewrite with no perceived-quality upside the tokens don't already deliver. The kit is designed so that *if* shadcn/Tailwind is adopted later, it layers **under** the same primitive API (`<Card>`, `<StatusBadge>`, `<DataTable>`) — the call sites never learn what renders them, so a future migration is an implementation swap, not another site-by-site rewrite.

**Branch divergence (confirm).** Build on **`reconcile/advanced-base`** (this branch), because that is where production runs and where the live redesign shipped. The `redesign/shadcn-indigo` branch is **abandoned for this purpose** — do not merge its shadcn dependency in. If any component code from that branch is worth salvaging, port the *markup/logic*, re-skinned onto our tokens, not its Tailwind classes.

**Changes.** No code in this item — it's the gating decision. Record the outcome in [docs/DECISIONS.md](../../../docs/DECISIONS.md). Everything below assumes "systematize on hand-rolled tokens, layer any future shadcn under the same kit."

**Edge cases.** If leadership insists on shadcn: still ship items 2–7 first (they are framework-agnostic — tokens, `statusBadge`, icon set, nav unification, TanStack Query, light-theme fixes all survive a later shadcn adoption), then evaluate shadcn as a *separate* track after the live redesign settles.

**Tests.** N/A (decision record).

---

## 2. Typed design-token contract + lint guardrails

**Problem.** The token scale is CSS-only. TypeScript code that needs a spacing/size/color value hard-codes it: `ui.tsx` alone has `fontSize: 12`, `fontSize: 13`, `fontSize: 11`, `fontSize: 10`, `fontSize: 9` literals ([ui.tsx:102-103,131,310-313,376-383](../../../apps/web/src/components/ui.tsx)), and there are **498 raw `fontSize:` literals across 49 files** plus **1,428 inline `style={{}}` occurrences across 50 files**. Nothing stops the count from growing, so every consistency fix decays.

**Decision.** Add a **typed token module** mirroring the CSS vars, and a **lint rule** that (a) forbids numeric `fontSize` in `style={{}}` (must use a `--text-*` var or a `<Text>`/typography prop) and (b) flags stray inline `style={{}}` on files already migrated to primitives (allowlist during rollout, then tighten). The tokens are the single source of truth; the CSS vars and the TS constants are generated/checked against each other.

**Changes (frontend only).**
- Add `apps/web/src/lib/tokens.ts` — typed constants that mirror `:root` in [globals.css:8-38](../../../apps/web/src/app/globals.css):
  ```ts
  export const text = { xs:'var(--text-xs)', sm:'var(--text-sm)', md:'var(--text-md)',
    lg:'var(--text-lg)', xl:'var(--text-xl)', xl2:'var(--text-2xl)', hero:'var(--text-hero)' } as const;
  export const space = { 1:'var(--space-1)', /* …8 */ } as const;
  export const color = { gold500:'var(--gold-500)', emerald:'var(--emerald)', amber:'var(--amber)',
    rose:'var(--rose)', sky:'var(--sky)', panel:'var(--panel)', border:'var(--border)',
    text:'var(--text)', muted:'var(--muted)', faint:'var(--faint)' } as const;
  export const radius = { base:'var(--radius)', sm:'var(--radius-sm)' } as const;
  export const dur = { fast:'var(--dur-fast)', base:'var(--dur-base)', slow:'var(--dur-slow)' } as const;
  ```
  Values are `var(--…)` strings (not raw px) so theming still flows through CSS and the module stays a *contract*, not a duplicate palette.
- Add a lint config. The repo has no Tailwind/ESLint design plugin today, so add a **project-local ESLint rule** (`apps/web/eslint-rules/no-raw-fontsize.js` + a companion `no-stray-inline-style.js`) wired via `apps/web/.eslintrc`. Rule 1: report any JSX `style` object literal with a numeric `fontSize` (or `padding`/`gap` in a later phase). Rule 2: warn on `style={{` in files listed in a `migrated` glob. Start both at `warn`, flip Rule 1 to `error` once `ui.tsx` + the vertical slice (item 6) are clean.
- Migrate `ui.tsx`'s own literals to `text.*`/`space.*` as the reference implementation (it currently mixes `fontSize: 'var(--text-md)'` *and* `fontSize: 12` in the same file — [ui.tsx:243](../../../apps/web/src/components/ui.tsx) vs [ui.tsx:102](../../../apps/web/src/components/ui.tsx)).

**Edge cases.** Chart/SVG geometry (`Donut`, `Bars` in [ui.tsx:51-120](../../../apps/web/src/components/ui.tsx)) legitimately needs numeric px for `strokeWidth`, `r`, bar heights — the rule targets `fontSize` (and later `padding`/`gap`), not all numerics, and geometry props are exempt. `qr` white background and print overrides ([globals.css:390-427](../../../apps/web/src/app/globals.css)) stay as-is.

**Tests.** Lint runs in CI (`npm run lint` in `apps/web`). Add a unit test that `tokens.ts` exports a key for every `--text-*`/`--space-*` var found in `globals.css` (regex the CSS, assert coverage) so the two never drift.

---

## 3. `statusBadge()` helper — single badge vocabulary, safe default

**Problem.** `.badge` colors are keyed by a class suffix ([globals.css:249-255](../../../apps/web/src/app/globals.css)): `.badge.approved/.active/.paid/.used` → emerald, `.void/.failed/.revoked` → rose, `.pending/.requested/.processing` → amber, `.payable` → sky, `.draft/.inactive/.expired/.reversed` → muted. Code writes `` className={`badge ${status}`} `` at **34 sites** (91 badge refs total). Any status **not** in that CSS whitelist — e.g. `suspended` — renders as an **uncolored transparent-border pill**. [platform/page.tsx:128](../../../apps/web/src/app/platform/page.tsx) already works around this by hand: `` `badge ${c.status === 'active' ? 'active' : 'inactive'}` `` — proving the gap and that the fix belongs in one shared helper.

**Decision.** Add `statusBadge(status)` in [lib/format.ts](../../../apps/web/src/lib/format.ts) (co-located with the existing `money`/`levelLabel`/`ledgerTypeLabel` label helpers). It maps every known domain status to a `.badge` modifier **plus a display label**, with a safe default (map unknowns to the neutral `draft`/muted tone rather than an uncolored pill). Roll it out across all ~80 badge call sites, deleting the inline remaps.

**Changes (frontend only).**
- In `lib/format.ts`:
  ```ts
  const BADGE: Record<string, { cls: string; label?: string }> = {
    approved:{cls:'approved'}, active:{cls:'active'}, paid:{cls:'paid'}, used:{cls:'used'},
    void:{cls:'void'}, failed:{cls:'failed'}, revoked:{cls:'revoked'},
    pending:{cls:'pending'}, requested:{cls:'requested'}, processing:{cls:'processing'},
    payable:{cls:'payable'},
    draft:{cls:'draft'}, inactive:{cls:'inactive'}, expired:{cls:'expired'}, reversed:{cls:'reversed'},
    suspended:{cls:'inactive', label:'Suspended'}, // was uncolored
    mailed:{cls:'processing', label:'Mailed'}, cleared:{cls:'paid', label:'Cleared'},
  };
  export function statusBadge(status: string) {
    const m = BADGE[status?.toLowerCase()] ?? { cls: 'draft' };
    return { className: `badge ${m.cls}`, label: m.label ?? status };
  }
  ```
- Add a `<StatusBadge status={s} />` primitive in `ui.tsx` that calls `statusBadge` and renders `<span className={className}>{label}</span>` — the ergonomic front door; `statusBadge()` stays available for table cells that need just the class.
- **Full rollout** across the 34 interpolation sites (and remaining literal badge sites, ~80 total). Confirmed sites include [platform/page.tsx:128](../../../apps/web/src/app/platform/page.tsx) (delete the inline ternary), payouts, sales, members, checks. Every `` `badge ${x}` `` becomes `<StatusBadge status={x} />` or `statusBadge(x).className`.
- Audit `globals.css` for any status the domain emits but the CSS lacks (add `suspended`/`mailed`/`cleared` classes only if a *distinct* tone is wanted; otherwise the mapper aliases them to an existing class, which is preferred to avoid CSS growth).

**Edge cases.** Case-insensitive lookup (backend statuses are lowercase, but be defensive). Null/undefined status → default tone, label `—` handled by caller. `print` mode already forces badge colors via `print-color-adjust` ([globals.css:407](../../../apps/web/src/app/globals.css)) — unaffected.

**Tests.** Unit test: every known status returns a non-empty `cls` in the CSS whitelist; an unknown status returns the default (`draft`) and never an empty class. Snapshot one table row per persona to confirm no uncolored pills remain.

---

## 4. Primitives kit — the components

**Problem.** Layout/section/KPI/header patterns are re-implemented inline per page. Confirmed duplication: **3 separate `Kpi`** ([platform/page.tsx:152](../../../apps/web/src/app/platform/page.tsx), [platform/companies/[id]/page.tsx:251](../../../apps/web/src/app/platform/companies/[id]/page.tsx), [NetworkExplorer.tsx:574](../../../apps/web/src/components/NetworkExplorer.tsx)) **plus 2 `Mini`** ([members/page.tsx:656](../../../apps/web/src/app/admin/members/page.tsx), [platform/page.tsx:160](../../../apps/web/src/app/platform/page.tsx)) — all alongside the canonical `StatCard` in [ui.tsx:123](../../../apps/web/src/components/ui.tsx). `PageHeader`, `Field`, `Section`, and toolbars are inline everywhere via `.h1`/`.sub`/`.spread`/`.row` + `style={{}}`.

**Decision.** Ship a typed primitives kit in `ui.tsx` (or a new `components/kit/` barrel re-exported from `ui.tsx` to keep imports stable). Each primitive wraps existing `globals.css` classes — **no new CSS unless a class is missing**. Everything below is presentational only.

**Changes (frontend).** New/promoted primitives (`replaces` → rough call-site count from grep):

| Primitive | Wraps (globals.css) | Replaces | ~Sites |
|---|---|---|---|
| `Card` (+`hover`/`hero`/`glow`) | `.card` family ([globals.css:157-167](../../../apps/web/src/app/globals.css)) | ad-hoc `<div className="card">` + inline padding | ~80 |
| `Section` / `SettingsSection maxWidth` | new thin wrapper | inconsistent 560/620/640/680 widths in settings | ~11 |
| `PageHeader` | `.h1`/`.sub`/`.eyebrow`/`.spread` | inline title+sub+actions per page | ~30 |
| `KpiStrip` + `Kpi` | `.stat-grid`/`.stat`/`.net-kpis` | 3× `Kpi` + 2× `Mini` + `StatCard` sprawl | ~15 |
| `StatusBadge` | `.badge` (item 3) | `` `badge ${x}` `` | ~34 |
| `Toolbar` | `.spread`/`.row`/`.seg-tabs` | inline filter/search/action rows | ~25 |
| `DataTable` (+ integrates `useTablePrefs`, `SortableTh`, `Pagination`, `ColumnsMenu`) | `table`/`.dense`/`.card:has(table)` | hand-rolled `<table>` + prefs wiring | ~20 |
| `Money` | `MoneyCounter`/`money()` | inline `money(x)` / `Intl.NumberFormat` | ~60 |
| `DescriptionList` (`DL`) | `.row`/`.spread` + `.muted` | inline label/value pairs in drawers | ~25 |
| `Tabs` | `.seg-tabs`/`.seg-tab` | inline `.seg-tab` maps | ~15 |
| `Drawer` | existing `Drawer.tsx` + `.drawer*` | already exists — standardize its API | ~10 |
| `Field` | `<label>`+`input` ([globals.css:144-154](../../../apps/web/src/app/globals.css)) | inline `.field` blocks | ~40 |
| `Icon` | new inline-SVG set (item 5) | emoji/Unicode glyphs | ~50 |

- Keep `StatCard`, `Modal`, `Confirm`, `Toggle`, `Loading`, `Pagination`, `ColumnsMenu`, `SortableTh`, `useTablePrefs`, `MoneyCounter`, `Donut`, `Bars`, `Brand`, `ThemeToggle` — they are the seed of the kit ([ui.tsx](../../../apps/web/src/components/ui.tsx)). `Kpi`/`Mini`/`StatCard` collapse into one `Kpi` (with a `variant`) exported from `KpiStrip`.
- Each primitive: a small typed props interface, no business logic, no data fetching, no tenant assumptions.

**Edge cases.** `DataTable` must preserve the mobile horizontal-scroll behavior baked into `.card:has(table)` ([globals.css:241](../../../apps/web/src/app/globals.css)) and the `min-width:0` overflow guard ([globals.css:321-323](../../../apps/web/src/app/globals.css)) — do not wrap tables in a way that breaks `:has()`. `Kpi` consolidation must keep the icon-tile treatment from `.stat .icon` and `.net-kpi-ic`.

**Tests.** Render smoke test per primitive (mounts, applies expected class). One visual snapshot per primitive in both `data-theme=dark` and `light` (feeds item 7).

---

## 5. Vertical slice rollout: Payouts first, then unify nav + icons

**Problem.** A big-bang migration of 50 files is high-risk; and three cross-cutting inconsistencies compound the sprawl: (a) **3 nav paradigms** — admin ([admin/layout.tsx:66-90](../../../apps/web/src/app/admin/layout.tsx)) and platform ([platform/layout.tsx:38-66](../../../apps/web/src/app/platform/layout.tsx)) both use `.shell/.side`, member app uses `.topbar/.appmain` ([app/app/layout.tsx:70-87](../../../apps/web/src/app/app/layout.tsx)); (b) **`CommandPalette` mounted only in admin** ([admin/layout.tsx:9,105](../../../apps/web/src/app/admin/layout.tsx)) — absent from platform and member; (c) **emoji/Unicode glyphs** as icons (`◈ ◇ ⬡ ◳ ◆ 🖶 🗑 👥`) across ~50 sites (e.g. [admin/layout.tsx:15-21](../../../apps/web/src/app/admin/layout.tsx), [platform/page.tsx:78-80](../../../apps/web/src/app/platform/page.tsx), [members/page.tsx:531](../../../apps/web/src/app/admin/members/page.tsx)) that render differently per OS/browser.

**Decision. ⚠️ DECISION TO CONFIRM (which surface first).** Migrate **Admin → Payouts** end-to-end first ([payouts/page.tsx](../../../apps/web/src/app/admin/payouts/page.tsx), 632 lines: dense table + drawer + reject modal + batch bar + KPIs — it exercises `DataTable`, `Money`, `StatusBadge`, `Drawer`, `Toolbar`, `KpiStrip` in one page). It is money-facing (highest perceived-quality payoff) and its badge/reject surfaces overlap the feature-gap sprint's item 2, so we avoid double-touching. *(Alternative: admin dashboard [admin/page.tsx](../../../apps/web/src/app/admin/page.tsx), 410 lines — recommend Payouts because it stresses the `DataTable` primitive harder.)*

**Changes (frontend).**
- **Slice 1 (Payouts):** rebuild `payouts/page.tsx` purely from kit primitives, extracting/hardening each primitive as the real need surfaces. Zero inline `fontSize`; zero raw `` `badge ${x}` ``. This page becomes the reference and the first entry in the lint `migrated` allowlist (item 2).
- **Nav unification:** extract a shared `<AppShell nav={…} persona={…}>` that renders `.shell/.side` for admin+platform and `.topbar/.appmain` for member, from **one** component — collapsing the 3 hand-maintained layouts into one with a persona prop. Keep the existing mobile off-canvas drawer behavior ([globals.css:356-380](../../../apps/web/src/app/globals.css)).
- **Mount `CommandPalette` on all three personas** by putting it in `<AppShell>` (so admin, platform, and member each get Cmd/Ctrl+K). Feed it persona-scoped nav targets.
- **Icon set:** add `components/Icon.tsx` — a single inline-SVG set (stroke-based, `currentColor`, sized via a `size` prop) covering the glyphs in use (nav items, print, delete, members, company, revenue, etc.). Replace emoji glyphs at their ~50 sites, starting with the nav (`.ic` spans) and the Payouts slice. No external icon dependency (keeps `package.json` clean — consistent with item 1's "no new framework").
- **Slice 2..N:** migrate remaining surfaces page-by-page (Sales, Members, Checks, Settings, Platform, Member Home), each PR flipping that file onto primitives + the lint allowlist, until inline-style/fontSize counts trend to zero.

**Edge cases.** The member `.topbar` has bespoke mobile wrap rules ([globals.css:376-379](../../../apps/web/src/app/globals.css)) — `AppShell` must preserve them for the member persona. CommandPalette targets must be permission-gated per persona (don't surface admin routes to members). Icon swap must keep `aria-label`s where a glyph was the only affordance (e.g. the print/delete buttons).

**Tests.** Payouts slice: existing payout integration tests unchanged (no backend change); add a render smoke test that the page mounts from primitives and shows no uncolored badge. `AppShell`: smoke test that Cmd/K opens the palette in each persona. Icon: assert no emoji glyph remains in migrated files (grep gate in CI).

---

## 6. Client data layer (TanStack Query) — prerequisite for dense tables

**Problem.** `apps/web/src/lib/api.ts` is a thin fetch wrapper with token refresh single-flight ([api.ts:17-30](../../../apps/web/src/lib/api.ts)) but **no query cache, no pagination/refetch/dedupe**. The `DataTable` primitive (item 4) plus dense drawers will each hand-roll `useEffect` fetch + loading + pagination state, re-fetching on every mount. `package.json` has no data layer.

**Decision.** Adopt **TanStack Query** as the client cache/fetch layer beneath `DataTable` and drawers. Keep `api.ts` as the transport (fetch + auth refresh); Query owns caching, background refetch, pagination, and invalidation. Introduce it **in the Payouts slice first** so it proves out on a real dense surface before broad rollout.

**Changes (frontend).**
- Add `@tanstack/react-query` to `apps/web/package.json` (this is the one intentional new dependency in this track — it is a data layer, not a UI framework, so it does not conflict with item 1's "no framework swap").
- Add a `QueryClientProvider` at the web root (`app/layout.tsx` client boundary) with sane defaults (staleTime, retry off for 4xx via the existing `ApiError` in [api.ts:8](../../../apps/web/src/lib/api.ts)).
- Add typed query hooks in `lib/queries/` wrapping `api.*` calls (e.g. `usePayouts(params)`, keyed by tenant + filters). `DataTable` consumes a query hook; pagination becomes `keepPreviousData` instead of manual state.
- Migrate the Payouts slice's data access to hooks; leave other pages on raw `api.*` until their slice.

**Edge cases.** Query keys **must include the tenant/session identity** so a persona/tenant switch never serves another tenant's cached rows — this is the client mirror of the manual `where:{tenantId}` rule (constraint 1). Auth refresh stays in `api.ts` (Query calls through it); on hard 401 after refresh, `clearSession` still fires. Do not cache mutations.

**Tests.** Hook test: `usePayouts` calls `api` with the right params and surfaces `ApiError` without retrying on 4xx. Cache-key test: two tenants never share a cache entry.

---

## 7. Light-theme audit — dark-only hairlines that vanish on light

**Problem.** `globals.css` themes are clean, but **inline** styles bypass them with hardcoded `rgba(255,255,255,…)` that only reads on dark. Confirmed in the shared primitives themselves: `Donut` track `stroke="rgba(255,255,255,.06)"` ([ui.tsx:63](../../../apps/web/src/components/ui.tsx)), `Bars` bar background `rgba(255,255,255,.05)` ([ui.tsx:105](../../../apps/web/src/components/ui.tsx)), `Toggle` off-state `rgba(255,255,255,.12)` ([ui.tsx:258](../../../apps/web/src/components/ui.tsx)). On `[data-theme=light]` (white panels, [globals.css:66-88](../../../apps/web/src/app/globals.css)) these white-on-white hairlines/tracks **disappear**. With 1,428 inline styles there are likely many more.

**Decision.** Sweep inline `rgba(255,255,255,…)` (and any hardcoded light/dark literal) and replace with theme-aware tokens (`--border`, `--border-strong`, `--panel-2`, or `color-mix(... var(--muted) …)`). Fix the shared primitives first (they propagate to every page), then catch per-page cases during each item-5 slice.

**Changes (frontend).**
- `ui.tsx`: `Donut` track → `var(--border)`; `Bars` background → `var(--panel-2)` or `var(--border)`; `Toggle` off → `var(--panel-3)` / `color-mix(in srgb, var(--muted) 22%, transparent)`. `Toggle` on-state references `var(--grad-emerald)` ([ui.tsx:258](../../../apps/web/src/components/ui.tsx)) which is **not defined** in `globals.css` (only `--emerald`) — fix to `var(--emerald)` or add the gradient token.
- Add a grep gate to CI: no `rgba(255,255,255,` in `.tsx` inline styles in migrated files (allowlist during rollout), forcing new code onto tokens.
- Verify `light` theme on the Payouts slice as part of item 5 acceptance (toggle via `ThemeToggle`, [ui.tsx:216](../../../apps/web/src/components/ui.tsx)).

**Edge cases.** SVG geometry strokes legitimately need a visible hairline in both themes — use `var(--border)`/`var(--border-strong)`, which are defined per theme ([globals.css:48-49,73-74](../../../apps/web/src/app/globals.css)). The intentional white `qr` background ([globals.css:349](../../../apps/web/src/app/globals.css)) and print overrides stay hardcoded (they are theme-independent by design).

**Tests.** Dual-theme snapshot of `Donut`, `Bars`, `Toggle`, and the Payouts slice (dark + light) — assert non-transparent tracks/borders in both. CI grep gate for `rgba(255,255,255,` in migrated files.

---

## Sequencing

Guardrails and shared foundations first, then a proving slice, then breadth:

1. **Core decision confirmed** (item 1) — gates everything.
2. **Tokens + lint guardrails** (item 2) and **`statusBadge` + `<StatusBadge>`** (item 3) — MVP foundations; cheap, unblock everything.
3. **Primitives kit** (item 4) — extracted against real need, not speculatively.
4. **TanStack Query** (item 6) — introduced inside the Payouts slice.
5. **Vertical slice: Payouts** (item 5, slice 1) + **light-theme fixes to shared primitives** (item 7) — the reference migration.
6. **Nav unification + CommandPalette on all personas + icon set** (item 5) — cross-cutting, once the slice proves the kit.
7. **Remaining surfaces** (item 5, slices 2..N) + rolling light-theme sweep (item 7) — breadth; flip lint from `warn` to `error` as files clear.

MVP = items 1–3 + Payouts slice (item 5.1) + Query (item 6). Everything after is incremental rollout.

## Effort (rough)

| # | Item | Backend | Frontend | Migration/risk |
|---|------|---------|----------|----------------|
| 1 | Core decision (systematize vs shadcn) | — | — | ⚠️ strategic; blocks all |
| 2 | Typed tokens + lint rules | — | M | low; local ESLint rules |
| 3 | `statusBadge` + rollout (~80 sites) | — | M | low; mechanical, high visual payoff |
| 4 | Primitives kit (13 primitives) | — | L | med; API design must be right once |
| 5 | Payouts slice + nav unify + CommandPalette + icons | — | L | med; 3-layout collapse, ~50 icon swaps |
| 6 | TanStack Query adoption | — | M | med; tenant-scoped cache keys |
| 7 | Light-theme audit | — | M | low-med; sweep 1,428 inline styles over time |

## Explicit non-goals (separate tracks)

- **Migrating to shadcn/Tailwind** — explicitly deferred (item 1); only re-open as its own track after the live redesign settles, layered under this kit's API.
- **New product features / screens** (fraud triage UI, activity feed, plan-simulator wiring, share presets) — covered by the **feature-gap sprint** ([2026-07-09-feature-gap-sprint-design.md](./2026-07-09-feature-gap-sprint-design.md)).
- **Platform Command Center** build-out — separate track.
- **Structural tenant isolation** (RLS / Prisma extension) — top hardening item, not this track; here we only mirror it in client cache keys (item 6).
- **Backend/schema/money-logic changes** — none in this track; it is presentation + client data layer only.
