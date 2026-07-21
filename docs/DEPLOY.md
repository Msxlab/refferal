# Deployment Guide

This guide covers the Docker Compose deployment for Americana Earn: Next.js web, NestJS API, Postgres, Redis, and the backup container. Choose exactly one of the two supported reverse-proxy topologies below; do not run both Caddy and Apache for the same public host.

## Choose a deployment topology

### Standard Docker Compose with Caddy

```text
Internet :80/:443
  -> Caddy
      /v1/* and /healthz -> API container
      /*                 -> Web container
API -> Postgres + Redis
Backup -> pg_dump -> backup volume -> optional encrypted offsite copy
```

Use the base [`docker-compose.yml`](../docker-compose.yml). Caddy owns host ports `80` and `443`, terminates TLS, sends `/v1/*`, `/healthz`, and `/metrics` to the API, and sends all other paths to the web container. This is the default topology described by the Caddy file at [`docker/Caddyfile`](../docker/Caddyfile).

### cPanel / Apache reverse proxy

```text
Internet :80/:443
  -> cPanel-managed Apache + TLS
      /v1/* and /healthz -> API at 127.0.0.1:3101
      /*                 -> Web at 127.0.0.1:3100
API -> Postgres + Redis
Backup -> pg_dump -> backup volume -> optional encrypted offsite copy
```

Use the base Compose file together with [`docker-compose.cpanel.yml`](../docker-compose.cpanel.yml). The override keeps Apache in control of `80` and `443`, publishes only loopback API/web ports, and disables Caddy. The browser still calls the API from the same origin through `/v1`, so `PUBLIC_ORIGIN` must be the exact public HTTPS URL.

## Prerequisites

- Docker and Docker Compose.
- A real DNS record and TLS-capable public proxy for HTTPS.
- Production secrets outside the repository.
- For the Caddy topology: host ports `80` and `443` must be available to Caddy.
- For the cPanel topology: Apache must own `80` and `443`; do not expose `3100` or `3101` publicly.

## Production configuration is a release gate

> [!CAUTION]
> Never deploy the example values from `.env.example`. In particular, `JWT_ACCESS_SECRET=change-me-access`, `POSTGRES_PASSWORD=change-me-postgres`, and `PUBLIC_ORIGIN=http://localhost` are development defaults, not production settings. Treat any of those values, an empty secret/password, or a non-HTTPS public origin as a hard stop: fix `.env` before starting Compose.

Create `.env` from the example and set unique production values at minimum:

```bash
cp .env.example .env
# Set a unique high-entropy JWT_ACCESS_SECRET and POSTGRES_PASSWORD.
# Set PUBLIC_ORIGIN to the exact HTTPS site, for example:
#   PUBLIC_ORIGIN=https://earn.example.com
# Set SMTP_* for verification and password-reset email.
```

The base Compose file passes `PUBLIC_ORIGIN` to both `CORS_ORIGINS` and `WEB_URL`; it must therefore match the public site that Apache or Caddy serves. Never point a production browser at `localhost`.

## Standard Caddy deployment

```bash
# In addition to the production configuration gate above:
#   DOMAIN=example.com

docker compose --profile app up -d --build
```

On first boot the API runs `prisma migrate deploy` before starting.

Health checks:

```bash
curl https://example.com/healthz
docker compose ps
```

Optional demo seed:

```bash
docker compose exec api pnpm db:seed
```

## cPanel / Apache deployment

Use this topology only when cPanel/WHM Apache is the public TLS proxy. The Compose override binds the API to `127.0.0.1:${API_HOST_PORT:-3101}` and web to `127.0.0.1:${WEB_HOST_PORT:-3100}`; it intentionally disables the Caddy service.

Start the stack with both Compose files every time:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.cpanel.yml \
  --profile app up -d --build

docker compose -f docker-compose.yml -f docker-compose.cpanel.yml ps
```

Configure the domain's HTTPS Apache vhost through the cPanel/provider-supported include mechanism, not by editing a generated cPanel vhost file. Apache needs `mod_proxy`, `mod_proxy_http`, and `mod_headers`; preserve the host, set the HTTPS forwarding header, and put API routes before the web catch-all:

```apache
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "https"

ProxyPass        /v1/      http://127.0.0.1:3101/v1/
ProxyPassReverse /v1/      http://127.0.0.1:3101/v1/
ProxyPass        /healthz  http://127.0.0.1:3101/healthz
ProxyPassReverse /healthz  http://127.0.0.1:3101/healthz

