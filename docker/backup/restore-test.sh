#!/usr/bin/env bash
# Yedek butunluk tatbikati: en son yedegi IZOLE bir gecici DB'ye geri yukler ve dogrular.
# Kullanim:  docker compose exec backup bash /restore-test.sh
# Sifreli (.age) yedek icin AGE_IDENTITY_FILE (private key) mount edilmis olmali.
set -euo pipefail

DIR=/backups
latest=$(find "$DIR" -maxdepth 1 -name 'refearn_*' ! -name '*.part' -type f -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)
[ -z "$latest" ] && { echo "yedek bulunamadi"; exit 1; }
echo "[restore-test] en son yedek: $latest"

TMPDB="refearn_restore_test"
# kaynak baglantisindan ayni sunucuda gecici DB olustur
psql "$DATABASE_URL" -c "DROP DATABASE IF EXISTS ${TMPDB};" -c "CREATE DATABASE ${TMPDB};"
TARGET=$(echo "$DATABASE_URL" | sed "s#/[^/?]*\(?\|$\)#/${TMPDB}\1#")

decode() {
  case "$latest" in
    *.age) age -d -i "${AGE_IDENTITY_FILE:?private age key gerekli}" "$latest" | gunzip ;;
    *.gz)  gunzip -c "$latest" ;;
  esac
}

decode | psql "$TARGET" >/dev/null
tenants=$(psql "$TARGET" -tAc "SELECT count(*) FROM tenants;")
users=$(psql "$TARGET" -tAc "SELECT count(*) FROM users;")
echo "[restore-test] geri yuklendi: tenants=$tenants users=$users"
psql "$DATABASE_URL" -c "DROP DATABASE IF EXISTS ${TMPDB};"

if [ "$tenants" -ge 1 ] && [ "$users" -ge 1 ]; then
  echo "[restore-test] BASARILI"; exit 0
else
  echo "[restore-test] BASARISIZ: bos/eksik yedek"; exit 1
fi
