# Refearn — Referans Komisyon Sistemi

Çok kiracılı (multi-tenant), self-hosted referans/komisyon SaaS platformu.
Mimari ve iş kuralları: **[docs/SPEC.md](docs/SPEC.md)** · Karar kaydı: **[docs/DECISIONS.md](docs/DECISIONS.md)**

> "Refearn" geçici çalışma adıdır; marka/domain kararı routing'i etkilemez.

## Yapı (pnpm + Turborepo)

```
apps/api          NestJS + Prisma (komisyon motoru burada)        — API :3101
apps/web          Next.js — /admin (yonetim) + /app (uye) + /i/{code} (davetle kayit) :3000
apps/mobile       Expo (React Native)                              [henüz yok — Faz 1 sırası 8]
packages/shared   zod şemaları, sabitler, para yardımcıları, saf komisyon çekirdeği
```

## Çalıştırma (geliştirme)

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed   # Postgres/Redis + şema + örnek tenant
pnpm dev:api                                    # API → http://localhost:3101/v1
pnpm dev:web                                    # Admin web → http://localhost:3000
```

Demo giriş (seed): `owner@oppein.test` / `Refearn-Demo-2026!`. Portlar bu makinede
kaydırıldı (Postgres 5434, Redis 6380, API 3101) — bkz. docs/DECISIONS.md.

## Kurulum

```bash
pnpm install
cp .env.example .env          # Windows: Copy-Item .env.example .env
pnpm db:up                    # postgres:17 + redis:7 (Docker)
pnpm db:migrate               # migration'lar (apps/api)
pnpm db:seed                  # Oppein tenant + standart plan + örnek ağaç
```

## Test

Komisyon motoru test-first geliştirilir (SPEC Bölüm 11, T1–T10):

```bash
pnpm test                              # unit (saf çekirdek: dağıtım, yuvarlama, plan doğrulama)
pnpm --filter @refearn/api test:int    # entegrasyon (gerçek Postgres, refearn_test DB)
```

## Para kuralları (kısaca)

- Tüm tutarlar **integer cent** (`BIGINT`); float asla kullanılmaz.
- Oranlar bps (10000 = %100). Seviye tutarı `floor(amount * rate_bps / 10000)`; kalan kuruş şirkette kalır.
- Ledger satırı asla silinmez; düzeltme = eşit-ters reversal satırı.

## Dağıtım (tam yığın)

Caddy (otomatik TLS) + web + API + Postgres + Redis + günlük yedek tek komutla:

```bash
cp .env.example .env     # JWT_ACCESS_SECRET, DOMAIN, PUBLIC_ORIGIN, SMTP_* doldur
docker compose --profile app up -d --build
```

Detay, restore prosedürü ve operasyon: **[docs/DEPLOY.md](docs/DEPLOY.md)**.
Sağlık ucu: `GET /healthz`. Yedek: `backup` servisi günlük `pg_dump`, 30 gün saklama.
