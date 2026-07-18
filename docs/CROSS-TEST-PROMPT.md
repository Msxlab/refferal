# Refearn — Comprehensive Cross-Test Prompt

> Goal: go beyond "does the button fire?" and test **ripple effects, referential integrity,
> state persistence, multi-actor consistency, visual quality, and platform behavior** end-to-end.
> Refearn = multi-tenant referral/commission SaaS (cabinet companies): members form a sponsor
> tree, record sales → commissions distribute up the tree → payouts. NOT a moving/address app.
>
> Run every test as a **chain**: do action A, then verify the effect everywhere A should touch
> (and confirm it did NOT touch what it shouldn't). For each finding record:
> `{ area, action, expected, actual, severity (blocker/major/minor/polish), screenshot? }`.

## 0. Test data & actors
- Seed: tenant `oppein`, owner + 6 members (ALICE1…FRANK1), sponsor tree.
- Actors to exercise: **owner**, **tenant_admin**, **tenant_staff**, **member**, **platform_admin**, **impersonation** (read-only), **API key** (X-Api-Key).
- Login: owner@oppein.test / `Refearn-Demo-2026!`.

## 1. CRUD ripple / referential integrity ("when X changes, what else changes? when X is deleted, where does it go?")
For each entity, do create → read-back → update → delete (or deactivate) and verify the ripple:

1.1 **Member**
- Create manual member → appears in: members list, tree (`/admin/tree`), leaders, dashboard member count, sponsor's downline count, search. Verify sponsor's team size +1.
- Change role (member→staff→admin) → verify: row updates, **their API keys get revoked** (cascade), their permissions change, audit log row written, JWT on their next write re-checks live role.
- Deactivate → verify: status badge, excluded from "active" counts, **cannot log in / write**, **API keys revoked**, still visible in tree (greyed), open payout requests flagged. **Can they be reactivated cleanly?**
- **Hard delete?** Members are NOT deletable (only deactivate). Confirm there is no delete; confirm this is intentional (ledger/audit history must survive). Document "where data goes" = nowhere; it's retained.

1.2 **Sale** → approve → deliver → void
- Create draft → only in sales list (no ledger yet).
- Approve → ledger lines created up the tree, monthly_summaries bump, each beneficiary's wallet/earned updates, dashboard commission rises, audit row. Verify **commission distributed == sum of ledger lines** and ≤ pool ceiling.
- Deliver (on_delivery tenant) → maturation scheduled; after maturation, pending→payable everywhere (wallet, payouts payable list).
- **Void an approved sale** → equal-and-opposite reversal lines, summaries decrement, beneficiaries' earned drops, dashboard drops. Verify net for each beneficiary returns to correct value (not below 0 unless clawback). Confirm void is **blocked if the period is locked** (409).

1.3 **Plan / Ranks / Campaign**
- New plan version → applies only to sales **on/after** effectiveFrom (old sales unchanged). Verify a sale dated before the new plan still uses the old rates.
- Edit rank tier overrideBps → affects only **future** approvals (existing ledger unchanged).
- Create campaign → finalize → bonus ledger rows (adjustment) once; **re-finalize blocked**; concurrent finalize awards once.
- Delete campaign (draft only) → gone; confirm a finalized campaign **cannot** be deleted.

1.4 **Cascade deletes (FK behavior — verify "where it goes")**
- Delete a **webhook** → its delivery rows gone (cascade)? Endpoint disappears from list + deliveries.
- Delete an **announcement** → its `announcement_reads` rows cascade-deleted (new FK). No orphan receipts.
- Delete a **tenant role** → blocked if members assigned; members must be reassigned first.
- Revoke an **API key** → immediately rejected (401) on next use; row retained (revokedAt set), not deleted.
- (DB-level) Deleting a membership would cascade notifications + announcement_reads + api_keys (new FKs) — but there is no UI delete; verify the FKs exist so a future hard-delete won't orphan.

## 2. Tree & multi-team consistency (the "second team" question)
- Make a **second** member a team leader (`isTeamLeader=true`), give them their own recruited sub-tree (invite under them).
- `/admin/tree` (Leaders landing): should now show **2+ leader cards** (each with team size / monthly revenue / commission). Click one → **scoped subtree** (only that leader's `path <@` descendants), not the whole company.
- Verify: owner's "all company" root card still present; the two teams do **not** bleed into each other; counts per leader are correct; a member in team A never appears under team B.
- Network explorer (`/app/team` member view) shows only the member's **own** downline (privacy), aggregate-only.
- Edge: a team leader who is **also** in another leader's upline — confirm the scoping (`<@` containment) is correct and not double-counting.

## 3. State / refresh / navigation persistence
- **Refresh on every page** (F5) while authed → page reloads to the **same screen** (not bounced to login or dashboard), session persists (localStorage), data refetches. Test: dashboard, members, sales, payouts, settings/*, audit, tree, periods, member /app/*.
- **Public invite `/i/[code]` refresh** → re-resolves the invite (inviter, tenant, message); confirm the **funnel `view` event does/does not double-count** on each refresh (currently fires on every mount → refresh = +1 view; decide if that's desired or should be deduped per session).
- **Deep-link** to a sub-page while logged out → redirected to login, then **back to the intended page** after login (or at least to dashboard — verify which).
- **Browser back/forward** after navigating drawers/modals → no broken state, no ghost modals.
- **Expired/short token** (15-min) → next request 401 → graceful re-login (not a white screen).
- **Two tabs** same user → action in tab 1 reflected in tab 2 after refresh; SSE live indicator updates.

## 4. Multi-actor / concurrency / permissions
- Owner vs admin vs staff vs member: each role sees only allowed nav items + gets 403 on disallowed routes (try a member hitting `/admin/*`).
- Impersonation: owner impersonates a member → **read-only** (any POST/PUT/DELETE blocked 403), banner visible, "end impersonation" returns cleanly. Inactive member → impersonation blocked.
- Maker-checker: payout run requires a **second** admin to approve; proposer cannot approve own batch.
- Concurrency: two admins approve the same payout batch / finalize the same campaign / reconcile the same bank line simultaneously → exactly-once (no double-pay / double-award / double-clear).

## 5. Platform / PWA / offline (answered: currently NONE — test the consequences)
- **PWA**: no `manifest.json`, no service worker → app is **not installable**, no home-screen icon, no splash, no standalone display. Decide: should web/admin and/or the member app be installable PWAs? (Members on mobile = strong PWA case.)
- **Offline**: no service worker / Cache API → **drop the network and every screen breaks** (fetch fails, blank/error). Test: go offline mid-session → what does the user see? (Likely an unhandled error, not a friendly "you're offline" state.) Decide on: offline shell, last-known-data cache, optimistic queueing of a sale entry.
- **Slow network**: throttle to 3G → are there skeletons/spinners everywhere, or layout-shift/flashes?
- **Mobile app** (`apps/mobile`, Expo): separate surface — verify parity (login, sales, wallet, team) and that it hits the same API.

## 6. Visual / UX quality pass (screen-by-screen, desktop 1280 + mobile 375)
For EACH screen capture a screenshot and judge honestly:
- Is the **modal backdrop** dimming enough, modal centered, content not cramped? (Add-member modal flagged: dense, weak dim.)
- **Visual hierarchy**: is the primary action obvious? Are dense tables readable?
- **Empty states**: every list with 0 rows shows a helpful empty state (not just "No rows").
- **Loading states**: skeletons vs spinners vs blank flashes.
- **Error states**: API error shows a recoverable banner, not a dead page.
- **Consistency**: spacing, button styles, badge colors, money/date formatting identical across web/admin/member.
- **Responsive**: at 375px, tables → cards or horizontal scroll (no overflow/clipping); modals fit; nav collapses.
- **Dark mode** + **light mode** both legible (contrast).
- **Accessibility**: tab order, focus rings, labels, ARIA on modals/drawers, keyboard-only flows.
Record each as a defect with severity + screenshot.

## 7. Money/data invariants (run after any mutation chain)
- `/admin/audit` → **Verify integrity** = chain intact (no false tamper).
- Admin → **Verify financials** = no payout/summary mismatch after void/reconcile/payout.
- Sum of all members' payable == tenant outstanding payable on dashboard.
- 1099/NACHA/CSV exports: amounts match ledger to the cent; no CSV-formula-injection on crafted names.

## Output
A defect table grouped by severity, each with `{area, action, expected, actual, severity, screenshot}`,
plus a short "ripple map" per entity (what each create/update/delete touches), and explicit
answers to: second-team tree rendering, invite-refresh state, PWA presence, offline behavior.
