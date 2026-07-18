# Decision Log

This file records product and technical decisions that complement [docs/SPEC.md](docs/SPEC.md). The spec defines the product contract; this log records why important choices were made and what remains intentionally open.

## Product Decisions

| Decision | Value |
|---|---|
| Runtime product name | Americana Earn by default, configurable through environment and tenant branding |
| Internal package namespace | Existing `@refearn/*` package names may remain until a deliberate repo/package rename |
| Geography | United States first |
| Default tenant timezone | `America/New_York` |
| Default payout threshold | `100000` cents ($1,000) |
| Inactive member commissions | MVP keeps earning enabled; `tenants.inactive_members_earn` allows later policy changes |
| Runtime language | English-only for current product surfaces |

## Money And Ledger Decisions

- Store money as integer cents in `BIGINT`.
- Store commission rates in basis points.
- Calculate each level with integer floor division.
- Do not write zero-cent ledger rows.
- Missing uplines do not receive or redirect commission; those amounts stay with the company.
- Ledger entries are append-only. Corrections use equal-and-opposite reversal entries.
- Paid rows stay paid. A later reversal can create a negative payable balance to offset future earnings.

## Local Development Ports

This workstation uses shifted ports because common defaults were already occupied:

| Service | Port |
|---|---|
| Postgres | 5434 |
| Redis | 6380 |
| API | 3101 |
| Web | 3000 |

Other environments may use their own values.

## Auth Decisions

- Web sessions currently store tokens in localStorage.
- The API client retries refresh once after a 401.
- Production can later move to httpOnly cookies if the deployment model requires it.
- JWT access tokens are short-lived, but token/permission freshness remains a hardening item for sensitive endpoints.
- MFA primitives exist; polished setup/recovery must be finished before enforcing MFA broadly.

## Tree And Membership Decisions

- Member placement is permanent.
- `memberships.path` is ltree-compatible text built from membership IDs.
- The commission engine follows `sponsor_membership_id`; depth is small enough for MVP.
- `team_stats` is reserved for future snapshots/cache when larger tenants need it.

## Plan Validation Decisions

- Plan totals are validated in API schemas and with a database constraint trigger.
- Plan rows are locked during validation to avoid concurrent writes exceeding the pool.
- Plans are versioned; old ledger rows preserve the rate used at calculation time.

## Engine Review Fixes

An adversarial engine review found and fixed these issues:

- Summary month drift: sales now freeze the summary month so later timezone changes do not split credit and reversal buckets.
- Void versus mature race: void locks commission rows and reads fresh status before summary updates.
- Payout deletion: ledger payout links use restrictive behavior so paid evidence cannot be silently detached.
- Plan trigger race: plan validation locks the plan row before summing rates.
- Deadlock resilience: engine mutations retry transient serialization/deadlock failures.

## Production Hardening Already Added

- Scheduler for `matureCommissions`.
- Global and auth-specific rate limits.
- Shared `ActorContext` moved to common code.
- Production secret fail-fast for JWT access secret.
- Trust proxy and helmet.
- Maker-checker support for sale approval.
- Email verification gate for payout requests.
- Invite caps for abuse resistance.
- Security event audit entries.
- Atomic backup writes, retention guard, optional age encryption, offsite path, and restore-test script.

## RBAC And Settings Decisions

- System roles exist, but custom tenant roles and permission matrices are part of the product direction.
- A user cannot safely grant permissions they do not have.
- Self-target role assignment is blocked.
- Owner deactivation is guarded.
- Branding updates merge with existing branding JSON rather than replacing the whole object.
- Settings Center is organized around General, Brand, Payments, Plans, People & Roles, Security, Notifications, and Data.

## Notification Decisions

- In-app, email, and push are the core channels.
- Webhook/Slack delivery is deferred.
- Notification preferences should become an event x channel matrix.
- Delivery logs, digest rules, and quiet hours remain future work.

## Design Decisions

- Use shadcn primitives for runtime web UI.
- Use lucide icons.
- Use an operational B2B layout, not a marketing-style dashboard.
- Use Obsidian and Champagne as the base visual direction.
- Keep brand values runtime-configurable.
- Keep runtime copy English-only.

