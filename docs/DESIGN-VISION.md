# Product Design Vision

Americana Earn should read as a serious B2B commission platform: operational, premium, and trustworthy. The strongest product promise is not spectacle; it is that money, roles, and network activity are clear, auditable, and easy to operate.

## Direction: Obsidian And Champagne

The selected visual direction is a restrained fintech palette:

- Deep neutral surfaces for focus.
- Champagne gold for brand, primary actions, and value-bearing moments.
- Emerald for earned/paid money.
- Amber for pending states.
- Coral/rose for risk, reversal, and destructive action.
- Sapphire for links and informational accents.

Avoid purple-heavy gradients, glassmorphism, decorative blobs, and oversized marketing-style cards inside the actual product. This is a work tool.

## Product Surfaces

| Surface | Audience | Goal |
|---|---|---|
| Member app | Referral members | See earnings, wallet status, team growth, and invite tools |
| Tenant admin | Business operators | Manage sales, members, payouts, plans, settings, audit, and reports |
| Platform admin | SaaS owner | Monitor tenants, usage, health, support, limits, and billing readiness |
| Public/auth | Visitors and invitees | Sign in, reset access, verify email, and join through invite links |

## Design Principles

- Money actions must feel deliberate and auditable.
- Members should see only their own ledger and privacy-safe team summaries.
- Admins should see enough operational context to act without guessing.
- Platform admins need fast tenant comparison and drill-in.
- Brand controls should be previewable before they affect invite/login/member surfaces.
- English is the only runtime product language for now.

## High-Value Product Improvements

### Dashboard
Add global date range, period comparison, top performers, invite funnel, revenue/commission trend, and export.

### Sales
Keep the current table and drawer direction. Add stronger saved views, pagination, inline correction states, CSV formula protection, and status timeline.

### Members
Move toward a CRM-style member profile drawer with tabs for profile, role, sales, ledger, invites, and audit.

### Network
The admin network should remain interactive with search, focus, expand, drawer details, and a table alternative. The member network should stay privacy-safe.

### Payouts
Add payout request review, reject reasons, bank CSV presets, negative balance warnings, annual tax summary, and explicit bulk confirmation.

### Audit
Continue toward human-readable event titles, before/after diffs, actor joins, money-action filters, and export.

### Settings
Settings should be a real operations center: General, Brand, Payments, Plans, People & Roles, Security, Notifications, Data & Backup, and eventually Developer/Billing.

### Brand Studio
Brand management is core to making the system sellable. The admin should be able to set name, monogram, tagline, colors, and logo assets with live previews for login, invite, and member cards.

### Commission Plan Editor
The plan editor should make pool math obvious: level sliders, total validation, effective dates, version history, and a simulator for sample sales.

### Notifications
Use a channel matrix for in-app, email, and push. Add digest timing, quiet hours, and test-send controls.

### Security
Finish MFA setup, recovery codes, active sessions, password policy, request-time role freshness for money endpoints, and RLS.

## Phasing

| Phase | Focus |
|---|---|
| A | Design system, shadcn migration, English runtime, theme and brand foundation |
| B | Admin operations: dashboard, sales, members, payouts, audit, reports |
| C | Member experience: wallet, team, invite funnel, network, gamification, account |
| D | Platform and monetization: tenant ops, billing, limits, developer tools, advanced security |

## Current State

Phase A is mostly in place for the web runtime. The next best work is visual QA, docs cleanup, and then the highest-risk operational features: MFA onboarding, request-time revocation, RLS, and production-grade monitoring.