# Production Compose Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Compose release path fail closed for missing production settings, migrate before serving traffic, and restart/health-check the complete stack safely.

**Architecture:** Local development keeps the permissive base Compose file, including the migration job required by its full-stack profile. A production overlay adds required variables, restart/health semantics, and backup requirements without breaking local startup. API/web runtime images run as the existing non-root Node user; the backup image remains unchanged until named-volume ownership is verified.

**Tech Stack:** Docker Compose, Dockerfiles, Node 22, Caddy, PostgreSQL, Redis, NestJS configuration.

## Global Constraints

- Never commit real `.env`, credential, key, or server values.
- No dependency additions.
- Base Compose remains usable for local API/web development.
- Production Compose uses `docker-compose.yml` plus `docker-compose.prod.yml` plus a privately managed environment file.
- Do not start or mutate a real server without explicit operator access and approval.

---

### Task 1: Make runtime images graceful and non-root

**Files:**
- Modify: `apps/api/Dockerfile`
- Modify: `apps/web/Dockerfile`
- Test: Docker image inspection commands

**Interfaces:**
- API runtime command is `node dist/main.js`; migration executes in Compose as a separate one-shot service.
- API and web runtime processes have non-root `node` user identity.

- [ ] **Step 1: Write a RED image assertion command**

Run: `docker build -f apps/api/Dockerfile -t earnica-api-hardening-test .`

Run: `docker run --rm --entrypoint sh earnica-api-hardening-test -c "test \"$(id -u)\" -ne 0"`

Expected: the second command fails because the existing image runs as root.

- [ ] **Step 2: Update Dockerfiles minimally**

Use `COPY --chown=node:node` for runtime copies, `USER node`, and exec-form `CMD ["node", "dist/main.js"]` in API. Apply owned copies and `USER node` to the web standalone runtime. Do not modify the backup image in this task.

- [ ] **Step 3: Verify GREEN**

Run the two API commands above, then repeat the build/user assertion for `apps/web/Dockerfile`. Expected: both image builds pass and `id -u` is nonzero.

### Task 2: Add fail-closed production Compose overlay and examples

**Files:**
- Create: `docker-compose.prod.yml`
- Create: `.env.production.example`
- Modify: `docker-compose.yml`

**Interfaces:**
- Base Compose declares `migrate`, which uses the API image, runs `pnpm exec prisma migrate deploy`, and has `restart: "no"`.
- API waits for successful migration and healthy PostgreSQL/Redis.
- Caddy waits for healthy API/web.

- [ ] **Step 1: Write RED configuration checks**

Run with only `.env.production.example`:

`docker compose --env-file .env.production.example -f docker-compose.yml -f docker-compose.prod.yml --profile app config --quiet`

Expected: exit nonzero and message naming a missing required production variable.

Then supply disposable values through the process environment and rerun the command. Expected before implementation: overlay file does not exist.

- [ ] **Step 2: Add the migration service and production overlay**

Keep base local defaults. Add `migrate` to the base `app` profile and make the base API depend on its successful completion, so a local full-stack start also deploys migrations. In the overlay, require `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `METRICS_TOKEN`, `DOMAIN`, `PUBLIC_ORIGIN`, `MAIL_PROVIDER`, matching selected provider credentials, `BACKUP_AGE_RECIPIENT`, `BACKUP_OFFSITE_CMD`, and `BACKUP_ALERT_CMD`. Add `restart: unless-stopped` to PostgreSQL/Redis, web healthcheck through Node fetch, API start period, and Caddy `depends_on` health conditions.

Pass `METRICS_TOKEN`, `MAIL_PROVIDER`, SMTP secure/from, Resend key/URL, and mail from values to API deliberately. Do not use `refearn` as a production password fallback in overlay connection URLs.

- [ ] **Step 3: Add the blank production example**

Use blank values for all secret fields. Include comments that `DOMAIN` is a real hostname, `PUBLIC_ORIGIN` must be HTTPS, and the backup destination/key are required. Do not copy development placeholders into this file.

- [ ] **Step 4: Verify configuration behavior**

Run the missing-value command again and confirm failure. Set disposable values in PowerShell for each required variable and run:

`docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile app config --quiet`

Expected: missing config fails closed; complete disposable config parses successfully.

### Task 3: Validate production mail at application start

**Files:**
- Modify: `apps/api/src/notifications/adapters.ts`
- Modify: `apps/api/src/notifications/adapters.spec.ts`

**Interfaces:**
- `validateProductionMailConfig(): void` throws at startup when `NODE_ENV=production` has no selected valid provider.
- SMTP requires host, user, pass, and from; Resend requires API key and from.

- [ ] **Step 1: Write RED unit tests**

Test production SMTP without password, production Resend without key, unknown `MAIL_PROVIDER`, valid SMTP, and valid Resend. Each invalid case must throw before a message is sent.

- [ ] **Step 2: Run RED**

Run: `apps/api/node_modules/.bin/jest.cmd --selectProjects unit --runInBand src/notifications/adapters.spec.ts`

Expected: invalid configuration currently creates an adapter and fails only during send.

- [ ] **Step 3: Implement validation and invoke it during provider creation**

Normalize provider to `smtp` or `resend`. In production, reject unset/unknown provider and missing required fields with a safe message that never includes values. Retain development console behavior. Call the validator from `createEmailAdapter()`.

- [ ] **Step 4: Verify GREEN**

Run the unit command above. Expected: all provider-selection tests pass.

### Task 4: Build and startup verification

**Files:** None beyond Tasks 1-3.

- [ ] **Step 1: Build images serially**

Run: `docker compose --parallel 1 -f docker-compose.yml -f docker-compose.prod.yml --profile app build api web backup`

Expected: all three images build successfully.

- [ ] **Step 2: Validate backup behavior**

Run: `docker run --rm --entrypoint bash -v "${PWD}:/work:ro" refferal-sys-backup:latest /work/docker/backup/backup.test.sh`

Expected: backup test passes.

- [ ] **Step 3: Operator-owned release checks**

Before a real deployment, provide real DNS, TLS reachability, mail-provider smoke-test evidence, metrics scrape token, encrypted offsite backup confirmation, and restore-drill result. These are release gates, not repository changes.
