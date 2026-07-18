# PITR — Saniyelik Kurtarma (Faz B7)

> Amaç: Çökme/yanlış-silme durumunda **herhangi bir saniyeye** dönebilmek (max ~60s veri kaybı),
> "6 saatlik veri uçması" yerine. Mevcut günlük **mantıksal** yedeğin (`docker/backup/backup.sh`)
> üstüne **fiziksel WAL arşivleme + taban yedek** ekler.

## Nasıl çalışır
- `wal_level=replica` + `archive_mode=on`: her commit WAL'a yazılır; dolan her WAL segmenti
  `archive_command` ile `/wal_archive`'a kopyalanır. `archive_timeout=60` → en fazla ~60s WAL bekler (RPO).
- `basebackup` servisi günde bir `pg_basebackup` ile **taban** alır (`/basebackups`).
- **Restore** = en yakın taban + o tabandan sonraki WAL'ların `recovery_target_time`'a kadar tekrarı.

## Kurulum (prod)
```bash
docker compose -f docker-compose.yml -f docker-compose.pitr.yml --profile app up -d
```
İlk taban yedeği ~1 gün içinde (ya da elle: `docker compose ... run --rm basebackup bash /pitr/basebackup.sh` bir kez).

**Offsite (zorunlu):** disk kaybında PITR de gider. `/wal_archive` ve `/basebackups` hacimlerini
offsite'e senkronlayın (mevcut rclone+age hattıyla, örn. saatlik):
```bash
rclone sync /wal_archive   gdrive:refearn/wal   --transfers 8
rclone sync /basebackups   gdrive:refearn/base
```
> Üretim notu: gerçek replikasyon kullanıcısı + parola yönetimi (env/secret) önerilir; örnekte dev parolası var.

## Restore — bir saniyeye dönüş
1. Postgres'i durdur, veri dizinini boşalt (ya da yeni boş volume).
2. En yakın (hedef zamandan ÖNCEKİ) tabanı aç:
   ```bash
   mkdir -p /var/lib/postgresql/data && tar xzf /basebackups/base_<ts>/base.tar.gz -C /var/lib/postgresql/data
   tar xzf /basebackups/base_<ts>/pg_wal.tar.gz -C /var/lib/postgresql/data/pg_wal
   ```
3. Recovery'yi yapılandır (PG12+):
   ```bash
   touch /var/lib/postgresql/data/recovery.signal
   cat >> /var/lib/postgresql/data/postgresql.conf <<EOF
   restore_command = 'cp /wal_archive/%f %p'
   recovery_target_time = '2026-06-18 14:32:05+00'   # DÖNÜLECEK an
   recovery_target_action = 'promote'
   EOF
   ```
4. Postgres'i başlat → WAL'ları hedefe kadar oynatır, sonra promote eder. Log'da
   `recovery stopping before ... / consistent recovery state reached` görülür.
5. Doğrula (satır sayıları, son işlemler), uygulamayı bağla.

## Doğrulama / tatbikat (önerilen)
- Çeyrekte bir **restore tatbikatı**: izole bir ortama tabandan + WAL'dan geri yükle, veri bütünlüğünü
  doğrula (mantıksal yedeğin `restore-test.sh`'ine paralel). Test edilmemiş yedek = yedek değildir.
- İzleme: `basebackup`/offsite başarısızlığı `BACKUP_ALERT_CMD` ile alarmlanır (B6 AlertsService'e
  bağlanabilir). WAL arşiv dizini büyümüyorsa archive_command bozuktur — kontrol et.

## Sınırlar / notlar
- archive_command basit `cp` (yerel volume). Üretimde idempotent + offsite'e doğrudan yazan bir
  komut (örn. WAL-G / pgBackRest) daha sağlamdır; bu kurulum bağımlılıksız temel hattır.
- `wal_level=replica` değişimi postgres **restart** ister (override ilk uygulandığında).
- Eski taban silinince ondan önceki WAL'lar da gereksizleşir; WAL retention'ı taban retention'la
  uyumlu tutun (aksi halde `/wal_archive` sınırsız büyür).
