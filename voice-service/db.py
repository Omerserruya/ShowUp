"""voice-service persistence (psycopg2, raw SQL like the other workers).

Tables (created at startup, idempotent):
  voice_rounds   one phone round per event (who to call, when it starts)
  voice_calls    one row per guest per round; attempts are counted on the row
  voice_event_settings  per-event switch (admin override of the plan allowance)
  voice_kv       small key/value cache (the resolved TTS voice id)
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import timedelta
from typing import Any, Dict, Iterator, List, Optional

import logging
import psycopg2
import psycopg2.extras
import psycopg2.pool

from shared.domain import voice_calls as vc
from shared.domain.delivery import RETRY_LATER_CODES, RETRY_LATER_MAX
from shared.domain.enums import GuestStatus
from shared.domain.flow_graph import RSVP_DB_VALUE
from shared.domain.optout import OPT_OUT_SQL_PREDICATE

_pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None

# Who a phone round calls: still undecided - no answer yet, or answered "maybe".
CALL_STATUSES = sorted(GuestStatus.pending_values() | GuestStatus.maybe_values())


def _dsn() -> str:
    url = os.getenv("DATABASE_URL")
    if url:
        return url.replace("postgresql+psycopg2://", "postgresql://")
    return (f"host={os.getenv('DB_HOST', 'postgres')} port={os.getenv('DB_PORT', '5432')} "
            f"user={os.getenv('DB_USER')} password={os.getenv('DB_PASSWORD')} dbname={os.getenv('DB_NAME')}")


def init_pool(maxconn: int = 8) -> None:
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.ThreadedConnectionPool(1, maxconn, _dsn())


@contextmanager
def tx() -> Iterator[psycopg2.extras.RealDictCursor]:
    """One transaction: commit on success, rollback on error."""
    init_pool()
    assert _pool is not None
    conn = _pool.getconn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _pool.putconn(conn)


SCHEMA = """
CREATE TABLE IF NOT EXISTS voice_rounds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'scheduled',
    start_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid,
    total int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_voice_rounds_event ON voice_rounds (event_id);
