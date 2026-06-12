#!/usr/bin/env bash
# Refearn yedekleme (SPEC 10/13) — sertlestirilmis:
#  - set -euo pipefail: pg_dump | gzip | age zincirinde herhangi bir adim hatasi yedegi GECERSIZ sayar
#  - atomik yazim: once .part, basarida mv -> bozuk/yarim dosya asla "gecerli yedek" gibi gorunmez
#  - retention yalniz BASARILI dumptan sonra ve en az MIN_KEEP saglam yedek kaldiysa siler
#  - opsiyonel age sifreleme (BACKUP_AGE_RECIPIENT public key) -> offsite'e sifreli cikar
#  - opsiyonel offsite (BACKUP_OFFSITE_CMD; $1 = dosya yolu) + basarisizlikta BACKUP_ALERT_CMD
set -euo pipefail

DIR=/backups
RETENTION_DAYS="${RETENTION_DAYS:-30}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
MIN_KEEP="${BACKUP_MIN_KEEP:-3}"
mkdir -p "$DIR"

alert() {
  echo "[backup][ALERT] $1" >&2
  if [ -n "${BACKUP_ALERT_CMD:-}" ]; then sh -c "$BACKUP_ALERT_CMD" alert "$1" || true; fi
}

backup_once() {
  local ts ext file part
  ts=$(date +%Y%m%d_%H%M%S)
  ext="sql.gz"; [ -n "${BACKUP_AGE_RECIPIENT:-}" ] && ext="sql.gz.age"
  file="$DIR/refearn_${ts}.${ext}"
  part="${file}.part"

  if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
    pg_dump "$DATABASE_URL" | gzip | age -r "$BACKUP_AGE_RECIPIENT" > "$part"
  else
    pg_dump "$DATABASE_URL" | gzip > "$part"
  fi

  if [ ! -s "$part" ]; then rm -f "$part"; echo "[backup] HATA: bos/bozuk dump" >&2; return 1; fi
  mv "$part" "$file"
  echo "[backup] olusturuldu: $file ($(du -h "$file" | cut -f1))"

  if [ -n "${BACKUP_OFFSITE_CMD:-}" ]; then
    if sh -c "$BACKUP_OFFSITE_CMD" offsite "$file"; then
      echo "[backup] offsite kopya tamam"
    else
      alert "offsite kopya basarisiz: $(basename "$file")"
    fi
  fi

  # retention: yalniz saglam yedek sayisi MIN_KEEP'ten fazlaysa eski sil
  local count
  count=$(find "$DIR" -maxdepth 1 -name 'refearn_*' ! -name '*.part' -type f | wc -l)
  if [ "$count" -gt "$MIN_KEEP" ]; then
    find "$DIR" -maxdepth 1 -name 'refearn_*' ! -name '*.part' -type f -mtime "+${RETENTION_DAYS}" -delete
  fi
}

echo "[backup] basladi; her ${INTERVAL}s, ${RETENTION_DAYS}g saklama, sifreleme=${BACKUP_AGE_RECIPIENT:+acik}, offsite=${BACKUP_OFFSITE_CMD:+acik}"
while true; do
  if ! backup_once; then alert "yedek alinamadi (pg_dump/gzip/age zinciri hata)"; fi
  sleep "$INTERVAL"
done
