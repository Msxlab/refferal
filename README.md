# Americana Earn - Referral Commission Platform

Americana Earn is a self-hosted, multi-tenant referral commission platform for invite-only sales networks. Companies can onboard members, record product sales, distribute commission through a fixed upline window, and manage payouts with an auditable ledger.

Core references:
- Architecture and business rules: [docs/SPEC.md](docs/SPEC.md)
- Decision log: [docs/DECISIONS.md](docs/DECISIONS.md)
- Deployment and restore operations: [docs/DEPLOY.md](docs/DEPLOY.md)
- Product and UX roadmap: [docs/PRODUCT-BLUEPRINT.md](docs/PRODUCT-BLUEPRINT.md)

## Workspace

```text
apps/api          NestJS + Prisma API and commission engine, local API :3101
apps/web          Next.js web app: /admin, /app, /platform, /login, /i/{code}
apps/mobile       Expo mobile member app: login, overview, wallet, team, invite, push
packages/shared   Zod schemas, constants, money helpers, pure commission logic
docker/backup     Backup, restore-test, and offsite copy helpers
docker/ops        Optional host-level systemd timers for maintenance and restore drills
AI                Working memory, audit notes, and implementation logs
```

## Local Development

```bash
pnpm install
cp .env.example .env          # Windows: Copy-Item .env.example .env
pnpm db:up                    # postgres:17 + redis:7
pnpm db:migrate               # Prisma migrations
pnpm db:seed                  # Seed demo tenant, plan, and member tree
pnpm dev:api                  # http://localhost:3101/v1
pnpm dev:web                  # http://localhost:3000
```

Demo seed login:

```text
owner@oppein.test / Americana-Demo-2026!
```

Local port notes:
- Postgres: `5434`
- Redis: `6380`
- API: `3101`
- Web: `3000`
- `apps/api/src/main.ts` falls back to `3001` when `PORT` is unset; local env files set `PORT=3101`.

## Mobile Development

```bash
pnpm --filter @refearn/mobile dev
```

Android emulator defaults can reach the API through `10.0.2.2:3101`. A physical device needs LAN URLs:

```bash
EXPO_PUBLIC_API_URL=http://192.168.x.x:3101/v1
EXPO_PUBLIC_WEB_URL=http://192.168.x.x:3000
```

The native invite path mirrors the web invite path: `refearn://i/{code}` and `/i/{code}`.

## Tests

The commission engine is test-first and protected by unit and integration coverage.

```bash
pnpm test
pnpm --filter @refearn/api test:int
pnpm --filter @refearn/web build
pnpm --filter @refearn/web lint
pnpm --filter @refearn/mobile lint
pnpm --filter @refearn/api lint
```

## Money Rules

- Store all money as integer cents in `BIGINT` fields.
- Store rates in basis points: `10000 = 100%`.
- Per-level commission amount is `floor(amount_cents * rate_bps / 10000)`.
- Undistributed remainder stays with the company.
- Ledger rows are append-only. Corrections are equal-and-opposite reversal rows.

## Deployment

Full-stack deployment uses Docker Compose with web, API, Postgres, Redis, Caddy, and backup services.

```bash
cp .env.example .env
# Fill required production values such as JWT_ACCESS_SECRET, DOMAIN, PUBLIC_ORIGIN, and SMTP settings.
docker compose --profile app up -d --build
```

Operational details, backup setup, restore drills, and production notes live in [docs/DEPLOY.md](docs/DEPLOY.md).