## Known Open Items

High priority:
- MFA onboarding and recovery.
- Request-time token/session/permission freshness for money endpoints.
- Postgres RLS for critical tenant tables.
- CSV formula injection protection.
- Visual QA on real desktop and mobile viewports.
- Production SMTP and offsite backup credential wiring.
- Sentry or equivalent error/uptime monitoring.

Medium priority:
- Reports center.
- Better audit before/after diffs.
- Platform tenant onboarding/suspend/limits.
- Billing readiness.
- API keys and developer webhooks.
- 1099/TIN collection and tax export.

Accepted for MVP:
- Some internal names and package IDs still use the historical `refearn` namespace.
- Custom Modal/Drawer shells remain until shadcn Dialog/Sheet are intentionally added.
- In-memory rate limiting is acceptable for a single API instance, but not for multi-instance production.

## Additional Operational Decisions

**Bilincli erteleme/kabul** (MVP):
- **[medium] JWT perms tazeligi** — rol degisikligi access-token TTL'i kadar gecikir (perms claim'i token'da).
  Tasarim tradeoff'u: token-bazli yetki, istek-basi DB teyidi yok (performans). Kisa access TTL ile sinirli.
  Ileride `pv` (permission-version) claim'i + guard teyidi ile sertlestirilebilir.
- **[low] Bootstrap kilidi** — ensureSystemRoles/backfill her instance'ta calisir; upsert idempotent oldugu
  icin tek-instance MVP'de guvenli. Cok-instance'ta pg advisory lock onerilir.
- **[medium] Device upsert yeniden-iliskilendirme** — ayni cihaz token'i login'de yeni kullaniciya gecer;
  push semantigi geregi KASITLI (cihaz devri). Sunucu token sahipligini dogrulayamaz.

## Network yerlesim stratejisi degerlendirmesi (2026-06-16)

Network modulu calismasi kapsaminda "spillover / binary / matrix" yerlesim plani talebi
cok-ajanli tasarimla degerlendirildi. **Karar: YAPILMAYACAK — tek SPONSOR agaci korunur.**

Gerekce (kod kaniti):
- **docs/SPEC.md:40** binary/matrix/spillover/re-parenting'i bilincli ve kalici Non-Goal
  ("asla") ilan ediyor; yerlesim kalicidir (yalniz pasiflestirme var).
- **Komisyon motoru parayi YALNIZ sponsor zinciriyle dagitir**: `engine.service.ts`
  `uplineChain()` ve `packages/shared/src/commission.ts` `sponsorMembershipId` zincirini
  yuruyor; ltree `path` SADECE okuma-tarafi agregalarinda (ekip boyu, grup cirosu,
  gizlilikli `/app/team`) kullaniliyor — para hesabina HIC girmiyor.
- DB trigger `forbid_reparenting` (migration 20260610214900_guards) sponsor_membership_id
  ve path degisimini yasaklar → dongu matematiksel imkansiz, yerlesim degismez-degismez.

Sonuc: ayri bir yerlesim agaci eklemek motor yeniden tellenmeden komisyonu degistirmez;
tam binary/matrix ise motor + ledger + monthly_summaries + forbid_reparenting degismezini
bastan yazmak demektir (L+, yuksek regresyon riski, urun yonuyle celisik).

- **"placement-ready" nullable sema rezervasyonu da ERTELENDI** — yarim-ozellik yanilgisi +
  forbid_reparenting bu kolonlari kapsamayacagindan sahte koruma riski; kolon gercekten
  gerekince additive migration ile eklemek zaten kolay.
- Bu degismez bir **regresyon testiyle kilitlendi**: komisyonun sponsor zinciriyle aktigini
  (path-komsusu/farkli-sponsor iki uye ile) dogrular (`packages/shared/test/commission.spec.ts`).
- **Yeniden acma kosulu** (kod degil, urun karari): ABD pazarinda binary/matrix ticari talebi
  netlesirse motor (uplineChain) yeniden tasarimi AYRI bir L+ epic olarak ele alinir.