ProxyPass        /          http://127.0.0.1:3100/
ProxyPassReverse /          http://127.0.0.1:3100/
```

Do not strip the `/v1` prefix: the API uses it as its global route prefix. Keep `/metrics` off the public catch-all unless an operations-only proxy rule and its endpoint authentication are configured deliberately. If you use non-default loopback ports, set `API_HOST_PORT` and `WEB_HOST_PORT` consistently in `.env` and in the Apache rules. `DOMAIN` configures Caddy only; Apache's vhost and `PUBLIC_ORIGIN` define the cPanel public hostname.

After the Apache include is enabled and reloaded, verify the public route:

```bash
curl -fsS https://earn.example.com/healthz
```

For every later cPanel command in this guide, prepend `-f docker-compose.yml -f docker-compose.cpanel.yml` after `docker compose`. Do not run the base Caddy command alongside this overlay.

## Local HTTP Trial (Caddy only)

For a local trial without TLS, leave `DOMAIN=` empty and open `http://localhost`. Do not run this alongside another service already bound to port `80`.

Local development can still use `pnpm dev:api` and `pnpm dev:web` on ports `3101` and `3000`; production Compose is separate.

## Backup Model

The commands in this and the remaining shared operations sections use the base Caddy Compose command for brevity. On cPanel, use the two-file Compose command described above.

The `backup` service writes compressed Postgres dumps to the backup volume. The script is atomic: it writes a `.part` file first and only moves it into place after a successful dump. Retention runs after a successful backup and keeps a minimum set of valid backups.

```bash
docker compose exec backup ls -lh /backups
```

Recommended 3-2-1 posture:
- Local backup volume.
- Encrypted offsite copy, for example Google Drive through rclone and age.
- Optional second provider for higher durability.

## Google Drive Offsite Backup

1. Create a Google Cloud project and enable Drive API.
2. Create a Service Account and download its JSON key outside the repository.
3. Create a Drive folder for backups and share it with the Service Account email.
4. Generate an age key pair; keep the private key outside the server and repository.
5. Configure `GDRIVE_FOLDER_ID`, `BACKUP_AGE_RECIPIENT`, `BACKUP_OFFSITE_CMD`, and optional alert hooks in the environment.

Example command shape:

```bash
BACKUP_OFFSITE_CMD=rclone copyto "$1" gdrive:$(basename "$1")
```

Keep `.env` and other secrets backed up separately with a different encryption key. A database restore is not enough if production secrets are lost.

## Restore Drill

Run the restore test regularly. It loads the newest backup into an isolated temporary database and checks core table counts.

```bash
docker compose exec backup bash /restore-test.sh
```

Recommended targets:
- RPO: about 6 hours, adjustable by backup interval.
- RTO: about 2 hours for a practiced operator.

## Manual Restore Procedure

```bash
# 1. Identify latest backup.
docker compose exec backup sh -c 'ls -t /backups/${BACKUP_PREFIX:-americana_earn}_*.sql.gz | head -1'

# 2. Stop writers.
docker compose stop api web

# 3. Recreate database and restore.
docker compose exec postgres psql -U refearn -d postgres -c \
  "DROP DATABASE IF EXISTS refearn; CREATE DATABASE refearn;"
docker compose exec backup sh -c \
  'gunzip -c "$(ls -t /backups/${BACKUP_PREFIX:-americana_earn}_*.sql.gz | head -1)" | psql "$DATABASE_URL"'

# 4. Start services.
docker compose start api web
```

For a Caddy deployment, check `curl -fsS http://localhost/healthz`. For a cPanel deployment, use `curl -fsS http://127.0.0.1:${API_HOST_PORT:-3101}/healthz` after applying the same two-file Compose command.

Practice this in an empty environment before relying on it for production recovery.

## Updates

Standard Caddy deployment:

```bash
git pull
docker compose --profile app up -d --build
```

cPanel / Apache deployment:

```bash
git pull
docker compose \
  -f docker-compose.yml \
  -f docker-compose.cpanel.yml \
  --profile app up -d --build
```

The API image applies migrations automatically on boot.

## Host Disk Maintenance

Docker JSON log rotation is configured in Compose. Optional host timers in `docker/ops` can prune build cache and old unused images. They do not prune volumes.

```bash
chmod +x docker/ops/docker-maintenance.sh
sudo cp docker/ops/refearn-docker-maintenance.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now refearn-docker-maintenance.timer
```

Do not run:

```bash
docker volume prune
docker system prune --volumes
```

Those commands can remove database and backup volumes.

## Restore-Test Automation

```bash
sudo cp docker/ops/refearn-restore-test.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now refearn-restore-test.timer
```

Encrypted backups require the private age identity file to be mounted into the backup container for restore tests.

## Operations

Useful commands:

```bash
docker compose logs -f api
docker compose logs -f web
# Caddy topology only:
docker compose logs -f caddy
docker compose logs -f backup
```

Runtime notes:
- `GET /healthz` is unauthenticated and exempt from rate limits.
- `matureCommissions` runs inside the API scheduler.
- Notification relay runs inside the API process.
- For multi-instance API deployments, replace in-memory rate limiting with a Redis-backed store.

## Open Production Items

- Re-enable and enforce MFA once onboarding and recovery are smooth.
- Add request-time token revocation checks for sensitive money/admin endpoints.
- Add Postgres RLS as a second tenant-isolation barrier.
- Configure offsite backup credentials and alerting on each production host.
- Add Sentry or equivalent error tracking and uptime alerts.
