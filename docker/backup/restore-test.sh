#!/usr/bin/env bash
# Restores a verified artifact into an isolated temporary database and checks critical schema.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
DIR="${BACKUP_DIR:-/backups}"
PREFIX="${BACKUP_PREFIX:-americana_earn}"

case "$PREFIX" in
  ''|*[!a-zA-Z0-9._-]*) echo '[restore-test] invalid BACKUP_PREFIX' >&2; exit 1 ;;
esac

latest=$(find "$DIR" -maxdepth 1 -type f \
  \( -name "${PREFIX}_*.sql.gz" -o -name "${PREFIX}_*.sql.gz.age" \) \
  -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)
[[ -n "$latest" ]] || { echo '[restore-test] backup not found' >&2; exit 1; }
echo "[restore-test] newest backup: $latest"

TMPDB="americana_earn_restore_test_$RANDOM_$$"
base_url="${DATABASE_URL%%\?*}"
query=''
if [[ "$DATABASE_URL" == *\?* ]]; then
  query="?${DATABASE_URL#*\?}"
fi
[[ "$base_url" == */* ]] || { echo '[restore-test] DATABASE_URL has no database name' >&2; exit 1; }
TARGET="${base_url%/*}/${TMPDB}${query}"

cleanup() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$TMPDB\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$TMPDB\";"

case "$latest" in
  *.sql.gz)
    gzip -t "$latest"
    gunzip -c "$latest" | psql "$TARGET" -v ON_ERROR_STOP=1 >/dev/null
    ;;
  *.sql.gz.age)
    : "${AGE_IDENTITY_FILE:?private age key required for encrypted backup restore}"
    age -d -i "$AGE_IDENTITY_FILE" "$latest" | gzip -t
    age -d -i "$AGE_IDENTITY_FILE" "$latest" | gunzip | psql "$TARGET" -v ON_ERROR_STOP=1 >/dev/null
    ;;
  *)
    echo '[restore-test] unsupported backup extension' >&2
    exit 1
    ;;
esac

schema_ok=$(psql "$TARGET" -v ON_ERROR_STOP=1 -tAc \
  "SELECT to_regclass('public.tenants') IS NOT NULL
      AND to_regclass('public.users') IS NOT NULL
      AND to_regclass('public.ledger_entries') IS NOT NULL;")
[[ "$schema_ok" == 't' ]] || { echo '[restore-test] FAIL: critical schema missing after restore' >&2; exit 1; }

tenants=$(psql "$TARGET" -v ON_ERROR_STOP=1 -tAc 'SELECT count(*) FROM tenants;')
users=$(psql "$TARGET" -v ON_ERROR_STOP=1 -tAc 'SELECT count(*) FROM users;')
echo "[restore-test] restored: tenants=$tenants users=$users"
echo '[restore-test] PASS'
