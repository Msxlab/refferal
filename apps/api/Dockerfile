# Refearn API — cok asamali derleme (pnpm monorepo, build context = repo koku).
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
# Cache-dostu: once tum workspace manifestleri + lockfile
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
# Kaynaklar + derleme
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @refearn/shared build \
 && pnpm --filter @refearn/api exec prisma generate \
 && pnpm --filter @refearn/api build

# --- runtime ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 3001
# Migration'lari uygula, sonra basla (idempotent: zaten uygulanmissa atlar)
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
