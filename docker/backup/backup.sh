#!/usr/bin/env bash
# The backup process publishes only fully verified local and offsite artifacts.
set -euo pipefail

DIR="${BACKUP_DIR:-/backups}"
PREFIX="${BACKUP_PREFIX:-americana_earn}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
MIN_KEEP="${BACKUP_MIN_KEEP:-3}"

fail() {
  echo "[backup] ERROR: $1" >&2
  return 1
}

is_non_negative_integer() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

validate_config() {
  : "${DATABASE_URL:?DATABASE_URL is required}"
  case "$PREFIX" in
    ''|*[!a-zA-Z0-9._-]*) fail 'BACKUP_PREFIX may only contain letters, numbers, dots, underscores, and hyphens.' ;;
  esac
  is_non_negative_integer "$RETENTION_DAYS" || fail 'RETENTION_DAYS must be a non-negative integer.'
  is_non_negative_integer "$MIN_KEEP" || fail 'BACKUP_MIN_KEEP must be a non-negative integer.'
  is_non_negative_integer "$INTERVAL" || fail 'BACKUP_INTERVAL_SECONDS must be a non-negative integer.'
  [[ "$MIN_KEEP" -ge 1 ]] || fail 'BACKUP_MIN_KEEP must be at least 1.'
  [[ "$INTERVAL" -ge 1 ]] || fail 'BACKUP_INTERVAL_SECONDS must be at least 1.'
  if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
    command -v age >/dev/null 2>&1 || fail 'age is required when BACKUP_AGE_RECIPIENT is configured.'
  fi
}

alert() {
  local message="$1"
  echo "[backup][ALERT] $message" >&2
  if [[ -n "${BACKUP_ALERT_CMD:-}" ]]; then
    BACKUP_EVENT=alert sh -c "$BACKUP_ALERT_CMD" backup-alert "$message" || true
  fi
}

run_hook() {
  local command="$1"
  local event="$2"
  local file="$3"
  BACKUP_EVENT="$event" sh -c "$command" backup-hook "$file"
}

cleanup_parts() {
  rm -f -- "$@"
}

write_latest() {
  local file="$1"
  local encrypted="$2"
  local latest_part="$DIR/.latest.json.part"
  if ! printf '{"file":"%s","createdAt":"%s","encrypted":%s}\n' \
    "$(basename "$file")" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$encrypted" > "$latest_part"; then
    cleanup_parts "$latest_part"
    return 1
  fi
  mv -- "$latest_part" "$DIR/latest.json"
}