CREATE TABLE IF NOT EXISTS voice_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id uuid REFERENCES voice_rounds(id) ON DELETE CASCADE,
    event_id uuid,
    guest_id uuid,
    phone text NOT NULL,
    guest_name text,
    is_test boolean NOT NULL DEFAULT false,
    test_context jsonb,
    status text NOT NULL DEFAULT 'queued',
    attempt int NOT NULL DEFAULT 0,
    next_at timestamptz NOT NULL DEFAULT now(),
    twilio_sid text,
    answered_by text,
    digits text,
    result text,
    guest_count int,
    opening_clip text,
    tone text,
    duration_sec int,
    price numeric,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (round_id, guest_id)
);
CREATE INDEX IF NOT EXISTS ix_voice_calls_due ON voice_calls (status, next_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_voice_calls_sid ON voice_calls (twilio_sid) WHERE twilio_sid IS NOT NULL;
CREATE TABLE IF NOT EXISTS voice_event_settings (
    event_id uuid PRIMARY KEY,
    enabled boolean,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS voice_kv (
    k text PRIMARY KEY,
    v text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- Automatic rounds (round_plan.call_rounds): created ahead of time, the guest
-- list is taken when the round STARTS (populated=false until then), and they
-- follow the event date until the owner moves one by hand (auto=false).
ALTER TABLE voice_rounds ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false;
ALTER TABLE voice_rounds ADD COLUMN IF NOT EXISTS populated boolean NOT NULL DEFAULT true;
ALTER TABLE voice_event_settings ADD COLUMN IF NOT EXISTS auto_planned_for timestamptz;
-- a guest calling our number back (inbound) vs. a call we placed
ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'outbound';
"""

# Call statuses: queued -> preparing -> dialing -> in_progress -> done
#                (any) -> canceled ; retryable outcomes go back to queued.
ACTIVE = ("preparing", "dialing", "in_progress")


def ensure_schema() -> None:
    with tx() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(hashtext('voice_service_schema'))")
        cur.execute(SCHEMA)


# ---- kv ---------------------------------------------------------------------------

def kv_get(k: str) -> Optional[str]:
    with tx() as cur:
        cur.execute("SELECT v FROM voice_kv WHERE k = %s", (k,))
        r = cur.fetchone()
        return r["v"] if r else None


def kv_set(k: str, v: str) -> None:
    with tx() as cur:
        cur.execute("INSERT INTO voice_kv (k, v) VALUES (%s, %s) "
                    "ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now()", (k, v))


# ---- events / allowance --------------------------------------------------------------

def get_event(event_id: str) -> Optional[Dict[str, Any]]:
    with tx() as cur:
        cur.execute("SELECT id, name, event_date, location, inviters, subjects, event_type, plan_id, public_slug "
                    "FROM events WHERE id = %s", (event_id,))
        return cur.fetchone()


def event_override(event_id: str) -> Optional[bool]:
    with tx() as cur:
        cur.execute("SELECT enabled FROM voice_event_settings WHERE event_id = %s", (event_id,))
        r = cur.fetchone()
        return None if r is None else r["enabled"]


def set_event_override(event_id: str, enabled: Optional[bool]) -> None:
    with tx() as cur:
        cur.execute("INSERT INTO voice_event_settings (event_id, enabled) VALUES (%s, %s) "
                    "ON CONFLICT (event_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()",
                    (event_id, enabled))


def rounds_used(event_id: str) -> int:
    with tx() as cur:
        cur.execute("SELECT count(*) AS n FROM voice_rounds WHERE event_id = %s AND status <> 'canceled'", (event_id,))
        return int(cur.fetchone()["n"])


# ---- audience ------------------------------------------------------------------------

def _pending_guests_sql() -> str:
    # Guests still undecided: no answer yet OR answered "maybe" (like the
    # WhatsApp follow-up rounds), with a phone, not opted out, and not tagged
    # no_reminders by the conversation flow.
    return f"""
        SELECT g.id, g.name, g.phone,
               EXISTS (SELECT 1 FROM messages_sent ms WHERE ms.guest_id = g.id AND ms.status = 'failed'
                       AND ms.error_code = ANY(%s) AND ms.retry_count >= %s) AS wa_blocked
        FROM guests g
        WHERE g.event_id = %s AND g.phone IS NOT NULL AND g.phone <> ''
          AND {OPT_OUT_SQL_PREDICATE}
          AND g.status = ANY(%s)
          AND NOT EXISTS (SELECT 1 FROM guest_tags gtn JOIN tags tn ON tn.id = gtn.tag_id
                          WHERE gtn.guest_id = g.id AND tn.name = 'no_reminders')
        ORDER BY wa_blocked DESC, g.name
    """


def _pending_args(event_id: str) -> tuple:
    return (list(RETRY_LATER_CODES), RETRY_LATER_MAX, event_id, CALL_STATUSES)


# Guests WhatsApp could not reach even after the retry (Meta's per-user marketing
# cap) are dialled first: queued a minute earlier, and claim_due orders by next_at.
BLOCKED_HEAD_START = timedelta(minutes=1)


def pending_guests(event_id: str) -> List[Dict[str, Any]]:
    with tx() as cur:
        cur.execute(_pending_guests_sql(), _pending_args(event_id))
        return list(cur.fetchall())


def create_round(event_id: str, start_at, created_by: Optional[str], guests: List[Dict[str, Any]],
                 phone_of) -> Dict[str, Any]:
    with tx() as cur:
        cur.execute("INSERT INTO voice_rounds (event_id, start_at, created_by, total) VALUES (%s, %s, %s, 0) "
                    "RETURNING id, event_id, status, start_at, created_at", (event_id, start_at, created_by))
        rnd = cur.fetchone()
        n = 0
        for g in guests:
            phone = phone_of(g["phone"])
            if not phone:
                continue
            cur.execute("INSERT INTO voice_calls (round_id, event_id, guest_id, phone, guest_name, next_at) "
                        "VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                        (rnd["id"], event_id, g["id"], phone, g.get("name"),
                         start_at - BLOCKED_HEAD_START if g.get("wa_blocked") else start_at))
            n += cur.rowcount
        cur.execute("UPDATE voice_rounds SET total = %s WHERE id = %s", (n, rnd["id"]))
        rnd["total"] = n
        return rnd


def create_test_call(phone: str, name: str, context: Dict[str, Any], event_id: Optional[str]) -> Dict[str, Any]:
    with tx() as cur:
        cur.execute("INSERT INTO voice_calls (event_id, phone, guest_name, is_test, test_context) "
                    "VALUES (%s, %s, %s, true, %s) RETURNING id, status, created_at",
                    (event_id, phone, name, psycopg2.extras.Json(context)))
        return cur.fetchone()


def record_demo_lead(name: str, phone: str, ip_hash: str, user_agent: Optional[str]) -> None:
    """Admin "פניות" list + WhatsApp alert. Never blocks the demo call."""
    from shared.domain.leads import record_lead
    try:
        with tx() as cur:
            record_lead(cur, "call", name, phone, ip_hash=ip_hash, user_agent=user_agent)
    except Exception:  # pragma: no cover
        logging.getLogger("voice").exception("demo lead not recorded")


def demo_usage(phone: str, ip_hash: str) -> Dict[str, int]:
    """Landing-page sample calls already requested (rate limits)."""
    with tx() as cur:
        cur.execute("""SELECT
              count(*) FILTER (WHERE phone = %s AND created_at > now() - interval '1 day')  AS phone_day,
              count(*) FILTER (WHERE phone = %s AND created_at > now() - interval '7 days') AS phone_week,
              count(*) FILTER (WHERE test_context->>'ip' = %s AND created_at > now() - interval '1 day') AS ip_day,
              count(*) FILTER (WHERE created_at > now() - interval '1 day') AS all_day
            FROM voice_calls WHERE is_test AND direction = 'outbound' AND (test_context->>'demo')::boolean IS TRUE
              AND created_at > now() - interval '7 days'""", (phone, phone, ip_hash))
        return {k: int(v or 0) for k, v in cur.fetchone().items()}


def list_rounds(event_id: str) -> List[Dict[str, Any]]:
    with tx() as cur:
        cur.execute("""
            SELECT r.id, r.status, r.start_at, r.total, r.created_at, r.finished_at, r.auto, r.populated,
                   count(c.*) FILTER (WHERE c.result = 'confirmed') AS confirmed,
                   count(c.*) FILTER (WHERE c.result = 'declined') AS declined,
                   count(c.*) FILTER (WHERE c.result = 'maybe') AS maybe,
                   count(c.*) FILTER (WHERE c.status = 'done' AND c.result NOT IN ('confirmed','declined','maybe')) AS unreached,
                   count(c.*) FILTER (WHERE c.status IN ('queued','preparing','dialing','in_progress')) AS pending,
                   coalesce(sum(c.attempt), 0) AS attempts,
                   coalesce(sum(c.duration_sec), 0) AS seconds,
                   coalesce(sum(c.price), 0) AS price
            FROM voice_rounds r LEFT JOIN voice_calls c ON c.round_id = r.id
            WHERE r.event_id = %s GROUP BY r.id ORDER BY r.start_at""", (event_id,))
        return list(cur.fetchall())


def cancel_round(round_id: str) -> int:
    with tx() as cur:
        cur.execute("UPDATE voice_calls SET status = 'canceled', result = coalesce(result, 'canceled'), updated_at = now() "
                    "WHERE round_id = %s AND status IN ('queued')", (round_id,))
        n = cur.rowcount
        cur.execute("UPDATE voice_rounds SET status = 'canceled', finished_at = now() WHERE id = %s "
                    "AND status IN ('scheduled', 'running')", (round_id,))
        return n


def get_call(call_id: str) -> Optional[Dict[str, Any]]:
    with tx() as cur:
        cur.execute("SELECT * FROM voice_calls WHERE id = %s", (call_id,))
        return cur.fetchone()


# ---- dialer --------------------------------------------------------------------------

def start_due_rounds(phone_of=None) -> int:
    """Start due rounds. A round created ahead of time takes its guest list NOW
    - whoever still has not answered - so guests added or answering in the
    meantime are handled correctly. A round with nobody left to call ends."""
    with tx() as cur:
        cur.execute("SELECT id, event_id, populated FROM voice_rounds WHERE status = 'scheduled' AND start_at <= now() "
                    "FOR UPDATE SKIP LOCKED")
        due = list(cur.fetchall())
        for r in due:
            if not r["populated"]:
                cur.execute(_pending_guests_sql(), _pending_args(str(r["event_id"])))
                n = 0
                for g in cur.fetchall():
                    phone = phone_of(g["phone"]) if phone_of else g["phone"]
                    if not phone:
                        continue
                    cur.execute("INSERT INTO voice_calls (round_id, event_id, guest_id, phone, guest_name, next_at) "
                                "VALUES (%s, %s, %s, %s, %s, now() - %s) ON CONFLICT DO NOTHING",
                                (r["id"], r["event_id"], g["id"], phone, g.get("name"),
                                 BLOCKED_HEAD_START if g.get("wa_blocked") else timedelta(0)))
                    n += cur.rowcount
                if n == 0:
                    cur.execute("UPDATE voice_rounds SET status = 'done', populated = true, total = 0, "
                                "finished_at = now() WHERE id = %s", (r["id"],))
                    continue
                cur.execute("UPDATE voice_rounds SET populated = true, total = %s WHERE id = %s", (n, r["id"]))
            cur.execute("UPDATE voice_rounds SET status = 'running' WHERE id = %s", (r["id"],))
        return len(due)


# ---- automatic / owner-scheduled rounds ------------------------------------------------

def auto_plan_candidates() -> List[Dict[str, Any]]:
    """Live events with a future date whose automatic call plan is missing or
    was made for a different date."""
    with tx() as cur:
        cur.execute("""
            SELECT e.id, e.event_type, e.plan_id, e.event_date, s.enabled AS override, s.auto_planned_for
            FROM events e LEFT JOIN voice_event_settings s ON s.event_id = e.id
            WHERE e.event_date > now() + interval '1 day' AND coalesce(e.state, 'active') = 'active'
              AND (s.auto_planned_for IS NULL OR s.auto_planned_for <> e.event_date)""")
        return list(cur.fetchall())


def replace_auto_rounds(event_id: str, event_date, starts: List[Any], allowed: int) -> int:
    """Drop not-yet-started automatic rounds and plan new ones, within what is
    left of the allowance. Rounds the owner set by hand are kept."""
    with tx() as cur:
        cur.execute("DELETE FROM voice_rounds WHERE event_id = %s AND auto AND status = 'scheduled' AND NOT populated",
                    (event_id,))
        cur.execute("SELECT max(start_at) AS last, count(*) AS n FROM voice_rounds "
                    "WHERE event_id = %s AND status <> 'canceled'", (event_id,))
        row = cur.fetchone()
        left = max(0, allowed - int(row["n"] or 0))
        made = 0
        for at in starts:
            if made >= left:
                break
            if row["last"] is not None and at <= row["last"]:
                continue
            cur.execute("INSERT INTO voice_rounds (event_id, start_at, auto, populated) VALUES (%s, %s, true, false)",
                        (event_id, at))
            made += 1
        cur.execute("INSERT INTO voice_event_settings (event_id, auto_planned_for) VALUES (%s, %s) "
                    "ON CONFLICT (event_id) DO UPDATE SET auto_planned_for = EXCLUDED.auto_planned_for, "
                    "updated_at = now()", (event_id, event_date))
        return made


def add_round(event_id: str, start_at, created_by: Optional[str]) -> Dict[str, Any]:
    with tx() as cur:
        cur.execute("INSERT INTO voice_rounds (event_id, start_at, created_by, auto, populated) "
                    "VALUES (%s, %s, %s, false, false) RETURNING id, event_id, status, start_at",
                    (event_id, start_at, created_by))
        return cur.fetchone()


def get_round(round_id: str) -> Optional[Dict[str, Any]]:
    with tx() as cur:
        cur.execute("SELECT * FROM voice_rounds WHERE id = %s", (round_id,))
        return cur.fetchone()


def move_round(round_id: str, start_at) -> bool:
    """Move a round that has not started; it stops following the event date."""
    with tx() as cur:
        cur.execute("UPDATE voice_rounds SET start_at = %s, auto = false WHERE id = %s AND status = 'scheduled' "
                    "AND NOT populated", (start_at, round_id))
        return cur.rowcount == 1


def active_count() -> int:
    with tx() as cur:
        cur.execute("SELECT count(*) AS n FROM voice_calls WHERE status = ANY(%s)", (list(ACTIVE),))
        return int(cur.fetchone()["n"])


def claim_due(limit: int, in_window: bool) -> List[Dict[str, Any]]:
    """Claim up to `limit` due calls (-> preparing). Test calls ignore the call
    window; round calls only when `in_window` and their round is running."""
    if limit <= 0:
        return []
    with tx() as cur:
        cur.execute("""
            UPDATE voice_calls SET status = 'preparing', updated_at = now()
            WHERE id IN (
                SELECT c.id FROM voice_calls c LEFT JOIN voice_rounds r ON r.id = c.round_id
                WHERE c.status = 'queued' AND c.next_at <= now()
                  AND (c.is_test OR (%s AND r.status = 'running'))
                ORDER BY c.is_test DESC, c.next_at
                LIMIT %s FOR UPDATE OF c SKIP LOCKED)
            RETURNING *""", (in_window, limit))
        return list(cur.fetchall())


def guest_still_pending(guest_id: str) -> bool:
    with tx() as cur:
        cur.execute(f"SELECT 1 FROM guests g WHERE g.id = %s AND g.status = ANY(%s) AND {OPT_OUT_SQL_PREDICATE}",
                    (guest_id, CALL_STATUSES))
        return cur.fetchone() is not None


def get_guest(guest_id: str) -> Optional[Dict[str, Any]]:
    with tx() as cur:
        cur.execute("SELECT id, name, phone, status, import_count, guest_count FROM guests WHERE id = %s", (guest_id,))
        return cur.fetchone()


def mark_dialing(call_id: str, sid: str, opening_clip: str, tone: str) -> None:
    with tx() as cur:
        cur.execute("UPDATE voice_calls SET status = 'dialing', twilio_sid = %s, attempt = attempt + 1, "
                    "opening_clip = %s, tone = %s, error = NULL, updated_at = now() WHERE id = %s",
                    (sid, opening_clip, tone, call_id))


def mark_canceled(call_id: str, reason: str) -> None:
    with tx() as cur:
        cur.execute("UPDATE voice_calls SET status = 'canceled', result = 'canceled', error = %s, updated_at = now() "
                    "WHERE id = %s", (reason, call_id))


def mark_in_progress(call_id: str, answered_by: Optional[str]) -> None:
    with tx() as cur:
        cur.execute("UPDATE voice_calls SET status = 'in_progress', answered_by = coalesce(%s, answered_by), "
                    "updated_at = now() "
                    "WHERE id = %s AND status IN ('dialing', 'in_progress')", (answered_by, call_id))


def set_answered_by(call_id: str, answered_by: Optional[str]) -> Optional[Dict[str, Any]]:
    """Async AMD verdict. Returns the row (digits tell whether a human already pressed)."""
    with tx() as cur:
        cur.execute("UPDATE voice_calls SET answered_by = %s, updated_at = now() WHERE id = %s "
                    "RETURNING id, digits, result, twilio_sid", (answered_by, call_id))
        return cur.fetchone()


def record_digits(call_id: str, digits: str) -> None:
    with tx() as cur:
        cur.execute("UPDATE voice_calls SET digits = left(coalesce(digits || ',', '') || %s, 200), updated_at = now() "
                    "WHERE id = %s", (digits or "-", call_id))


def apply_result(call_id: str, result: str, count: Optional[int]) -> None:
    """Store the keypad outcome and apply it to the guest in ONE transaction -
    the same columns the WhatsApp flow writes (status/guest_count/last_response)."""
    with tx() as cur:
        cur.execute("UPDATE voice_calls SET result = %s, guest_count = %s, updated_at = now() "
                    "WHERE id = %s AND result IS NULL RETURNING guest_id, is_test, round_id",
                    (result, count, call_id))
        row = cur.fetchone()
        if not row or row["is_test"] or not row["guest_id"] or result not in vc.CallResult.RSVP:
            return
        status = RSVP_DB_VALUE[result]
        if result == vc.CallResult.CONFIRMED:
            cur.execute("UPDATE guests SET status = %s, guest_count = coalesce(%s, guest_count, import_count, 1), "
                        "last_response = now() WHERE id = %s", (status, count, row["guest_id"]))
        else:
            cur.execute("UPDATE guests SET status = %s, last_response = now() WHERE id = %s",
                        (status, row["guest_id"]))


def finish_call(sid: str, call_status: str, answered_by: Optional[str], duration: Optional[int],
                price: Optional[float], retry_minutes: int, max_attempts: int) -> Optional[Dict[str, Any]]:
    """Twilio's final status callback: settle the row (retry or done) and close
    the round when nothing is left."""
    with tx() as cur:
        cur.execute("SELECT * FROM voice_calls WHERE twilio_sid = %s FOR UPDATE", (sid,))
        c = cur.fetchone()
        if not c or c["status"] in ("done", "canceled"):
            return c
        result = c["result"] or vc.result_from_status(call_status, answered_by or c["answered_by"])
        if result is None:
            result = vc.CallResult.NO_INPUT if (call_status or "").lower() == "completed" else vc.CallResult.FAILED
        retry = (c["result"] is None and result in vc.CallResult.RETRYABLE
                 and c["attempt"] < max_attempts and not c["is_test"] and c["direction"] == "outbound")
        if retry:
            cur.execute("UPDATE voice_calls SET status = 'queued', next_at = now() + make_interval(mins => %s), "
                        "answered_by = coalesce(%s, answered_by), duration_sec = coalesce(duration_sec, 0) + coalesce(%s, 0), "
                        "price = coalesce(price, 0) + coalesce(%s, 0), error = %s, twilio_sid = NULL, updated_at = now() "
                        "WHERE id = %s", (retry_minutes, answered_by, duration, price, result, c["id"]))
        else:
            cur.execute("UPDATE voice_calls SET status = 'done', result = %s, "
                        "answered_by = coalesce(%s, answered_by), duration_sec = coalesce(duration_sec, 0) + coalesce(%s, 0), "
                        "price = coalesce(price, 0) + coalesce(%s, 0), updated_at = now() WHERE id = %s",
                        (result, answered_by, duration, price, c["id"]))
        if c["round_id"]:
            cur.execute("""UPDATE voice_rounds SET status = 'done', finished_at = now()
                           WHERE id = %s AND status = 'running' AND NOT EXISTS (
                             SELECT 1 FROM voice_calls WHERE round_id = %s AND status NOT IN ('done', 'canceled'))""",
                        (c["round_id"], c["round_id"]))
        return c


def requeue_or_fail(call_id: str, error: str, retry_minutes: int, max_attempts: int) -> None:
    """A call that could not be placed (TTS/Twilio error)."""
    with tx() as cur:
        cur.execute("""UPDATE voice_calls SET
                         status = CASE WHEN attempt + 1 < %s THEN 'queued' ELSE 'done' END,
                         result = CASE WHEN attempt + 1 < %s THEN NULL ELSE 'failed' END,
                         attempt = attempt + 1, next_at = now() + make_interval(mins => %s),
                         error = left(%s, 500), updated_at = now()
                       WHERE id = %s""", (max_attempts, max_attempts, retry_minutes, error, call_id))


def reap_stale(minutes: int = 15) -> int:
    """Calls stuck mid-flight (a lost status callback) - mark failed."""
    with tx() as cur:
        cur.execute("UPDATE voice_calls SET status = 'done', result = coalesce(result, 'failed'), "
                    "error = coalesce(error, 'stale'), updated_at = now() "
                    "WHERE status = ANY(%s) AND updated_at < now() - make_interval(mins => %s)",
                    (list(ACTIVE), minutes))
        return cur.rowcount


# ---- calls back to our number ----------------------------------------------------------

INBOUND_LOOKBACK_DAYS = 14


def _phone_forms(e164_phone: str) -> List[str]:
    """How a guest phone may be stored: +972..., 972..., 0... (canonical is +972)."""
    d = e164_phone.lstrip("+")
    forms = [e164_phone, d]
    if d.startswith("972"):
        forms.append("0" + d[3:])
    return forms


def recent_outbound_call(e164_phone: str) -> Optional[Dict[str, Any]]:
    """The last call we placed to this number in the lookback window - a call back
    is almost always about it. A guest call only counts while its event is ahead."""
    with tx() as cur:
        cur.execute("""
            SELECT c.* FROM voice_calls c LEFT JOIN events e ON e.id = c.event_id
            WHERE c.phone = %s AND c.direction = 'outbound'
              AND c.created_at > now() - make_interval(days => %s)
              AND (c.is_test OR (c.guest_id IS NOT NULL AND e.event_date > now() - interval '12 hours'))
            ORDER BY c.created_at DESC LIMIT 1""", (e164_phone, INBOUND_LOOKBACK_DAYS))
        return cur.fetchone()


def guest_invitations(e164_phone: str, limit: int) -> List[Dict[str, Any]]:
    """This number's invitations to events that are still ahead, soonest first."""
    with tx() as cur:
        cur.execute(f"""
            SELECT g.id AS guest_id, g.name AS guest_name, g.event_id
            FROM guests g JOIN events e ON e.id = g.event_id
            WHERE g.phone = ANY(%s) AND e.event_date > now() - interval '12 hours' AND {OPT_OUT_SQL_PREDICATE}
            ORDER BY e.event_date LIMIT %s""", (_phone_forms(e164_phone), limit))
        return list(cur.fetchall())


def get_invitation(guest_id: str) -> Optional[Dict[str, Any]]:
    with tx() as cur:
        cur.execute("SELECT g.id AS guest_id, g.name AS guest_name, g.event_id FROM guests g WHERE g.id = %s",
                    (guest_id,))
        return cur.fetchone()


def create_inbound_call(sid: str, phone: str, *, guest_id: Optional[str], event_id: Optional[str],
                        guest_name: str, is_test: bool, test_context: Optional[Dict[str, Any]],
                        opening_clip: str, tone: str) -> Dict[str, Any]:
    """The row for a call back, already answered (in_progress): the keypad
    answer and Twilio's final status settle it like any other call."""
    with tx() as cur:
        cur.execute("""
            INSERT INTO voice_calls (phone, guest_id, event_id, guest_name, is_test, test_context, status,
                                     attempt, twilio_sid, opening_clip, tone, direction, answered_by)
            VALUES (%s, %s, %s, %s, %s, %s, 'in_progress', 1, %s, %s, %s, 'inbound', 'human')
            RETURNING *""",
                    (phone, guest_id, event_id, guest_name, is_test,
                     psycopg2.extras.Json(test_context) if test_context is not None else None,
                     sid, opening_clip, tone))
        return cur.fetchone()
