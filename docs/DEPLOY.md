# Deployment Guide

This guide covers the Docker Compose deployment for Americana Earn: Caddy TLS proxy, Next.js web, NestJS API, Postgres, Redis, and the backup container.

## Architecture

```text
Internet :80/:443
  -> Caddy
      /v1/* and /healthz -> API container
      /*                 -> Web container
API -> Postgres + Redis
Backup -> pg_dump -> backup volume -> optional encrypted offsite copy
```

The browser calls the API from the same origin through `/v1`, so production CORS stays simple.

## Prerequisites

- Docker and Docker Compose.
- A real DNS record pointing to the host for HTTPS.
- Ports `80` and `443` open on the host.
- Production secrets outside the repository.

## First Deploy

```bash
cp .env.example .env
# Fill at minimum:
#   JWT_ACCESS_SECRET=<strong random secret>
#   DOMAIN=example.com
#   PUBLIC_ORIGIN=https://example.com
#   SMTP_* for verification and password reset email

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

## Local HTTP Trial

For a local trial without TLS, leave `DOMAIN=` empty and open `http://localhost`. Do not run this alongside another service already bound to port `80`.

Local development can still use `pnpm dev:api` and `pnpm dev:web` on ports `3101` and `3000`; production Compose is separate.

## Backup Model

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

# 4. Start services and check health.
docker compose start api web
curl -fsS http://localhost/healthz
```

Practice this in an empty environment before relying on it for production recovery.

## Updates

```bash
git pull
docker compose --profile app up -d --build
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
