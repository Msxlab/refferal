# Americana Earn System Code Review - 2026-06-29

## Scope

This report is based on a fresh scan of the repository, deployment config, live
health checks, and read-only SSH checks. Prior memory files and old audit
reports were not used as evidence.

Not inspected: `.env`, `apps/api/.env`, `apps/web/.env.local`, secret files,
initial admin password files, billing credentials, Google Drive credentials, or
private keys.

## Executive Summary

The system is no longer a toy MVP. The core architecture is coherent:

- Strong domain core: tenant model, membership tree, immutable ledger,
  monthly summaries, payout flow, notification outbox, audit log.
- Strong money discipline: integer cents, bps rates, pure shared commission
  engine, idempotent commission application, reversal handling.
- Strong operational baseline: Docker deploy, cPanel override, health checks,
  backups, restore-test script, Docker maintenance timer, HTTPS live.
- Strong admin product surface: sales workflow, CSV import, bulk actions,
  payout request handling, settings, RBAC, audit, platform dashboard.

The biggest improvement area is not "more features". It is making the product
simpler, more consistent, and more production-legible:

1. Align live Americana Earn branding with repo, mobile, ops, email, backup, and
   docs naming.
2. Make tenant branding settings actually affect member/public surfaces.
3. Fix backup visibility to use the deployed backup prefix.
4. Re-enable MFA after admin setup and move token storage away from web
   `localStorage` before broader launch.
5. Reduce UI noise: fewer decorative glyph icons, clearer information
   hierarchy, status-driven backup/data cards, simpler settings taxonomy.

## Live Status Checked

- `https://earn.oppeinnj.com/` returned `200 OK`.
- `https://earn.oppeinnj.com/healthz` returned `{"status":"ok","db":true,...}`.
- `https://earn.oppeinnj.com/v1/platform/companies` returned `401 Unauthorized`
  without a token, as expected.
- SSH read-only check confirmed root access and live app containers:
  `americana_earn-web-1`, `americana_earn-api-1`,
  `americana_earn-postgres-1`, `americana_earn-redis-1`,
  `americana_earn-backup-1`.
- `americana-earn-restore-test.timer` and
  `americana-earn-docker-maintenance.timer` were active.

## Verification Commands

Passed:

```powershell
.\node_modules\.bin\jest.cmd --config jest.config.js
.\node_modules\.bin\tsc.cmd -p tsconfig.json --noEmit
.\node_modules\.bin\tsc.cmd --noEmit
.\node_modules\.bin\prisma.cmd validate --schema prisma/schema.prisma
```

Details:

- Shared unit tests: 16 passed.
- API TypeScript: passed.
- Web TypeScript: passed.
- Mobile TypeScript: passed.
- Prisma schema: valid.

Not run:

- API integration tests. Local Docker Compose services were not active, and the
  integration global setup calls `pnpm exec prisma migrate deploy`, while
  `pnpm.cmd --filter ...` in this environment wanted non-TTY permission to purge
  `node_modules`. I did not approve that destructive package-manager behavior.

## Architecture Map

### Backend

`apps/api` is a NestJS API with Prisma. Main modules:

- `auth`: invite registration, login, 2FA, refresh rotation, sessions, email
  verification, password reset.
- `memberships` and `members`: invite tree, admin member operations.
- `sales`: create/list/import/approve/void/deliver sales.
- `engine`: transaction-safe commission application, maturation, reversals,
  payouts.
- `payouts`: member payout requests and admin payout execution/export.
- `plans`: commission plan list/create/simulate.
- `rbac`: permission catalog and tenant roles.
- `reports`: dashboard, analytics, audit log.
- `settings`: tenant settings, branding, backup/data status.
- `platform`: platform-admin company directory and drill-in.
- `notifications`: outbox relay, email/push adapters, notification preferences.

### Frontend Web

`apps/web` is a Next.js app with:

