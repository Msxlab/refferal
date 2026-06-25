# syntax=docker/dockerfile:1.7
# Refearn web multi-stage build. Build context is the repository root.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=refearn-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile

COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=/v1
ARG NEXT_PUBLIC_APP_NAME=Refearn
ARG NEXT_PUBLIC_APP_MONOGRAM=R
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_APP_MONOGRAM=$NEXT_PUBLIC_APP_MONOGRAM
ENV NEXT_STANDALONE=1
RUN pnpm --filter @refearn/web build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
