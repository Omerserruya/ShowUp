#!/usr/bin/env bash
#
# ShowUp containerized test + migration harness.
#
# Why this exists: the host has no pip/venv (ensurepip missing) and the full
# docker-compose stack is heavy. This spins up a throwaway Postgres + a runner
# image (service requirements + pytest + alembic), then:
#   1. validates Alembic migrations apply cleanly on an empty DB
#   2. runs the pytest suite against a fresh DB
# It is the foundation that makes "run tests / verify no regressions" real.
#
# Usage:  tooling/test/run.sh            # build image if needed, run everything
#         tooling/test/run.sh --no-build # skip image rebuild (faster)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

NET=showup-test-net
PG=showup-test-pg
IMG=showup-test-runner
PGUSER=test
PGPASS=test

cleanup() {
  docker rm -f "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> network"
docker network create "$NET" >/dev/null 2>&1 || true

echo "==> postgres (throwaway)"
docker rm -f "$PG" >/dev/null 2>&1 || true
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_USER="$PGUSER" -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB=showup_test \
  postgres:16-alpine >/dev/null

echo -n "==> waiting for postgres"
# NOTE: the official image starts a temporary init server first; pg_isready can
# pass against it before the real server is up. Poll an actual query against the
# real target DB (showup_test only exists once the real server has started).
ready=0
for _ in $(seq 1 60); do
  if docker exec "$PG" psql -U "$PGUSER" -d showup_test -c "select 1" >/dev/null 2>&1; then
    ready=1; echo " ready"; break
  fi
  echo -n "."; sleep 1
done
if [[ "$ready" != "1" ]]; then echo " FAILED: postgres not ready"; exit 1; fi

DO_BUILD=1
if [[ "${1:-}" == "--no-build" ]]; then DO_BUILD=0; shift; fi
if [[ "$DO_BUILD" == "1" ]]; then
  echo "==> building runner image"
  docker build -f tooling/test/Dockerfile -t "$IMG" . >/dev/null
fi

echo "==> migration check: alembic upgrade head on empty DB"
docker exec "$PG" psql -U "$PGUSER" -d postgres \
  -c "DROP DATABASE IF EXISTS mig_test;" -c "CREATE DATABASE mig_test;" >/dev/null
docker run --rm --network "$NET" \
  -e DATABASE_URL="postgresql+psycopg2://$PGUSER:$PGPASS@$PG:5432/mig_test" \
  -v "$REPO_ROOT":/work -w /work/core-service "$IMG" \
  alembic upgrade head
echo "    migrations OK"

echo "==> pytest"
docker run --rm --network "$NET" \
  -e DATABASE_URL="postgresql+psycopg2://$PGUSER:$PGPASS@$PG:5432/showup_test" \
  -e JWT_SECRET=test-secret \
  -e AUB_SERVICE_URL=http://disabled.invalid \
  -v "$REPO_ROOT":/work -w /work "$IMG" \
  pytest -q "$@" core-service/tests

echo "==> done"