- Public pages: login, invite registration, verify email, reset password.
- Member area: `/app`, `/app/wallet`, `/app/team`, `/app/invite`.
- Tenant admin: `/admin`, sales, members, tree, payouts, audit, settings.
- Platform admin: `/platform`, company cards, company drill-in.
- Design system: CSS tokens in `globals.css`, shared UI in `components/ui.tsx`,
  charts/network components in `TrendChart`, `RadialNetwork`,
  `NetworkExplorer`.

### Mobile

`apps/mobile` is Expo Router:

- Login with MFA.
- Member home, wallet, team, invite/QR.
- Push token registration.
- Token/session storage in AsyncStorage.

### Shared Logic

`packages/shared` owns pure commission/money/plan logic. This is the right
boundary. Keep financial invariants here whenever possible.

## What Is Already Good

- `auth.service.ts` uses argon2id, dummy hash timing equalization, refresh token
  rotation, reuse detection, session revocation, password-reset session revoke,
  and TOTP recovery codes.
- `auth.guard.ts` re-checks membership, tenant status, platform admin state,
  role versions, permissions, and MFA requirements server-side.
- `engine.service.ts` uses database transactions, row locks, retryable
  deadlock/serialization handling, immutable ledger behavior, and audit writes.
- `settings.controller.ts` keeps a single PATCH endpoint but still performs
  granular permission checks by changed field.
- `docker/backup/backup.sh` writes atomically through `.part`, keeps a minimum
  number of backups, supports age encryption, and separates offsite hooks.
- `docker-compose.cpanel.yml` correctly disables Caddy and publishes API/web
  only on localhost for Apache reverse proxy.

## High-Priority Findings

### 1. Backup status can be wrong on Americana deploy

Evidence:

- Backup scripts use `BACKUP_PREFIX`: `docker/backup/backup.sh:11`,
  `docker/backup/restore-test.sh:8`.
- Compose exposes `BACKUP_PREFIX`: `docker-compose.yml`.
- Data status hard-codes `refearn_`:
  `apps/api/src/settings/settings.service.ts:209`.

Impact:

- Live backups can exist under `americana_earn_*`, while the Data & Backup UI
  reports "Not visible".
- This weakens operator trust in the backup screen.

Recommendation:

- Change `backupStatus()` to use
  `process.env.BACKUP_PREFIX ?? 'refearn'`.
- Prefer reading `/backups/latest.json` first, then fall back to scanning by
  prefix.

### 2. Data & Backup UI overstates offsite status

Evidence:

- `apps/web/src/app/admin/settings/sections/Data.tsx:33-34` declares nightly
  encrypted dumps and Google Drive offsite as fixed `state: 'on'`.
- The same screen also renders actual config status from
  `/admin/settings/data-status`.

Impact:

- If Google Drive or encryption is not configured, the lower cards can still say
  "active".

Recommendation:

- Convert backup cards from static claims to status-derived states:
  active, not configured, warning, or failed.
- Keep "coming" only for features that truly do not exist yet.

### 3. MFA is implemented but live config was temporarily relaxed

Evidence:

- Code defaults MFA-required roles to owner/admin/platform:
  `apps/api/src/auth/auth.guard.ts:41-45`.
- `.env.example` documents the intended production default:
  `.env.example:29`.
- Deployment notes in the prompt say `MFA_REQUIRED_ROLES=none` was set
  temporarily.

Impact:

- Platform and tenant-admin accounts can run without MFA if this remains.

Recommendation:

- Keep temporary setting only until the first admin completes 2FA.
- Then restore `tenant_owner,tenant_admin,platform_admin`.
- Add a settings warning when a privileged account has no 2FA but the role is in
  `MFA_REQUIRED_ROLES`.

### 4. Web auth stores refresh tokens in localStorage

Evidence:

- `apps/web/src/lib/auth.ts:1` documents this as an MVP choice.
- `apps/web/src/lib/auth.ts:26-31` reads/writes the whole session in
  `localStorage`.

