#!/usr/bin/env bash
# Refearn PITR (Faz B7) — periyodik TABAN yedek (pg_basebackup).
# WAL arsivleme (docker-compose.pitr.yml'de archive_command) ile birlikte SANIYELIK kurtarma saglar:
#   restore = en yakin taban yedek + o noktadan sonraki WAL'larin recovery_target_time'a kadar tekrari.
# Bu script yalniz TABAN'i alir; surekli WAL akisi postgres'in archive_command'i yapar.
#
# Sertlestirme (backup.sh ile ayni felsefe): set -euo pipefail, atomik dizin (.part -> mv),
# retention yalniz BASARIDA + en az MIN_KEEP saglam taban kaldiysa, opsiyonel alarm.
set -euo pipefail

DIR=/basebackups
INTERVAL="${BASEBACKUP_INTERVAL_SECONDS:-86400}"   # gunde bir taban (WAL arada bosluk doldurur)
RETENTION_DAYS="${BASEBACKUP_RETENTION_DAYS:-14}"
MIN_KEEP="${BASEBACKUP_MIN_KEEP:-2}"
# pg_basebackup replication baglantisi ister: postgres host/port/user (REPL kullanici onerilir)
PGHOST="${PGHOST:-postgres}"; PGPORT="${PGPORT:-5432}"; PGUSER="${PGUSER:-refearn}"
mkdir -p "$DIR"

alert() {
  echo "[basebackup][ALERT] $1" >&2
  if [ -n "${BACKUP_ALERT_CMD:-}" ]; then sh -c "$BACKUP_ALERT_CMD" alert "$1" || true; fi
}

basebackup_once() {
  local ts dir part
  ts=$(date +%Y%m%d_%H%M%S)
  dir="$DIR/base_${ts}"
  part="${dir}.part"
  rm -rf "$part"

  # -Ft -z: sikistirilmis tar; -Xs: WAL'lari stream et (taban tutarli olsun); -P: ilerleme
  if ! pg_basebackup -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -D "$part" -Ft -z -Xs -P -c fast; then
    rm -rf "$part"; echo "[basebackup] HATA: pg_basebackup basarisiz" >&2; return 1
  fi
  mv "$part" "$dir"
  echo "[basebackup] olusturuldu: $dir ($(du -sh "$dir" | cut -f1))"

  local count
  count=$(find "$DIR" -maxdepth 1 -name 'base_*' ! -name '*.part' -type d | wc -l)
  if [ "$count" -gt "$MIN_KEEP" ]; then
    # NOT: eski taban silinince O TABANDAN once gereken WAL'lar da silinebilir (ayri WAL retention).
    find "$DIR" -maxdepth 1 -name 'base_*' ! -name '*.part' -type d -mtime "+${RETENTION_DAYS}" -exec rm -rf {} +
  fi
}

echo "[basebackup] basladi; her ${INTERVAL}s, ${RETENTION_DAYS}g saklama (taban). Surekli WAL = postgres archive_command."
while true; do
  if ! basebackup_once; then alert "taban yedek alinamadi (pg_basebackup)"; fi
  sleep "$INTERVAL"
done
