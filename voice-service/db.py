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
from typing import Any, Dict, Iterator, List, Optional

import psycopg2
import psycopg2.extras
import psycopg2.pool

from shared.domain import voice_calls as vc
from shared.domain.enums import GuestStatus
from shared.domain.flow_graph import RSVP_DB_VALUE
from shared.domain.optout import OPT_OUT_SQL_PREDICATE

_pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None


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
    # Same "no response yet" rule as the WhatsApp reminders (campaign-worker
    # audience.py NO_RESPONSE): pending status, a phone, not opted out, and not
    # tagged no_reminders by the conversation flow.
    return f"""
        SELECT g.id, g.name, g.phone FROM guests g
        WHERE g.event_id = %s AND g.phone IS NOT NULL AND g.phone <> ''
          AND {OPT_OUT_SQL_PREDICATE}
          AND g.status = ANY(%s)
          AND NOT EXISTS (SELECT 1 FROM guest_tags gtn JOIN tags tn ON tn.id = gtn.tag_id
                          WHERE gtn.guest_id = g.id AND tn.name = 'no_reminders')
        ORDER BY g.name
    """


def pending_guests(event_id: str) -> List[Dict[str, Any]]:
    with tx() as cur:
        cur.execute(_pending_guests_sql(), (event_id, list(GuestStatus.pending_values())))
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
                        (rnd["id"], event_id, g["id"], phone, g.get("name"), start_at))
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


def list_rounds(event_id: str) -> List[Dict[str, Any]]:
    with tx() as cur:
        cur.execute("""
            SELECT r.id, r.status, r.start_at, r.total, r.created_at, r.finished_at,
                   count(c.*) FILTER (WHERE c.result = 'confirmed') AS confirmed,
                   count(c.*) FILTER (WHERE c.result = 'declined') AS declined,
                   count(c.*) FILTER (WHERE c.result = 'maybe') AS maybe,
                   count(c.*) FILTER (WHERE c.status = 'done' AND c.result NOT IN ('confirmed','declined','maybe')) AS unreached,
                   count(c.*) FILTER (WHERE c.status IN ('queued','preparing','dialing','in_progress')) AS pending,
                   coalesce(sum(c.attempt), 0) AS attempts,
                   coalesce(sum(c.duration_sec), 0) AS seconds,
                   coalesce(sum(c.price), 0) AS price
            FROM voice_rounds r LEFT JOIN voice_calls c ON c.round_id = r.id
            WHERE r.event_id = %s GROUP BY r.id ORDER BY r.created_at DESC""", (event_id,))
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

def start_due_rounds() -> int:
    with tx() as cur:
        cur.execute("UPDATE voice_rounds SET status = 'running' WHERE status = 'scheduled' AND start_at <= now()")
        return cur.rowcount


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
                    (guest_id, list(GuestStatus.pending_values())))
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
        cur.execute("UPDATE voice_calls SET status = 'in_progress', answered_by = %s, updated_at = now() "
                    "WHERE id = %s AND status IN ('dialing', 'in_progress')", (answered_by, call_id))


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
                 and c["attempt"] < max_attempts and not c["is_test"])
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
