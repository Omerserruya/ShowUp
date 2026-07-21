"""Service liveness heartbeats - the honest source for worker health.

Every service calls `start_heartbeat(name)` once at startup; a daemon thread then
upserts one row into `service_heartbeats` every INTERVAL seconds. The ops
dashboard reads `last_beat` and classifies:

    healthy   last_beat within HEALTHY_WINDOW (2 heartbeats)
    warning   within OFFLINE_WINDOW
    offline   older, or never seen

This is deliberately a real heartbeat, not activity inference: an idle worker
that is perfectly healthy still beats, so "no traffic" is never mistaken for
"down". `started_at` gives last-restart; `version` and `meta` are shown as-is.

Dependency-light on purpose (psycopg2 + stdlib) so services that do not import
the rest of `shared` can still report in. Self-creating table so heartbeats work
regardless of which service boots first.
"""
from __future__ import annotations

import logging
import os
import socket
import threading
import time
from typing import Optional

import psycopg2

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = int(os.getenv("HEARTBEAT_INTERVAL_SECONDS", "20"))

_DDL = """
CREATE TABLE IF NOT EXISTS service_heartbeats (
    service      VARCHAR(48) PRIMARY KEY,
    last_beat    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version      VARCHAR(64),
    host         VARCHAR(128),
    pid          INTEGER,
    meta         JSONB
)
"""

_UPSERT = """
INSERT INTO service_heartbeats (service, last_beat, started_at, version, host, pid, meta)
VALUES (%s, NOW(), %s, %s, %s, %s, %s::jsonb)
ON CONFLICT (service) DO UPDATE
SET last_beat = NOW(), started_at = EXCLUDED.started_at, version = EXCLUDED.version,
    host = EXCLUDED.host, pid = EXCLUDED.pid, meta = EXCLUDED.meta
"""

_started_services: set[str] = set()
_lock = threading.Lock()


def _dsn() -> Optional[str]:
    """Assemble a libpq DSN from the DB_* env every service already sets."""
    url = os.getenv("DATABASE_URL")
    if url:
        return url
    host = os.getenv("DB_HOST")
    if not host:
        return None
    return (
        f"host={host} port={os.getenv('DB_PORT', '5432')} "
        f"dbname={os.getenv('DB_NAME', '')} user={os.getenv('DB_USER', '')} "
        f"password={os.getenv('DB_PASSWORD', '')}"
    )


def _beat_once(dsn: str, service: str, started_at, version: Optional[str], meta_json: str) -> None:
    conn = psycopg2.connect(dsn)
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(_DDL)
            cur.execute(_UPSERT, (service, started_at, version,
                                  socket.gethostname()[:128], os.getpid(), meta_json))
    finally:
        conn.close()


def _loop(service: str, version: Optional[str], meta_json: str) -> None:
    import datetime as dt
    started_at = dt.datetime.now(dt.timezone.utc)
    while True:
        dsn = _dsn()
        if dsn:
            try:
                _beat_once(dsn, service, started_at, version, meta_json)
            except Exception as exc:  # never let a DB blip kill the worker
                logger.debug("heartbeat failed for %s: %s", service, exc)
        time.sleep(INTERVAL_SECONDS)


def start_heartbeat(service: str, *, version: Optional[str] = None, meta: Optional[dict] = None) -> None:
    """Begin reporting liveness for `service`. Idempotent per process.

    Non-blocking: spawns a daemon thread and returns. Safe to call from a FastAPI
    startup hook or just before a worker enters its consume loop.
    """
    import json
    with _lock:
        if service in _started_services:
            return
        _started_services.add(service)
    version = version or os.getenv("SERVICE_VERSION") or os.getenv("GIT_SHA")
    meta_json = json.dumps(meta or {})
    t = threading.Thread(target=_loop, args=(service, version, meta_json),
                         name=f"heartbeat-{service}", daemon=True)
    t.start()
    logger.info("heartbeat started for service=%s (every %ss)", service, INTERVAL_SECONDS)
