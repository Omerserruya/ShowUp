"""Retry-later failures (shared/domain/delivery.py RETRY_LATER_CODES).

Meta drops a MARKETING template for a person who already got their share of
business marketing messages (131049). The cap resets after ~24h or once they
reply, so such a message is re-sent ONCE: no sooner than RETRY_LATER_AFTER_HOURS
after the failure, and only while the send window is open - a retry that falls
due at night simply waits for the morning. The campaign worker does the actual
send in retry mode (same template, still-in-audience and still-unanswered
guests only, claimed atomically so repeats are harmless).
"""
from __future__ import annotations

import logging
import time
from typing import Callable, Dict, List

from shared.domain.delivery import (
    MessageDeliveryStatus, RETRY_LATER_AFTER_HOURS, RETRY_LATER_CODES,
    RETRY_LATER_MAX, RETRY_LATER_MAX_AGE_DAYS,
)

logger = logging.getLogger("scheduler")

CHECK_EVERY_SECONDS = 600
_last_check = {"t": 0.0}

DUE_SQL = """
    SELECT ms.campaign_id::text AS campaign_id, c.event_id::text AS event_id,
           array_agg(ms.guest_id::text) AS guest_ids
    FROM messages_sent ms
    JOIN campaigns c ON c.id = ms.campaign_id
    WHERE ms.status = %s AND ms.error_code = ANY(%s) AND ms.retry_count < %s
      AND ms.updated_at <= NOW() - make_interval(hours => %s)
      AND ms.updated_at >= NOW() - make_interval(days => %s)
      AND c.status IN ('sent', 'sending', 'pending', 'processing')
    GROUP BY ms.campaign_id, c.event_id
"""


def due_retries(conn) -> List[Dict]:
    with conn.cursor() as cur:
        cur.execute(DUE_SQL, (MessageDeliveryStatus.FAILED.value, list(RETRY_LATER_CODES), RETRY_LATER_MAX,
                              RETRY_LATER_AFTER_HOURS, RETRY_LATER_MAX_AGE_DAYS))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def dispatch_retries(conn, publish: Callable[[dict], None], in_window: bool, *, force: bool = False) -> int:
    """Publish one retry request per campaign with due rows. Self-throttled.

    Retries are new recipients for the rolling-24h WhatsApp limit like any
    planner batch, so they only use what is left of it (db.rolling_capacity -
    rolling_used); the rest simply waits for the next check."""
    if not in_window:
        return 0
    now = time.time()
    if not force and now - _last_check["t"] < CHECK_EVERY_SECONDS:
        return 0
    _last_check["t"] = now
    from db import rolling_capacity, rolling_used
    prev = conn.autocommit
    conn.autocommit = False          # rolling_capacity uses a SAVEPOINT
    try:
        with conn.cursor() as cur:
            room = max(0, rolling_capacity(cur) - rolling_used(cur))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.autocommit = prev
    n = 0
    for row in due_retries(conn):
        if room <= 0:
            break
        ids = list(row["guest_ids"])[:room]
        publish({"campaign_id": row["campaign_id"], "event_id": row["event_id"], "retry_guest_ids": ids})
        n += len(ids)
        room -= len(ids)
    return n