Impact:

- Any XSS can steal refresh tokens.

Recommendation:

- Move web refresh tokens to httpOnly, secure, sameSite cookies.
- Keep access token short-lived or server-issued per request.
- Preserve the current refresh-rotation server logic.

### 5. Mobile auth stores tokens in AsyncStorage

Evidence:

- `apps/mobile/src/lib/auth.ts:1` imports AsyncStorage.
- `apps/mobile/src/lib/auth.ts:28-35` stores the session JSON there.

Impact:

- Better than plain web storage for browser XSS, but not production-grade secure
  credential storage on mobile.

Recommendation:

- Move mobile session secrets to platform secure storage before public rollout.
- Keep non-secret UI preferences in AsyncStorage.

## Product And UX Findings

### 6. Branding is split across too many truths

Evidence:

- Web runtime brand is env-driven: `apps/web/src/lib/brand.ts:1-2`.
- Tenant branding is saved in DB: `apps/api/src/settings/settings.service.ts:84`
  and updated at `settings.service.ts:125-129`.
- Branding UI says colors apply to member-facing surfaces:
  `apps/web/src/app/admin/settings/sections/Brand.tsx:95`.
- Code search shows tenant branding is not consumed by public/member web
  surfaces.
- Mobile hard-codes `Refearn` in login and invite share:
  `apps/mobile/app/login.tsx:55`,
  `apps/mobile/app/(tabs)/invite.tsx:65`.
- TOTP issuer defaults to `Refearn`: `apps/api/src/auth/mfa.ts:57`.

Impact:

- Americana Earn appears live on web through env, but repo, mobile, app scheme,
  share text, MFA issuer, metrics, backup names, docs, and ops examples still
  say Refearn.

Recommendation:

- Decide the boundary:
  - Product/platform internal name can remain `refearn`.
  - Customer-facing brand should be Americana Earn now.
- Add a small tenant brand endpoint or include brand in `/me`.
- Apply tenant branding to member header, invite pages, emails, QR/share text,
  and public registration.
- Keep admin/platform shell neutral and stable.

### 7. Settings should be simpler

Current tabs:

- General, Brand, People & Roles, Security, Notifications, Data, Plans, Payments.

Suggested simpler grouping:

- Workspace: name, timezone, member privacy.
- Money Rules: plan, maturation, payout threshold.
- People: members, roles, 2FA/session posture.
- Brand: public/member brand only.
- Data: backup, restore drill, export, retention.

This reduces the "where do I change this?" feeling without removing capability.

### 8. Platform onboarding is visibly unfinished

Evidence:

- `apps/web/src/app/platform/page.tsx` has disabled "New company" with
  "Onboarding wizard - coming soon".

Impact:

- Platform admin can inspect and suspend/reactivate companies, but still needs
  scripts/manual DB operations to create real tenants.

Recommendation:

- Next platform feature should be a minimal company creation wizard:
  company name, slug, owner email, currency, timezone, starter plan.
- Generate an invite or password-reset flow rather than storing temporary
  passwords.

## Visual Design Recommendations

The current "Obsidian & Champagne" system is polished and distinctive. It fits a
luxury referral/commission product, but it can be calmer and more operational.

Recommended direction:

- Keep dark/light themes, gold value accent, and clear money colors.
- Reduce radius from 18px cards to a tighter 8-12px operational feel.
- Use gold only for active navigation, primary action, brand mark, and money
  emphasis.
- Replace decorative glyph icons with one consistent icon system. If dependency
  changes are allowed later, use lucide. If not, centralize a small internal icon
  map.
- Make admin screens denser: fewer card shells, more table-first layouts, clear
  toolbars, predictable action placement.
- Make member screens friendlier: balance, next payout, invite action, and team
  growth should be the first things visible.
- Avoid claiming customization until it is applied in actual member/public
  surfaces.

## Data Visualization Recommendations

