# Refearn — Dağıtım (Deploy) Kılavuzu

Tam yığın tek komutla: **Caddy (otomatik TLS) → Next.js web + NestJS API → Postgres + Redis**, ve günlük yedek alan bir `backup` servisi. (SPEC Bölüm 5/10/13.)

## Mimari

```
        İnternet
           │ :80 / :443  (otomatik TLS)
        ┌──▼──── caddy ────┐
        │  /v1/* , /healthz │──► api  (NestJS, :3001) ──► postgres, redis
        │  /*               │──► web  (Next.js, :3000)
        └───────────────────┘
                              backup (pg_dump → volume, 30 gün)
```

Tarayıcı API'yi **aynı origin'den** `/v1` ile çağırır (Caddy proxy'ler) → CORS gerekmez.

## Ön koşullar
- Docker + Docker Compose
- (Gerçek HTTPS için) bir alan adı, DNS A kaydı sunucuya bakmalı, 80/443 açık.

## Kurulum

```bash
cp .env.example .env
# .env içinde MUTLAKA ayarla:
#   JWT_ACCESS_SECRET=<güçlü rastgele>     (örn: openssl rand -base64 48)
#   DOMAIN=refearn.example.com             (gerçek alan adı → otomatik HTTPS)
#   PUBLIC_ORIGIN=https://refearn.example.com
#   SMTP_* (e-posta doğrulama/şifre sıfırlama için)

docker compose --profile app up -d --build
```

İlk açılışta `api` servisi `prisma migrate deploy` ile şemayı uygular. Sağlık:

```bash
curl https://refearn.example.com/healthz       # {"status":"ok","db":true,...}
docker compose ps                              # tüm servisler healthy/up
```

İlk tenant + örnek veri (yalnızca demo/ilk kurulum):

```bash
docker compose exec api pnpm db:seed
```

### Lokal (TLS'siz) deneme
`.env`'de `DOMAIN=` boş bırakın → Caddy `:80`'de servis eder. `http://localhost` açın.
> Not: Bu makinede `pnpm dev:api`/`dev:web` lokal portları (3101/3000) kullanır; prod
> compose ayrı çalışır. Aynı anda 80/5432 çakışmasına dikkat (lokal postgres 5434'te).

## Yedekleme

`backup` servisi her gün `pg_dump | gzip` ile `backups` volume'una yazar, 30 günden
eskileri siler. Offsite kopya için `.env`'de `BACKUP_OFFSITE_CMD` tanımlayın (örn. rclone).

Yedekleri listele:
```bash
docker compose exec backup ls -lh /backups
```

### Restore (test edilmiş prosedür)

```bash
# 1) En son yedeği seç
docker compose exec backup sh -c 'ls -t /backups/refearn_*.sql.gz | head -1'

# 2) (Önerilir) API'yi durdur ki yazma olmasın
docker compose stop api web

# 3) Veritabanını sıfırla ve geri yükle
docker compose exec postgres psql -U refearn -d postgres -c \
  "DROP DATABASE IF EXISTS refearn; CREATE DATABASE refearn;"
docker compose exec backup sh -c \
  'gunzip -c "$(ls -t /backups/refearn_*.sql.gz | head -1)" | psql "$DATABASE_URL"'

# 4) Servisleri başlat
docker compose start api web
curl -fsS http://localhost/healthz
```

> Restore'u **üretime almadan önce** bir kez boş ortamda deneyin (yedek bütünlüğü).

## Güncelleme

```bash
git pull
docker compose --profile app up -d --build   # migrate deploy otomatik koşar
```

## Operasyon

- Loglar: `docker compose logs -f api` / `web` / `caddy` / `backup`
- Sağlık: `GET /healthz` (auth'suz, rate-limit muaf)
- Olgunlaşma job'ı (`matureCommissions`) ve bildirim relay'i `api` içinde `@Cron`/`@Interval`
  ile çalışır (ayrı worker gerekmez).

## Açık üretim notları (bkz. docs/DECISIONS.md "Analiz sonrasi")
- Rate-limit MVP'de in-memory (tek instance). Çok-instance için Redis store'a geçilmeli.
- JWT iptali, RLS, 2FA henüz yok — Americana (2. tenant) öncesi ele alınmalı.
- Yedeğin offsite kopyası `BACKUP_OFFSITE_CMD` ile yapılandırılmalı (yerel volume tek nokta).
