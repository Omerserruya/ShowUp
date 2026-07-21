"""Structured platform error capture - one table the ops dashboard reads.

`record_error(...)` writes a row to `ops_errors` from any service. The dashboard
shows the latest errors (time, service, severity, message, event, user, stack)
and lets an operator mark one resolved. Best-effort and swallow-safe: recording
an error must never itself raise into the caller's failure path.

Deliberately narrow: this captures the failures an operator needs to see -
campaign send failures, Meta rejections, provisioning failures, webhook failures,
DB errors - not verbose application logging. Volume is bounded by only wiring it
into genuine failure branches.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import psycopg2

logger = logging.getLogger(__name__)

_DDL = (
    """
    CREATE TABLE IF NOT EXISTS ops_errors (
        id          BIGSERIAL PRIMARY KEY,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        service     VARCHAR(48) NOT NULL,
        severity    VARCHAR(16) NOT NULL DEFAULT 'error',
        message     TEXT NOT NULL,
        error_type  VARCHAR(80),
        event_id    UUID,
        user_id     UUID,
        stack       TEXT,
        context     JSONB,
        resolved    BOOLEAN NOT NULL DEFAULT FALSE,
        resolved_at TIMESTAMPTZ,
        resolved_by UUID
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_ops_errors_unresolved ON ops_errors (occurred_at DESC) WHERE NOT resolved",
    "CREATE INDEX IF NOT EXISTS ix_ops_errors_service ON ops_errors (service, occurred_at DESC)",
)

_INSERT = """
INSERT INTO ops_errors (service, severity, message, error_type, event_id, user_id, stack, context)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
"""

# Severities the dashboard understands (mirrors log levels an operator triages).
SEVERITY_INFO = "info"
SEVERITY_WARNING = "warning"
SEVERITY_ERROR = "error"
SEVERITY_CRITICAL = "critical"

_MAX_MESSAGE = 2000
_MAX_STACK = 8000


def _dsn() -> Optional[str]:
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


def record_error(
    service: str,
    message: str,
    *,
    severity: str = SEVERITY_ERROR,
    error_type: Optional[str] = None,
    event_id=None,
    user_id=None,
    stack: Optional[str] = None,
    context: Optional[dict] = None,
) -> None:
    """Record one operational error. Never raises."""
    import json
    dsn = _dsn()
    if not dsn:
        return
    try:
        conn = psycopg2.connect(dsn)
        try:
            conn.autocommit = True
            with conn.cursor() as cur:
                for stmt in _DDL:
                    cur.execute(stmt)
                cur.execute(_INSERT, (
                    service[:48], (severity or "error")[:16], str(message)[:_MAX_MESSAGE],
                    (error_type or None) and str(error_type)[:80],
                    str(event_id) if event_id else None,
                    str(user_id) if user_id else None,
                    (str(stack)[:_MAX_STACK] if stack else None),
                    json.dumps(context or {}),
                ))
        finally:
            conn.close()
    except Exception as exc:  # capture must never break the caller
        logger.debug("record_error failed (%s): %s", service, exc)
