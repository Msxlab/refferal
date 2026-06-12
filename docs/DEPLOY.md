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

## Yedekleme (3-2-1: yerel + şifreli Google Drive)

`backup` servisi her gün `pg_dump | gzip` (+ opsiyonel **age şifreleme**) ile `backups`
volume'una **atomik** yazar (`.part`→`mv`; bozuk dosya asla geçerli yedek sayılmaz),
30 günden eskileri siler (en az 3 sağlam yedek korunur), ve `BACKUP_OFFSITE_CMD` ile
**offsite**'e kopyalar. Başarısızlıkta `BACKUP_ALERT_CMD` tetiklenir.

```bash
docker compose exec backup ls -lh /backups
```

### Google Drive offsite (önerilen)

1. **Google Cloud** → yeni proje → **Drive API**'yi etkinleştir → **Service Account** oluştur
   → JSON anahtarı indir → `docker/backup/secrets/gdrive.json` olarak bırak (repoya girmez).
2. **Drive**'da `refearn-backups` klasörü aç → klasörü service account e-postasıyla
   (`...@...iam.gserviceaccount.com`) **Düzenleyen** olarak paylaş → klasör ID'sini al.
   (Service account'un kendi kotası yoktur; paylaşılan klasöre yazar. Büyük hacim → Shared Drive.)
3. **Şifreleme anahtarı**: `age-keygen -o age.key` → çıktıdaki **public** satırı
   `BACKUP_AGE_RECIPIENT`'a yaz. **Private `age.key`'i sunucuda tutma** — 1Password/Bitwarden
   + offline ikinci yere koy (anahtar kaybı = yedek kaybı).
4. `.env`:
   ```
   GDRIVE_FOLDER_ID=<klasör ID>
   BACKUP_AGE_RECIPIENT=age1...
   BACKUP_OFFSITE_CMD=rclone copyto "$1" gdrive:$(basename "$1")
   # opsiyonel dead-man's-switch:
   BACKUP_ALERT_CMD=curl -fsS -m10 https://hc-ping.com/<uuid>/fail -d "$1"
   ```
5. `docker compose --profile app up -d --build backup` → yedekler artık `refearn_*.sql.gz.age`
   olarak hem yerelde hem Drive'da, **şifreli**.

> `.env`/secrets'in de ayrı bir Drive klasörüne (DB'den **farklı** age anahtarıyla) şifreli
> kopyasını al — DB geri gelse bile secrets yoksa sistem ayağa kalkmaz.

### Restore-test (yedeğin gerçekten çalıştığını kanıtla)

```bash
# .age yedek için private anahtarı geçici mount edip:
docker compose exec backup bash /restore-test.sh
# -> en son yedeği izole bir geçici DB'ye yükler, tenants/users sayar, BAŞARILI/BAŞARISIZ döner
```
Bunu **haftalık** çalıştırın (cron/CI) ve sonucu aşağıdaki DR notlarına işleyin.

### DR hedefleri (öneri)
RPO ~6 saat (sıklık artırılabilir: `BACKUP_INTERVAL_SECONDS`), RTO ~2 saat. 3-2-1:
(1) yerel volume, (2) şifreli Google Drive, (3) opsiyonel ikinci sağlayıcı. Düşük RPO için
orta vadede WAL arşivleme (pgBackRest/wal-g).

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
