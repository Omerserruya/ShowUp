#!/usr/bin/env bash
# Restore a ShowUp backup produced by pg_backup.sh.
#
#   scripts/backup/pg_restore.sh /home/ocs/ShowUp-backups/showup_<db>_<stamp>.sql.gz [target_db]
#
# Default target is a NEW scratch database "<DB_NAME>_restore_test", so a
# restore drill never touches production. To restore over the live database
# pass its name explicitly AND set CONFIRM_PRODUCTION_RESTORE=yes - stop the
# app services first (everything except postgres) so nothing writes meanwhile.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOWUP_DIR="${SHOWUP_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"
PG_SERVICE="${PG_SERVICE:-postgres}"

env_val() { grep -E "^$1=" "$SHOWUP_DIR/.env" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
DB_USER="${DB_USER:-$(env_val DB_USER)}"
DB_NAME="${DB_NAME:-$(env_val DB_NAME)}"

FILE="${1:-}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "usage: $0 <backup.sql.gz> [target_db]"; exit 1; }
TARGET="${2:-${DB_NAME}_restore_test}"

if [ "$TARGET" = "$DB_NAME" ] && [ "${CONFIRM_PRODUCTION_RESTORE:-}" != "yes" ]; then
  echo "Refusing to overwrite the live database '$DB_NAME'."
  echo "Re-run with CONFIRM_PRODUCTION_RESTORE=yes after stopping the app services."
  exit 1
fi

gzip -t "$FILE"
cd "$SHOWUP_DIR"
PSQL=(docker compose -f "$COMPOSE_FILE" exec -T "$PG_SERVICE" psql -U "$DB_USER" -v ON_ERROR_STOP=1)

if [ "$TARGET" != "$DB_NAME" ]; then
  echo "recreating scratch database $TARGET"
  "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$TARGET\";" -c "CREATE DATABASE \"$TARGET\";"
fi

echo "restoring $(basename "$FILE") -> $TARGET"
zcat "$FILE" | "${PSQL[@]}" -q -d "$TARGET" >/dev/null
echo "restore ok. Quick check:"
"${PSQL[@]}" -d "$TARGET" -At -c \
  "SELECT 'users='||(SELECT count(*) FROM users)||' events='||(SELECT count(*) FROM events)||' guests='||(SELECT count(*) FROM guests);" \
  || echo "(row-count check failed - inspect manually)"
if [ "$TARGET" != "$DB_NAME" ]; then
  echo "drop the scratch DB when done:  docker compose -f $COMPOSE_FILE exec -T $PG_SERVICE psql -U <user> -d postgres -c 'DROP DATABASE \"$TARGET\";'"
fi
