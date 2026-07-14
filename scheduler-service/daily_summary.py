"""
Daily owner summary.

Every day at DAILY_SUMMARY_HOUR (local DAILY_SUMMARY_TZ time, default 20:00
Asia/Jerusalem) each active event whose attendee confirmations changed since the
previous summary gets a WhatsApp summary sent to every event owner.

Flow: this module (called from the scheduler main loop) detects due events,
claims them idempotently via a UNIQUE (event_id, summary_date) row, and publishes
one template message per owner onto the outpost queue. outpost-service is the
single Meta egress; `sender: "assistant"` routes the send through the assistant
phone number (falls back to WA_PHONE_ID when no dedicated number is configured).

The WhatsApp template (WA_DAILY_SUMMARY_TEMPLATE_NAME, default "daily_summary")
must exist and be APPROVED on the WABA - it is business-initiated, so free text
is not an option. Body parameters, in order:
  {{1}} event name
  {{2}} attending people total (sum of confirmed party sizes)
  {{3}} declined count
  {{4}} pending (invited/maybe) count
"""

import json
import logging
import os
from datetime import datetime
from typing import Optional, Sequence
from zoneinfo import ZoneInfo

import psycopg2
import psycopg2.extras

logger = logging.getLogger("daily_summary")

SUMMARY_HOUR = int(os.getenv("DAILY_SUMMARY_HOUR", "20"))
SUMMARY_MINUTE = int(os.getenv("DAILY_SUMMARY_MINUTE", "0"))
SUMMARY_TZ = os.getenv("DAILY_SUMMARY_TZ", "Asia/Jerusalem")
TEMPLATE_NAME = os.getenv("WA_DAILY_SUMMARY_TEMPLATE_NAME", "daily_summary")
TEMPLATE_LANG = os.getenv("WA_DAILY_SUMMARY_LANG", "he")


def ensure_daily_summary_table(conn: psycopg2.extensions.connection) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS daily_summaries (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                event_id UUID NOT NULL,
                summary_date DATE NOT NULL,
                sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                confirmed INTEGER NOT NULL DEFAULT 0,
                attending INTEGER NOT NULL DEFAULT 0,
                declined INTEGER NOT NULL DEFAULT 0,
                pending INTEGER NOT NULL DEFAULT 0,
                recipients INTEGER NOT NULL DEFAULT 0,
                UNIQUE (event_id, summary_date)
            );
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_daily_summaries_event ON daily_summaries (event_id, summary_date DESC)"
        )


def _local_now() -> datetime:
    return datetime.now(ZoneInfo(SUMMARY_TZ))


def _fetch_candidates(conn, summary_date) -> Sequence[dict]:
    """Active events with no summary row for today, with current RSVP counts.

    Events more than a day past their date are excluded - there is nothing left
    to track. NULL event_date events (still being planned) stay included.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT e.id, e.name, e.owners,
                   COUNT(g.id) FILTER (WHERE g.status = 'confirmed') AS confirmed,
                   COALESCE(SUM(COALESCE(g.guest_count, 1)) FILTER (WHERE g.status = 'confirmed'), 0)::int AS attending,
                   COUNT(g.id) FILTER (WHERE g.status = 'declined') AS declined,
                   COUNT(g.id) FILTER (WHERE g.status IN ('invited', 'maybe')) AS pending
            FROM events e
            LEFT JOIN guests g ON g.event_id = e.id
            WHERE e.active = true
              AND (e.event_date IS NULL OR e.event_date >= NOW() - INTERVAL '1 day')
              AND NOT EXISTS (
                    SELECT 1 FROM daily_summaries ds
                    WHERE ds.event_id = e.id AND ds.summary_date = %s
              )
            GROUP BY e.id
            """,
            (summary_date,),
        )
        return cur.fetchall()


