#!/usr/bin/env bash
#
# Worker integration test harness (Phase 14).
#
# Spins up a throwaway Postgres, applies the FULL schema via core-service Alembic,
# then runs each worker's integration check INSIDE that worker's own image against
# the live DB. This is the missing piece the core harness didn't cover.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

NET=showup-wtest-net
PG=showup-wtest-pg
PGUSER=test
PGPASS=test
CORE_IMG=showup-test-runner
CW_IMG=showup-cw-test

cleanup() {
  docker rm -f "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> network + postgres"
docker network create "$NET" >/dev/null 2>&1 || true
docker rm -f "$PG" >/dev/null 2>&1 || true
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_USER="$PGUSER" -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB=showup_test \
  postgres:16-alpine >/dev/null

echo -n "==> waiting for postgres"
for _ in $(seq 1 60); do
  if docker exec "$PG" psql -U "$PGUSER" -d showup_test -c "select 1" >/dev/null 2>&1; then echo " ready"; break; fi
  echo -n "."; sleep 1
done

echo "==> building images"
docker build -f tooling/test/Dockerfile -t "$CORE_IMG" . >/dev/null
docker build -f campaign-worker/Dockerfile -t "$CW_IMG" . >/dev/null

echo "==> applying full schema via core Alembic"
docker run --rm --network "$NET" \
  -e DATABASE_URL="postgresql+psycopg2://$PGUSER:$PGPASS@$PG:5432/showup_test" \
  -v "$REPO_ROOT":/work -w /work/core-service "$CORE_IMG" \
  alembic upgrade head

echo "==> campaign-worker integration check"
docker run --rm --network "$NET" \
  -e DB_HOST="$PG" -e DB_PORT=5432 -e DB_USER="$PGUSER" -e DB_PASSWORD="$PGPASS" -e DB_NAME=showup_test \
  -e PYTHONPATH=/app \
  "$CW_IMG" python tests/integration_check.py

echo "==> done"