prune_backups() {
  local now cutoff entry timestamp seconds file list_part
  local -a candidates=()
  now=$(date +%s)
  cutoff=$((now - RETENTION_DAYS * 86400))

  if ! list_part=$(mktemp "$DIR/.${PREFIX}.retention.XXXXXX.part"); then
    fail 'could not prepare backup retention manifest.'
    return 1
  fi
  if ! find "$DIR" -maxdepth 1 -type f \
    \( -name "${PREFIX}_*.sql.gz" -o -name "${PREFIX}_*.sql.gz.age" \) \
    -printf '%T@\t%p\0' | sort -z -nr > "$list_part"; then
    cleanup_parts "$list_part"
    fail 'could not enumerate backup artifacts for retention.'
    return 1
  fi

  while IFS= read -r -d '' entry; do
    candidates+=("$entry")
  done < "$list_part"

  for ((i = MIN_KEEP; i < ${#candidates[@]}; i++)); do
    entry="${candidates[$i]}"
    timestamp="${entry%%$'\t'*}"
    seconds=$(printf '%s' "$timestamp" | cut -d. -f1)
    file="${entry#*$'\t'}"
    if [[ "$seconds" -lt "$cutoff" ]]; then
      if ! rm -f -- "$file"; then
        cleanup_parts "$list_part"
        fail "could not remove expired backup: $(basename "$file")"
        return 1
      fi
    fi
  done

  if ! cleanup_parts "$list_part"; then
    fail 'could not remove backup retention manifest.'
    return 1
  fi
}

backup_once() {
  local ts ext file dump_part compressed_part artifact_part encrypted=false
  ts=$(date -u +%Y%m%d_%H%M%S_%N)
  ext='sql.gz'
  if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
    ext='sql.gz.age'
    encrypted=true
  fi
  file="$DIR/${PREFIX}_${ts}.${ext}"
  dump_part="$DIR/.${PREFIX}_${ts}.sql.part"
  compressed_part="$DIR/.${PREFIX}_${ts}.sql.gz.part"
  artifact_part="${file}.part"

  if ! pg_dump "$DATABASE_URL" > "$dump_part"; then
    cleanup_parts "$dump_part" "$compressed_part" "$artifact_part"
    return 1
  fi
  if [[ ! -s "$dump_part" ]]; then
    cleanup_parts "$dump_part" "$compressed_part" "$artifact_part"
    fail 'pg_dump produced an empty artifact.'
    return 1
  fi

  if ! gzip -c -- "$dump_part" > "$compressed_part"; then
    cleanup_parts "$dump_part" "$compressed_part" "$artifact_part"
    return 1
  fi
  if ! gzip -t "$compressed_part"; then
    cleanup_parts "$dump_part" "$compressed_part" "$artifact_part"
    fail 'gzip verification failed.'
    return 1
  fi

  if [[ "$encrypted" == true ]]; then
    if ! age -r "$BACKUP_AGE_RECIPIENT" < "$compressed_part" > "$artifact_part"; then
      cleanup_parts "$dump_part" "$compressed_part" "$artifact_part"
      return 1
    fi
    if [[ ! -s "$artifact_part" ]]; then
      cleanup_parts "$dump_part" "$compressed_part" "$artifact_part"
      fail 'age produced an empty artifact.'
      return 1
    fi
    if [[ -n "${AGE_IDENTITY_FILE:-}" ]]; then
      if ! age -d -i "$AGE_IDENTITY_FILE" "$artifact_part" | gzip -t; then
        cleanup_parts "$dump_part" "$compressed_part" "$artifact_part"
        fail 'encrypted artifact verification failed.'
        return 1
      fi
    fi
  else
    if ! mv -- "$compressed_part" "$artifact_part"; then
      cleanup_parts "$dump_part" "$compressed_part" "$artifact_part"
      return 1
    fi
  fi

  cleanup_parts "$dump_part" "$compressed_part"
  if ! mv -- "$artifact_part" "$file"; then
    cleanup_parts "$artifact_part"
    return 1
  fi
  if [[ ! -s "$file" ]]; then
    cleanup_parts "$file"
    fail 'final backup artifact is empty.'
    return 1
  fi
  if [[ "$encrypted" == false ]] && ! gzip -t "$file"; then
    cleanup_parts "$file"
    fail 'final gzip artifact verification failed.'
    return 1
  fi

  if [[ -n "${BACKUP_OFFSITE_CMD:-}" ]]; then
    if ! run_hook "$BACKUP_OFFSITE_CMD" offsite "$file"; then
      mv -- "$file" "${file}.upload-failed" || true
      fail "offsite upload failed: $(basename "$file")"
      return 1
    fi
    echo '[backup] offsite copy complete'
  fi

  if ! prune_backups; then
    return 1
  fi
  if [[ -n "${BACKUP_OFFSITE_RETENTION_CMD:-}" ]]; then
    if ! run_hook "$BACKUP_OFFSITE_RETENTION_CMD" offsite-retention "$file"; then
      fail 'offsite retention failed.'
      return 1
    fi
    echo '[backup] offsite retention complete'
  fi
  if ! write_latest "$file" "$encrypted"; then
    return 1
  fi

  echo "[backup] created: $file ($(du -h "$file" | cut -f1))"
}

run_backup() {
  if backup_once; then
    return 0
  fi
  alert 'backup failed; no successful artifact was published'
  return 1
}

validate_config
mkdir -p -- "$DIR"
echo "[backup] started; prefix=$PREFIX, interval=${INTERVAL}s, retention=${RETENTION_DAYS}d, encryption=${BACKUP_AGE_RECIPIENT:+on}, offsite=${BACKUP_OFFSITE_CMD:+on}"

if [[ "${BACKUP_RUN_ONCE:-0}" == '1' ]]; then
  run_backup
  exit $?
fi

while true; do
  run_backup || true
  sleep "$INTERVAL"
done
