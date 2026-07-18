# End-To-End Product Blueprint

This blueprint defines the path from a working referral commission system into a sellable B2B SaaS product. It reflects the current codebase direction: self-hosted core, English runtime, shadcn web UI, brand customization, auditable money flows, and privacy-safe member surfaces.

Status markers:
- Done: implemented and verified enough for current runtime use.
- Partial: exists, but needs depth or hardening.
- Missing: not implemented yet.

## 1. Identity And Authentication

Current state: Partial.

Implemented foundations:
- Argon2id password hashing.
- Rotating refresh tokens with reuse detection.
- Rate-limited auth endpoints.
- Security event logging.
- Email verification and password reset flows.
- MFA primitives in the backend model.

Next work:
- TOTP setup UI with QR, recovery codes, and re-auth.
- Active session list with revoke controls.
- Request-time role/session freshness for sensitive endpoints.
- New device and suspicious login notification.
- Password policy and weak password checks.

## 2. Authorization And RBAC

Current state: Partial.

Implemented foundations:
- Platform admin, tenant owner, tenant admin, tenant staff, and member roles.
- Permission catalog and guarded endpoints.
- Tenant-scoped service queries in key modules.
- People & Roles UI direction.

Next work:
- Request-time permission version checks.
- Custom roles as a polished tenant feature.
- Postgres RLS for critical tenant-scoped tables.
- API keys with scoped permissions.
- Full separation-of-duties review for money actions.

## 3. Member App

Current state: Partial.

Implemented foundations:
- Web member overview.
- Wallet with ledger and payout requests.
- Invite creation and sharing.
- Team summary.
- Expo mobile equivalents for core member flows.

Next work:
- Earnings trend and period selector.
- Pending-to-payable calendar.
- Privacy-safe network view.
- Invite funnel and invite card export.
- Account page with profile, payment profile, notifications, MFA, and sessions.
- Rank or milestone system only after legal income-disclosure copy is reviewed.

## 4. Tenant Admin

Current state: Partial to strong foundation.

Implemented foundations:
- Dashboard.
- Sales table, filters, saved views, bulk actions, import wizard, detail drawer.
- Members table and invite flow.
- Payout processing and request handling.
- Audit log.
- Settings sections for general, brand, payments, plans, people/roles, security, notifications, and data.
- Network explorer with tree/list behavior.

Next work:
- Reports center.
- Stronger pagination and export flows.
- Rich member profile drawer.
- Better audit before/after diffs.
- Commission simulator and plan version comparison.
- CSV formula injection protection.

## 5. Platform Admin

Current state: Partial.

Implemented foundations:
- Platform shell.
- Company list.
- Company drill-in.
- Tenant metrics and status badges.

Next work:
- Tenant onboarding wizard.
- Suspend/restore tenant controls with audit.
- Usage and health dashboard.
- Feature flags and limits.
- Secure impersonation with visible banner and audit trail.
- Billing readiness views.

## 6. Brand And Customization

Current state: Partial.

Implemented foundations:
- Runtime app name and monogram defaults.
- Tenant branding JSON path.
- Brand settings UI with previews.
- Invite registration can use tenant brand colors.

Next work:
- Logo upload and asset validation.
- Light/dark logo variants.
- Favicon and email header assets.
- Custom domain validation.
- WCAG contrast checks for chosen colors.
- Preview every affected surface before save.

## 7. Notifications

Current state: Partial.

Implemented foundations:
- Notification templates.
- Relay service.
- In-app notification bell.
- Preference model direction.

Next work:
- Full event x channel matrix.
- Per-user and tenant-default preference layering.
- Digests and quiet hours.
- Delivery logs and retry visibility.
- Bounce and complaint handling for production email providers.

## 8. Security Operations

Current state: Partial.

Implemented foundations:
- Helmet and proxy-aware API setup.
- Rate limits.
- Audit events for important security and money actions.
- Backup hardening and restore test script.

Next work:
- Tenant and member kill switches.
- JWT/session revocation for sensitive operations.
- RLS and tenant middleware audit.
- Sentry or equivalent error tracking.
- Structured logs with alerting.
- Fraud/anomaly scans for payout velocity, self-sale, and invite abuse.

## 9. Backup And Disaster Recovery

Current state: Strong foundation.

Implemented foundations:
- Daily pg_dump.
- Atomic backup writes.
- Retention guard.
- Optional age encryption.
- Offsite copy path.
- Restore-test script.

Next work:
- Production credential wiring.
- Weekly restore drill timer per host.
- Separate encrypted secret backup.
- PITR/WAL archiving for lower RPO.

## 10. Compliance And Finance

Current state: Missing to partial.

Next work:
- 1099/TIN collection for US payout thresholds.
- Tax export reports.
- Income disclosure page and in-app language review.
- Privacy policy, terms, DPA, and data export/delete workflows.
- Legal review for payment flow and money-transmitter risk.

## 11. Recommended Build Order

1. Finish visual QA and docs cleanup.
2. Re-enable MFA policy through a clean setup/recovery flow.
3. Add request-time token/role freshness for money and admin endpoints.
4. Add RLS and tenant-isolation verification.
5. Add reports and export workflows.
6. Finish platform tenant operations and billing readiness.
7. Add compliance/tax workflows.

## 12. Product Bar

The system is not just a dashboard. The product bar is: a tenant can configure brand and rules, invite members, record sales, distribute commission, handle payout requests, review audit evidence, and recover from failure without developer intervention.