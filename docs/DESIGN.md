# Design System

The current product design direction is a practical B2B fintech interface: calm, dense, readable, and brandable. The runtime UI should feel like an operator tool, not a marketing page.

## Sources Of Truth

- Tokens and global layout helpers: `apps/web/src/app/globals.css`
- shadcn primitives: `apps/web/src/components/ui/*`
- Legacy chart/utility helpers: `apps/web/src/components/ui.tsx`
- Brand defaults: `apps/web/src/lib/brand.ts` and `apps/mobile/src/lib/brand.ts`

## Principles

- Use shadcn components for buttons, cards, forms, tables, tabs, alerts, badges, selects, switches, and skeletons.
- Use lucide icons for actions and navigation.
- Keep UI copy English-only.
- Keep product surfaces task-first: dense, scannable, and predictable.
- Use semantic tokens instead of raw one-off colors.
- Keep brand customization runtime-configurable where possible.

## Web Tokens

The web theme maps local CSS variables into Tailwind/shadcn tokens through `@theme inline`:

| Purpose | Token examples |
|---|---|
| Background | `--bg-0`, `--bg-1` |
| Surface | `--panel`, `--panel-solid`, `--panel-2`, `--panel-3` |
| Text | `--text`, `--muted`, `--faint` |
| Brand | `--primary`, `--brand`, `--foil`, `--on-gold` |
| Status | `--emerald`, `--amber`, `--rose`, `--sky` |
| Shape | `--radius`, `--radius-sm` |
| Motion | `--dur-fast`, `--dur-base`, `--dur-slow` |
| Focus | `--focus-ring` |

## Component Rules

- Forms use `FieldGroup`, `Field`, `FieldLabel`, `Input`, `Textarea`, `Select`, `Checkbox`, or `Switch`.
- Status and short labels use `Badge`.
- Errors and important callouts use `Alert`.
- Loading uses `Skeleton` or the shared `Loading` helper.
- Data tables use the shadcn `Table` composition.
- Page-level panels use full `Card` composition where the content is a true card.
- Repeated actions use icon buttons with a tooltip or clear text.

## Existing Utility Helpers

`components/ui.tsx` still owns non-shadcn helpers that are specific to this product:

| Helper | Purpose |
|---|---|
| `MoneyCounter` / `CountUp` | Animated numeric display with tabular formatting |
| `Donut` | Accessible SVG donut summary |
| `Bars` | Accessible horizontal bar list |
| `StatCard` | shadcn-backed metric card helper |
| `Modal` / `Confirm` | Existing accessible modal shell and confirmation helper |
| `Brand` | Runtime brand mark and name |
| `ThemeToggle` | Light/dark toggle backed by shadcn Button |
| `Toggle` | Generic setting switch backed by shadcn Switch |
| `Loading` | Skeleton row helper |
| `useToast` | Small local toast state helper |

Long-term, `Modal` and `Drawer` can move to shadcn Dialog/Sheet after those components are intentionally added.

## Page Pattern

Use this rhythm for admin and member pages:

1. Eyebrow for section context.
2. Short H1.
3. One sentence explaining the task.
4. Filter/search area in a Card or unframed toolbar.
5. Data table, graph, or focused work surface.
6. Drawer/modal for details and irreversible actions.

## Accessibility Baseline

- Respect `prefers-reduced-motion`.
- Keep keyboard focus visible.
- Use `aria-invalid` and `data-invalid` for form validation.
- Use `role="status"` for loading/toast messages.
- Graph helpers must provide text labels or aria summaries.
- Modals must trap attention, support Escape close, and have a clear title.

## Open Design Debt

- Replace custom Modal/Drawer shells with shadcn Dialog/Sheet once those primitives are added.
- Reduce remaining legacy layout helpers such as `.row`, `.spread`, `.h1`, and `.sub` over time.
- Add visual regression or screenshot QA for desktop and mobile widths.
- Add a small design-system enforcement checklist to PR review.