Analytical job:

- Admin dashboard: monitoring and comparison.
- Member dashboard: earnings state and progression.
- Network views: hierarchy and focused exploration.

What works:

- Direct numbers are visible without hover.
- Dashboard has trends, funnel, top performers, and KPI cards.
- Member network radial protects privacy by showing counts rather than names.
- Network explorer offers both tree and list modes, which is the right pair.

What to improve:

- `TrendChart` uses one revenue scale for revenue and commission. This is
  truthful, but commission can visually hug the baseline. Add direct labels,
  effective-rate callouts, or a small multiple mode: revenue bars above,
  commission/rate below.
- Add empty/loading/error copy that tells the operator what to do next, not only
  "No data".
- For mobile, avoid hover-only details. Use tap/focus details and keep essential
  values visible.
- Add last-updated and stale/offline states to operational dashboards.
- Keep export/report path explicit: sales CSV, payout CSV, backup status, and
  audit export should feel like one coherent data operations area.

## Security And Operations Recommendations

- Re-enable MFA for privileged roles once admin setup is complete.
- Move web refresh tokens to httpOnly cookies.
- Move mobile token storage to secure storage.
- Decide whether `/metrics` should ever be public. Source has a public metrics
  controller, but live currently returns 404. If deployed later, restrict it at
  Apache or require a token.
- Move in-memory throttling to a shared store before running multiple API
  containers.
- Move notification relay to a distributed queue or claim-worker pattern before
  scaling beyond one API instance.
- Keep backup and restore-test timers. Fix UI visibility around actual backup
  prefix/config.
- Update docs/ops examples from `/opt/refearn` to the real deployed path or
  make the path configurable in docs.

## OpenAI / Memory Recommendation

There is no current code-level OpenAI dependency or Agents SDK app in this repo.
Do not add an AI memory layer into transaction flows yet.

Best memory system for this product right now:

- Repo-level durable memory for operators and future coding agents.
- No secrets.
- Fresh facts only.
- File references and commands run.
- Separate "analysis memory" from production app data.

Created alongside this report:

- `AI/11_2026-06-29_Fresh_Code_Audit_Memory.md`

If a future AI assistant is added to the product, keep it read-only first:

- Allowed: explain audit logs, summarize payout anomalies, guide admins through
  settings, draft reports.
- Not allowed initially: approve sales, run payouts, change roles, suspend
  companies, or mutate money-related data.
- Require eval cases for every assistant action boundary.

## Recommended Roadmap

### Next 24-48 hours

1. Fix backup prefix visibility.
2. Make Data & Backup cards status-driven.
3. Re-enable MFA after admin setup.
4. Replace mobile hard-coded `Refearn` strings with shared brand config.
5. Write a deployment note for cPanel path `/opt/americana-earn`.

### Next week

1. Make tenant branding apply to member portal, invite pages, emails, QR/share.
2. Add platform company creation wizard.
3. Harden web auth storage.
4. Split integration test global setup away from `pnpm exec`.
5. Add dashboard stale/last-updated states.

### Later

1. Secure mobile token storage.
2. Redis-backed throttling and distributed notification workers.
3. Metrics endpoint behind private network or auth.
4. More complete exports: tenant data, audit export, payout evidence bundle.
5. Optional read-only AI admin assistant with evals and no write tools.

## Files To Touch First

- `apps/api/src/settings/settings.service.ts`
- `apps/web/src/app/admin/settings/sections/Data.tsx`
- `apps/web/src/app/admin/settings/sections/Brand.tsx`
- `apps/web/src/lib/auth.ts`
- `apps/mobile/src/lib/auth.ts`
- `apps/mobile/app/login.tsx`
- `apps/mobile/app/(tabs)/invite.tsx`
- `apps/api/src/auth/mfa.ts`
- `apps/api/test/global-setup.ts`
- `docker/ops/*.service`
- `docs/DEPLOY.md`
