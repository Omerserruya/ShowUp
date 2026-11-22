"""
Daily owner summary.

Every day at DAILY_SUMMARY_HOUR (local DAILY_SUMMARY_TZ time, default 20:00
Asia/Jerusalem) each active event whose attendee confirmations changed since the
previous summary gets a WhatsApp summary sent to every event owner. On the event
day it goes out SUMMARY_PRE_EVENT_HOURS (4) before the event instead, and the
day after, a final summary (template final_summary) closes the event.

Flow: this module (called from the scheduler main loop) detects due events,
claims them idempotently via a UNIQUE (event_id, summary_date) row, and publishes
one template message per owner onto the outpost queue. outpost-service is the
single Meta egress; `sender: "assistant"` routes the send through the assistant
phone number (falls back to WA_PHONE_ID when no dedicated number is configured).

The WhatsApp template comes from the system-templates SSOT
(shared/content/system_templates.yaml, key "daily_summary"; overridable via
WA_SYSTEM_TEMPLATE_DAILY_SUMMARY). It must exist and be APPROVED on the WABA -
business-initiated, so free text is not an option. Body parameters, in order:
  {{1}} event name
  {{2}} NEW confirmations since the previous summary
  {{3}} NEW declines since the previous summary
  {{4}} NEW "maybe" replies since the previous summary
  {{5}} total expected attendees (sum of confirmed party sizes)
  {{6}} campaigns sent today
  {{7}} attention line (actionable, or a calm all-good)
"""

import json
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, Optional, Sequence
from zoneinfo import ZoneInfo

import psycopg2
import psycopg2.extras

from push_events import queue_daily_summary

logger = logging.getLogger("daily_summary")

SUMMARY_HOUR = int(os.getenv("DAILY_SUMMARY_HOUR", "20"))
SUMMARY_MINUTE = int(os.getenv("DAILY_SUMMARY_MINUTE", "0"))
SUMMARY_TZ = os.getenv("DAILY_SUMMARY_TZ", "Asia/Jerusalem")
def _template():
    """Meta template name + language from the system-templates SSOT, with the
    legacy env vars still honored as a final override."""
    from shared.domain.messaging.system_templates import get_system_template
    t = get_system_template("daily_summary")
    name = os.getenv("WA_DAILY_SUMMARY_TEMPLATE_NAME") or (t.meta_name if t else "daily_summary_v2")
    lang = os.getenv("WA_DAILY_SUMMARY_LANG") or (t.language if t else "he")
    return name, lang


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
        cur.execute("ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS maybe INTEGER NOT NULL DEFAULT 0")
        cur.execute("ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS campaigns_sent INTEGER NOT NULL DEFAULT 0")


def _local_now() -> datetime:
    return datetime.now(ZoneInfo(SUMMARY_TZ))


# When each event's summary goes out (local time):
#   before the event day  - DAILY at SUMMARY_HOUR, only if something changed
#   on the event day      - PRE_EVENT_HOURS before it starts (always), instead of 20:00
#   the day after         - FINAL at FINAL_HOUR: the closing numbers + congratulations
PRE_EVENT_HOURS = int(os.getenv("SUMMARY_PRE_EVENT_HOURS", "4"))
FINAL_HOUR = int(os.getenv("SUMMARY_FINAL_HOUR", "12"))
DAILY, PRE_EVENT, FINAL = "daily", "pre_event", "final"


def summary_kind(event_date, now: datetime):
    """(kind, due_at) for this event today, or None when nothing is due today."""
    today = now.date()
    at = lambda h, m=0: now.replace(hour=h, minute=m, second=0, microsecond=0)  # noqa: E731
    if event_date is None:
        return DAILY, at(SUMMARY_HOUR, SUMMARY_MINUTE)
    local = event_date.astimezone(now.tzinfo)
    days = (local.date() - today).days
    if days > 0:
        return DAILY, at(SUMMARY_HOUR, SUMMARY_MINUTE)
    if days == 0:
        if (local.hour, local.minute) == (0, 0):  # date without a time
            return PRE_EVENT, at(12)
        return PRE_EVENT, max(local - timedelta(hours=PRE_EVENT_HOURS), at(8))
    if days == -1:
        return FINAL, at(FINAL_HOUR)
    return None


def _due_events(conn, summary_date, now: datetime) -> Dict[str, str]:
    """{event_id: kind} for events whose summary is due now and not yet sent today."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT e.id, e.event_date FROM events e
            WHERE e.active = true
              AND (e.event_date IS NULL OR e.event_date >= NOW() - INTERVAL '2 days')
              AND NOT EXISTS (SELECT 1 FROM daily_summaries ds
                              WHERE ds.event_id = e.id AND ds.summary_date = %s)
            """,
            (summary_date,),
        )
        due = {}
        for r in cur.fetchall():
            k = summary_kind(r["event_date"], now)
            if k and now >= k[1]:
                due[str(r["id"])] = k[0]
        return due


