#!/bin/sh
# Gunluk pg_dump + 30 gun saklama (SPEC 10/13). Offsite kopya: BACKUP_OFFSITE_CMD
# tanimliysa her yedekten sonra calistirilir (orn. rclone/aws s3 cp).
set -eu

DIR=/backups
RETENTION_DAYS="${RETENTION_DAYS:-30}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"

mkdir -p "$DIR"
echo "[backup] basladi; her ${INTERVAL}s, ${RETENTION_DAYS} gun saklama"

while true; do
	TS=$(date +%Y%m%d_%H%M%S)
	FILE="$DIR/refearn_${TS}.sql.gz"
	if pg_dump "$DATABASE_URL" | gzip > "$FILE"; then
		echo "[backup] olusturuldu: $FILE ($(du -h "$FILE" | cut -f1))"
		# offsite (opsiyonel)
		if [ -n "${BACKUP_OFFSITE_CMD:-}" ]; then
			sh -c "$BACKUP_OFFSITE_CMD" "$FILE" || echo "[backup] offsite kopya basarisiz"
		fi
	else
		echo "[backup] HATA: pg_dump basarisiz"
		rm -f "$FILE"
	fi
	# 30 gunden eski yedekleri sil
	find "$DIR" -name 'refearn_*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete
	sleep "$INTERVAL"
done
