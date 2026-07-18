#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SCRIPT="$ROOT/docker/backup/backup.sh"
RESTORE_SCRIPT="$ROOT/docker/backup/restore-test.sh"

grep -Fq 'BACKUP_RUN_ONCE' "$SCRIPT"
grep -Fq 'gzip -t' "$SCRIPT"
grep -Fq 'upload-failed' "$SCRIPT"
grep -Fq 'ON_ERROR_STOP=1' "$RESTORE_SCRIPT"
grep -Fq 'to_regclass' "$RESTORE_SCRIPT"
bash -n "$SCRIPT"
bash -n "$RESTORE_SCRIPT"

tmp=$(mktemp -d)
cleanup() {
  rm -f -- "$tmp/bin/pg_dump" "$tmp/bin/find" "$tmp/out" "$tmp/backups/latest.json" \
    "$tmp/backups"/test_backup_*.upload-failed "$tmp/backups"/test_backup_*.sql.gz \
    "$tmp/prune-failure"/test_backup_*.sql.gz 2>/dev/null || true
  rmdir "$tmp/bin" "$tmp/backups" "$tmp/prune-failure" "$tmp" 2>/dev/null || true
  return 0
}
trap cleanup EXIT
mkdir -p "$tmp/bin" "$tmp/backups"

printf '#!/usr/bin/env bash\nexit 1\n' > "$tmp/bin/pg_dump"
chmod +x "$tmp/bin/pg_dump"
if PATH="$tmp/bin:$PATH" DATABASE_URL='postgresql://user:pass@localhost:5434/refearn_test' \
  BACKUP_DIR="$tmp/backups" BACKUP_PREFIX='test_backup' BACKUP_MIN_KEEP=1 BACKUP_INTERVAL_SECONDS=1 \
  BACKUP_RUN_ONCE=1 bash "$SCRIPT" > "$tmp/out" 2>&1; then
  echo 'backup succeeded after pg_dump failed' >&2
  exit 1
fi
if find "$tmp/backups" -maxdepth 1 -type f \( -name 'test_backup_*.sql.gz' -o -name 'test_backup_*.sql.gz.age' \) | grep -q .; then
  echo 'failed dump was published as a backup artifact' >&2
  exit 1
fi

printf '#!/usr/bin/env bash\nprintf \"%s\\n\" \"mock database dump\"\n' > "$tmp/bin/pg_dump"
chmod +x "$tmp/bin/pg_dump"
if PATH="$tmp/bin:$PATH" DATABASE_URL='postgresql://user:pass@localhost:5434/refearn_test' \
  BACKUP_DIR="$tmp/backups" BACKUP_PREFIX='test_backup' BACKUP_MIN_KEEP=1 BACKUP_INTERVAL_SECONDS=1 \
  BACKUP_OFFSITE_CMD='exit 1' BACKUP_RUN_ONCE=1 bash "$SCRIPT" > "$tmp/out" 2>&1; then
  echo 'backup succeeded after the configured offsite upload failed' >&2
  exit 1
fi
test ! -e "$tmp/backups/latest.json"
if ! find "$tmp/backups" -maxdepth 1 -type f -name 'test_backup_*.upload-failed' | grep -q .; then
  sed -n '1,120p' "$tmp/out" >&2
  echo 'offsite failure did not preserve a failed-upload artifact' >&2
  exit 1
fi

PATH="$tmp/bin:$PATH" DATABASE_URL='postgresql://user:pass@localhost:5434/refearn_test' \
  BACKUP_DIR="$tmp/backups" BACKUP_PREFIX='test_backup' BACKUP_MIN_KEEP=1 BACKUP_INTERVAL_SECONDS=1 \
  BACKUP_RUN_ONCE=1 bash "$SCRIPT" > "$tmp/out" 2>&1
test -s "$tmp/backups/latest.json"
find "$tmp/backups" -maxdepth 1 -type f -name 'test_backup_*.sql.gz' | grep -q .

mkdir -p "$tmp/prune-failure"
printf '#!/usr/bin/env bash\nexit 1\n' > "$tmp/bin/find"
chmod +x "$tmp/bin/find"
if PATH="$tmp/bin:$PATH" DATABASE_URL='postgresql://user:pass@localhost:5434/refearn_test' \
  BACKUP_DIR="$tmp/prune-failure" BACKUP_PREFIX='test_backup' BACKUP_MIN_KEEP=1 BACKUP_INTERVAL_SECONDS=1 \
  BACKUP_RUN_ONCE=1 bash "$SCRIPT" > "$tmp/out" 2>&1; then
  echo 'backup succeeded when retention discovery failed' >&2
  exit 1
fi
test ! -e "$tmp/prune-failure/latest.json"
exit 0