def _last_summary(conn, event_id) -> Optional[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT confirmed, attending, declined, pending
            FROM daily_summaries
            WHERE event_id = %s
            ORDER BY summary_date DESC
            LIMIT 1
            """,
            (event_id,),
        )
        return cur.fetchone()


def _owner_contacts(conn, owners_json) -> Sequence[dict]:
    """Resolve events.owners (JSON array of user-id strings) to phone numbers.

    All services share one Postgres database, so aub's users table is readable
    directly - the same pattern core-service uses over HTTP, without the hop.
    """
    if isinstance(owners_json, str):
        try:
            owners_json = json.loads(owners_json)
        except (TypeError, ValueError):
            return []
    owner_ids = [str(o) for o in (owners_json or []) if o]
    if not owner_ids:
        return []
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT id, first_name, phone FROM users WHERE id::text = ANY(%s) AND phone IS NOT NULL",
            (owner_ids,),
        )
        return cur.fetchall()


def _changed(current: dict, last: Optional[dict]) -> bool:
    if last is None:
        # First-ever summary: only worth sending once someone has responded.
        return (current["confirmed"] + current["declined"]) > 0
    return any(
        current[k] != last[k] for k in ("confirmed", "attending", "declined", "pending")
    )


def _claim(conn, event_id, summary_date, counts: dict, recipients: int) -> bool:
    """Insert the summary row; False means another scheduler instance won."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO daily_summaries (event_id, summary_date, confirmed, attending, declined, pending, recipients)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (event_id, summary_date) DO NOTHING
            RETURNING id
            """,
            (
                event_id,
                summary_date,
                counts["confirmed"],
                counts["attending"],
                counts["declined"],
                counts["pending"],
                recipients,
            ),
        )
        return cur.fetchone() is not None


def _unclaim(conn, event_id, summary_date) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM daily_summaries WHERE event_id = %s AND summary_date = %s",
            (event_id, summary_date),
        )


def _build_message(event: dict, owner: dict) -> dict:
    return {
        "platform": "WA",
        "message_type": "template",
        "recipient": owner["phone"],
        "template": TEMPLATE_NAME,
        "language": TEMPLATE_LANG,
        "parameters": {
            "1": event["name"],
            "2": str(event["attending"]),
            "3": str(event["declined"]),
            "4": str(event["pending"]),
        },
        "sender": "assistant",
        "event_id": str(event["id"]),
        "source": "daily_summary",
    }


def run_daily_summary_check(conn, publish) -> int:
    """Send due daily summaries. `publish` is a callable(message_dict).

    Returns the number of events summarized. Safe to call every scheduler cycle:
    outside the send window it returns immediately, inside it each event is
    claimed at most once per local day.
    """
    now = _local_now()
    if (now.hour, now.minute) < (SUMMARY_HOUR, SUMMARY_MINUTE):
        return 0
    summary_date = now.date()

    sent_events = 0
    for event in _fetch_candidates(conn, summary_date):
        counts = {k: event[k] for k in ("confirmed", "attending", "declined", "pending")}
        if not _changed(counts, _last_summary(conn, event["id"])):
            continue
        owners = _owner_contacts(conn, event["owners"])
        if not owners:
            logger.warning("Daily summary skipped - no owner phones | event=%s", event["id"])
            continue
        if not _claim(conn, event["id"], summary_date, counts, len(owners)):
            continue

        delivered = 0
        for owner in owners:
            try:
                publish(_build_message(event, owner))
                delivered += 1
            except Exception as e:
                logger.error(
                    "Daily summary publish failed | event=%s owner=%s error=%s",
                    event["id"], owner["id"], e,
                )
        if delivered == 0:
            # Nothing went out - release the claim so the next cycle retries.
            _unclaim(conn, event["id"], summary_date)
            continue

        sent_events += 1
        logger.info(
            "Daily summary sent | event=%s attending=%s declined=%s pending=%s owners=%s/%s",
            event["id"], counts["attending"], counts["declined"], counts["pending"],
            delivered, len(owners),
        )
    return sent_events