def _fetch_candidates(conn, summary_date, event_ids: Sequence[str]) -> Sequence[dict]:
    """Current RSVP counts for the given events."""
    if not event_ids:
        return []
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT e.id, e.name, e.event_date, e.owners,
                   COUNT(g.id) FILTER (WHERE g.status IN ('confirmed', 'attending')) AS confirmed,
                   COALESCE(SUM(COALESCE(g.guest_count, 1)) FILTER (WHERE g.status IN ('confirmed', 'attending')), 0)::int AS attending,
                   COUNT(g.id) FILTER (WHERE g.status = 'declined') AS declined,
                   COUNT(g.id) FILTER (WHERE g.status = 'maybe') AS maybe,
                   COUNT(g.id) FILTER (WHERE g.status IN ('invited', 'pending')) AS pending,
                   (SELECT COUNT(*) FROM campaigns c
                     WHERE c.event_id = e.id AND c.status = 'sent'
                       AND c.updated_at >= %s::date AND c.updated_at < %s::date + INTERVAL '1 day'
                   )::int AS campaigns_sent
            FROM events e
            LEFT JOIN guests g ON g.event_id = e.id
            WHERE e.id::text = ANY(%s)
            GROUP BY e.id
            """,
            (summary_date, summary_date, list(event_ids)),
        )
        return cur.fetchall()


def _last_summary(conn, event_id) -> Optional[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT confirmed, attending, declined, maybe, pending
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
    """Something meaningful happened since the previous summary: RSVP movement
    in any direction, or campaigns that went out today."""
    if current.get("campaigns_sent", 0) > 0:
        return True
    if last is None:
        # First-ever summary: only worth sending once someone has responded.
        return (current["confirmed"] + current["declined"] + current.get("maybe", 0)) > 0
    return any(
        current[k] != last.get(k, 0) for k in ("confirmed", "attending", "declined", "maybe", "pending")
    )


def _deltas(current: dict, last: Optional[dict]) -> dict:
    """NEW responses since the previous summary (never negative - a guest
    flipping away from a status shows up in the status they moved TO)."""
    base = last or {"confirmed": 0, "declined": 0, "maybe": 0}
    return {
        "new_confirmed": max(0, current["confirmed"] - int(base.get("confirmed") or 0)),
        "new_declined": max(0, current["declined"] - int(base.get("declined") or 0)),
        "new_maybe": max(0, current.get("maybe", 0) - int(base.get("maybe") or 0)),
    }


def _attention_line(event: dict) -> str:
    """One short line: who hasn't answered yet, or a calm all-good."""
    pending = int(event.get("pending") or 0)
    if pending > 0:
        return f"{pending} אורחים עוד לא ענו"
    return "כל האורחים ענו 👌"


def _claim(conn, event_id, summary_date, counts: dict, recipients: int) -> bool:
    """Insert the summary row; False means another scheduler instance won."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO daily_summaries (event_id, summary_date, confirmed, attending, declined, maybe, pending, campaigns_sent, recipients)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (event_id, summary_date) DO NOTHING
            RETURNING id
            """,
            (
                event_id,
                summary_date,
                counts["confirmed"],
                counts["attending"],
                counts["declined"],
                counts["maybe"],
                counts["pending"],
                counts["campaigns_sent"],
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


def _build_final_message(event: dict, owner: dict) -> dict:
    from shared.domain.messaging.system_templates import get_system_template
    t = get_system_template("final_summary")
    return {
        "platform": "WA",
        "message_type": "template",
        "recipient": owner["phone"],
        "template": t.meta_name if t else "final_summary",
        "language": t.language if t else "he",
        "parameters": {
            "1": event["name"],
            "2": str(event["attending"]),
            "3": str(event["declined"]),
            "4": str(int(event.get("pending") or 0) + int(event.get("maybe") or 0)),
        },
        "sender": "assistant",
        "event_id": str(event["id"]),
        "source": "final_summary",
    }


def _build_message(event: dict, owner: dict, deltas: dict) -> dict:
    name, lang = _template()
    return {
        "platform": "WA",
        "message_type": "template",
        "recipient": owner["phone"],
        "template": name,
        "language": lang,
        "parameters": {
            "1": event["name"],
            "2": str(deltas["new_confirmed"]),
            "3": str(deltas["new_declined"]),
            "4": str(deltas["new_maybe"]),
            "5": str(event["attending"]),
            "6": str(event["campaigns_sent"]),
            "7": _attention_line(event),
        },
        "sender": "assistant",
        "event_id": str(event["id"]),
        "source": "daily_summary",
    }


def run_daily_summary_check(conn, publish) -> int:
    """Send due daily summaries. `publish` is a callable(message_dict).

    Returns the number of events summarized. Safe to call every scheduler cycle:
    each event is claimed at most once per local day, at the time
    `summary_kind` gives it (evening / hours before the event / the day after).
    """
    now = _local_now()
    summary_date = now.date()
    due = _due_events(conn, summary_date, now)
    if not due:
        return 0

    sent_events = 0
    for event in _fetch_candidates(conn, summary_date, list(due)):
        kind = due[str(event["id"])]
        counts = {k: event[k] for k in ("confirmed", "attending", "declined", "maybe", "pending", "campaigns_sent")}
        last = _last_summary(conn, event["id"])
        # The regular evening summary only when something moved; the event-day
        # and final summaries always (if anyone answered at all).
        if kind == DAILY and not _changed(counts, last):
            continue
        if kind != DAILY and counts["confirmed"] + counts["declined"] + counts["maybe"] == 0:
            continue
        deltas = _deltas(counts, last)
        owners = _owner_contacts(conn, event["owners"])
        if not owners:
            logger.warning("Daily summary skipped - no owner phones | event=%s", event["id"])
            continue
        if not _claim(conn, event["id"], summary_date, counts, len(owners)):
            continue

        delivered = 0
        for owner in owners:
            try:
                publish(_build_final_message(event, owner) if kind == FINAL
                        else _build_message(event, owner, deltas))
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
        try:  # the owners' app gets the same summary as a push
            with conn.cursor() as cur:
                queue_daily_summary(cur, event, [str(o["id"]) for o in owners], deltas, summary_date,
                                    final=(kind == FINAL))
        except Exception as e:
            logger.warning("Daily summary push not queued | event=%s error=%s", event["id"], e)
        logger.info(
            "Daily summary sent | event=%s attending=%s declined=%s pending=%s owners=%s/%s",
            event["id"], counts["attending"], counts["declined"], counts["pending"],
            delivered, len(owners),
        )
    return sent_events
