#!/usr/bin/env bash
# Nightly logical backup of the ShowUp Postgres database.
#
#   pg_dump (plain SQL) | gzip -> showup_<db>_<UTC stamp>.sql.gz, verified,
#   kept BACKUP_RETENTION_DAYS days locally, optionally copied to S3.
#
# Runs pg_dump INSIDE the postgres container (no host port / client needed).
# Credentials come from the repo .env (DB_USER / DB_NAME) - never printed.
#
# Env (all optional):
#   SHOWUP_DIR             repo root                      (default: script's ../..)
#   BACKUP_DIR             local destination              (default: /home/ocs/ShowUp-backups)
#   BACKUP_RETENTION_DAYS  local retention                (default: 14)
#   COMPOSE_FILE           compose file in SHOWUP_DIR     (default: docker-compose.dev.yml)
#   PG_SERVICE             compose service name           (default: postgres)
#   BACKUP_S3_BUCKET       e.g. s3://showup-backups/pg    (unset = no upload)
#   BACKUP_S3_STORAGE_CLASS                               (default: STANDARD_IA)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOWUP_DIR="${SHOWUP_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/home/ocs/ShowUp-backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"
PG_SERVICE="${PG_SERVICE:-postgres}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

# Read only the two names we need from .env (no `source` - values may contain
# characters the shell would interpret).
env_val() { grep -E "^$1=" "$SHOWUP_DIR/.env" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
DB_USER="${DB_USER:-$(env_val DB_USER)}"
DB_NAME="${DB_NAME:-$(env_val DB_NAME)}"
[ -n "$DB_USER" ] && [ -n "$DB_NAME" ] || { log "ERROR: DB_USER/DB_NAME not found in $SHOWUP_DIR/.env"; exit 1; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
umask 077

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/showup_${DB_NAME}_${STAMP}.sql.gz"
TMP="$OUT.partial"

log "backup start -> $OUT"
cd "$SHOWUP_DIR"
# Plain SQL piped through gzip: restorable with psql anywhere, diffable, and
# portable across Postgres major versions. --no-owner/--no-acl keep it restorable
# into a fresh cluster with a different role layout.
docker compose -f "$COMPOSE_FILE" exec -T "$PG_SERVICE" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl --clean --if-exists \
  | gzip -6 > "$TMP"

# Sanity: a valid gzip with a pg_dump footer.
gzip -t "$TMP"
if ! zcat "$TMP" | tail -n 5 | grep -q "PostgreSQL database dump complete"; then
  log "ERROR: dump looks truncated; keeping $TMP for inspection"
  exit 1
fi
mv "$TMP" "$OUT"
SIZE="$(du -h "$OUT" | cut -f1)"
log "backup ok ($SIZE)"

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  if command -v aws >/dev/null 2>&1; then
    log "uploading to ${BACKUP_S3_BUCKET%/}/"
    aws s3 cp "$OUT" "${BACKUP_S3_BUCKET%/}/$(basename "$OUT")" \
      --storage-class "${BACKUP_S3_STORAGE_CLASS:-STANDARD_IA}" --only-show-errors
    log "upload ok"
  else
    log "WARNING: BACKUP_S3_BUCKET set but aws CLI not installed - skipped upload"
  fi
fi

# Local retention (S3 retention is a bucket lifecycle rule - see README).
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'showup_*.sql.gz' -mtime +"$RETENTION_DAYS" -print -delete \
  | sed 's/^/removed old backup: /'
find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.partial' -mtime +1 -delete
log "done"
