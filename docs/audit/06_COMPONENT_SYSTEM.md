# Component System

## Web UI Foundation

- Global design tokens live in `apps/web/src/app/globals.css`.
- Core reusable controls live in `apps/web/src/components/ui.tsx`.
- Theme bootstrapping is done before first paint in `apps/web/src/app/layout.tsx`.
- i18n is local helper-based and persisted in `localStorage`.
- Admin uses `.admin-shell`, `.side`, `.admin-main`, tables, modals, confirm dialogs, cards, stat blocks, and form fields.
- Member app uses topbar navigation and the same tokens.

## Strengths

- The visual system has clear brand language, dark/light theme support, motion tokens, focus-visible handling, reduced-motion handling, and reusable primitives.
- Money and status are visually distinct.
- Confirm dialog exists and is used for some high-risk actions.
- Forms have consistent fields, buttons, error/loading states.

## Gaps

- Admin mobile navigation disappears below 720px because `.side` is hidden and no alternate admin nav is rendered.
- Some money-affecting actions bypass the existing `Confirm` primitive, especially sale drawer actions and payout request approve/reject.
- Admin audit UI exposes raw JSON instead of a human diff, actor identity, export, or investigation workflow.
- Some controls use text/glyph affordances where a consistent icon system would improve scanability.
- Mobile has a fixed dark style and no user-facing theme setting.

## Component-Level Audit Recommendations

- Add a responsive admin navigation component shared by admin layout and smaller breakpoints.
- Route every money/state-changing admin action through one confirmation primitive with consistent copy and danger/success variants.
- Add an audit diff component that renders before/after changes field-by-field.
- Introduce a small icon layer only after confirming existing design constraints; avoid broad visual refactors outside targeted UX fixes.
