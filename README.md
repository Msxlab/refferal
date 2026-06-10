# Refearn — Referans Komisyon Sistemi

Çok kiracılı (multi-tenant), self-hosted referans/komisyon SaaS platformu.
Mimari ve iş kuralları: **[docs/SPEC.md](docs/SPEC.md)** · Karar kaydı: **[docs/DECISIONS.md](docs/DECISIONS.md)**

> "Refearn" geçici çalışma adıdır; marka/domain kararı routing'i etkilemez.

## Yapı (pnpm + Turborepo)

```
apps/api          NestJS + Prisma (komisyon motoru burada)
apps/web          Next.js (public + /app + /admin + platform)  [henüz yok — Faz 1 sırası 6-7]
apps/mobile       Expo (React Native)                          [henüz yok — Faz 1 sırası 8]
packages/shared   zod şemaları, sabitler, para yardımcıları, saf komisyon çekirdeği
```

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

## Yedek / Restore

Günlük `pg_dump` cron container'ı ve test edilmiş restore prosedürü Faz 1 sonunda eklenecek (SPEC 13/9).
