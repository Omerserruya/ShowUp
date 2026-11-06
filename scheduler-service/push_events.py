"""What the owners' app pushes about (shared/domain/push.py does the sending).

  * a guest answered (any channel: WhatsApp, invite page, phone call) - one push
    per event per cycle, so a burst of answers after a round is one notification;
  * a round finished sending (campaign_finalizer calls `queue_round_sent`);
  * the 20:00 daily summary (daily_summary calls `queue_daily_summary`).

Guest answers are found by `guests.last_response` (set only by the guest's own
reply) and remembered per guest in `push_rsvp_state`, so a guest who writes
again without changing their answer is not announced twice.
"""
from __future__ import annotations

import logging
from typing import Dict, List

import psycopg2.extras

from shared.domain import push

logger = logging.getLogger("push_events")

ANSWERS = ("attending", "declined", "maybe")
_ICON = {"attending": "✅", "declined": "❌", "maybe": "🤔"}
_SAID = {"attending": "מגיעים", "declined": "לא מגיעים", "maybe": "עוד לא בטוחים"}
# Only answers this recent are announced (first run after deploy, long outages).
LOOKBACK_MINUTES = 30

STATE_SQL = """
CREATE TABLE IF NOT EXISTS push_rsvp_state (
    guest_id UUID PRIMARY KEY,
    status VARCHAR(20) NOT NULL,
    notified_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""


def ensure_tables(conn) -> None:
    with conn.cursor() as cur:
        push.ensure_tables(cur)
        cur.execute(STATE_SQL)


def _name(g: dict) -> str:
    return (g.get("name") or "").strip() or "אורח/ת"


def rsvp_message(guests: List[dict], attending_total: int) -> str:
    if len(guests) == 1:
        g = guests[0]
        extra = f" ({g['guest_count']})" if g["status"] == "attending" and (g.get("guest_count") or 0) > 1 else ""
        line = f"{_ICON[g['status']]} {_name(g)}: {_SAID[g['status']]}{extra}"
    else:
        counts = {s: sum(1 for g in guests if g["status"] == s) for s in ANSWERS}
        parts = [f"{counts[s]} {_SAID[s]}" for s in ANSWERS if counts[s]]
        names = [_name(g) for g in guests[:2]]
        more = f" ועוד {len(guests) - 2}" if len(guests) > 2 else ""
        line = f"{len(guests)} תשובות חדשות: {', '.join(parts)}\n{', '.join(names)}{more}"
    return f"{line}\nסה״כ מגיעים עד עכשיו: {attending_total}"


def queue_rsvp_pushes(conn) -> int:
    """Announce new / changed guest answers. Returns pushes queued."""
    queued = 0
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("BEGIN")
        cur.execute(
            """SELECT g.id, g.event_id, g.name, g.status, g.guest_count, e.name AS event_name
               FROM guests g JOIN events e ON e.id = g.event_id
               LEFT JOIN push_rsvp_state s ON s.guest_id = g.id
               WHERE g.status = ANY(%s)
                 AND g.last_response > now() - make_interval(mins => %s)
                 AND (s.guest_id IS NULL OR s.status <> g.status)
               ORDER BY g.last_response
               FOR UPDATE OF g SKIP LOCKED""",
            (list(ANSWERS), LOOKBACK_MINUTES))
        rows = cur.fetchall()
        by_event: Dict[str, List[dict]] = {}
        for r in rows:
            by_event.setdefault(str(r["event_id"]), []).append(r)
        for event_id, guests in by_event.items():
            cur.execute(
                "SELECT COALESCE(SUM(GREATEST(COALESCE(guest_count, 1), 1)), 0) AS n FROM guests "
                "WHERE event_id = %s AND status = 'attending'", (event_id,))
            total = int(cur.fetchone()["n"])
            queued += push.queue_push_for_event(
                cur, event_id, guests[0]["event_name"] or "ShowUp", rsvp_message(guests, total), path="/guests")
        for r in rows:
            cur.execute(
                """INSERT INTO push_rsvp_state (guest_id, status) VALUES (%s, %s)
                   ON CONFLICT (guest_id) DO UPDATE SET status = EXCLUDED.status, notified_at = now()""",
                (r["id"], r["status"]))
        cur.execute("COMMIT")
    return queued


def queue_round_sent(cur, campaign_id, event_id, name: str, recipients: int) -> int:
    body = f"הסבב \"{name}\" נשלח ל־{recipients} אורחים" if recipients else f"הסבב \"{name}\" הסתיים"
    cur.execute("SELECT name FROM events WHERE id = %s", (str(event_id),))
    row = cur.fetchone()
    title = (row[0] if row and not isinstance(row, dict) else (row or {}).get("name")) or "ShowUp"
    return push.queue_push_for_event(cur, str(event_id), title, "📤 " + body, path="/messages",
                                     dedupe_key=f"round:{campaign_id}")


def queue_daily_summary(cur, event: dict, owner_ids: List[str], deltas: dict, summary_date) -> int:
    parts = [f"{deltas['new_confirmed']} אישרו", f"{deltas['new_declined']} לא מגיעים"]
    if deltas.get("new_maybe"):
        parts.append(f"{deltas['new_maybe']} אולי")
    body = f"היום: {', '.join(parts)}\nסה״כ מגיעים: {event['attending']}"
    return push.queue_push(cur, owner_ids, f"סיכום יומי · {event['name']}", body,
                           url=push.event_url(str(event["id"]), "/overview"), event_id=str(event["id"]),
                           dedupe_key=f"daily:{event['id']}:{summary_date}")
