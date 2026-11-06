import os
import logging
from typing import Sequence, Tuple, Optional

import psycopg2
import psycopg2.extras
from tenacity import retry, stop_after_attempt, wait_exponential

from shared.domain.delivery import (MessageDeliveryStatus, ensure_messages_sent_schema,
                                    RETRY_LATER_CODES, RETRY_LATER_MAX)

logger = logging.getLogger(__name__)


def get_db_url() -> str:
    host = os.getenv("DB_HOST")
    port = os.getenv("DB_PORT")
    user = os.getenv("DB_USER")
    password = os.getenv("DB_PASSWORD")
    name = os.getenv("DB_NAME")
    return f"postgresql://{user}:{password}@{host}:{port}/{name}"


@retry(stop=stop_after_attempt(20), wait=wait_exponential(multiplier=1, min=1, max=30))
def connect() -> psycopg2.extensions.connection:
    logger.info("Connecting to Postgres...")
    conn = psycopg2.connect(get_db_url())
    conn.autocommit = True
    logger.info("Connected to Postgres")
    return conn


def is_alive(conn) -> bool:
    """Cheap liveness probe so a connection killed while idle is replaced
    before the next campaign instead of failing it."""
    if conn is None or conn.closed:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        return True
    except Exception:
        return False


# Campaign processing bookkeeping - also ensured by scheduler-service (whichever
# boots first). `status_reason` explains every terminal status this worker sets.
CAMPAIGN_PROCESSING_DDL = (
    "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status_reason TEXT",
    "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ",
    "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0",
)


def ensure_schema(conn: psycopg2.extensions.connection):
    """Ensure the per-message delivery table (schema owned by shared) and the
    campaign bookkeeping columns exist."""
    with conn.cursor() as cur:
        ensure_messages_sent_schema(cur)
        for stmt in CAMPAIGN_PROCESSING_DDL:
            try:
                cur.execute(stmt)
            except Exception as exc:  # pragma: no cover - table owned by core
                logger.warning("schema patch skipped: %s (%s)", stmt, exc)


def finish_campaign(conn, campaign_id: str, status: str, reason: Optional[str],
                    recipient_count: Optional[int] = None, only_if: Optional[Sequence[str]] = None) -> None:
    """Write a terminal (or hand-back) status WITH a reason. Every early exit of
    the worker goes through here so no campaign is ever left in 'processing'."""
    sets = ["status = %s", "status_reason = %s", "processing_started_at = NULL"]
    params: list = [status, (reason or None) and str(reason)[:500]]
    if recipient_count is not None:
        sets.append("recipient_count = %s")
        params.append(int(recipient_count))
    where = "id = %s"
    params.append(campaign_id)
    if only_if:
        where += " AND status = ANY(%s)"
        params.append(list(only_if))
    with conn.cursor() as cur:
        cur.execute(f"UPDATE campaigns SET {', '.join(sets)} WHERE {where}", params)


def fail_open_releases(conn, campaign_id: str) -> None:
    """Cancel a terminally-failed campaign's remaining planner batches."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE campaign_releases SET status='failed', updated_at=NOW() "
                "WHERE campaign_id=%s AND status IN ('pending', 'queued')",
                (campaign_id,),
            )
    except Exception:
        pass


def revert_release(conn, release_id: str) -> None:
    """Hand a release back to the scheduler (e.g. campaign paused / event inactive)."""
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE campaign_releases SET status='pending', updated_at=NOW() WHERE id=%s",
                        (release_id,))
    except Exception:
        pass


def guest_still_sendable(conn, guest_id: str) -> bool:
    """Re-check at send time: the guest may have opted out (or been deleted)
    after audience selection."""
    from shared.domain.optout import OPT_OUT_SQL_PREDICATE
    with conn.cursor() as cur:
        cur.execute(f"SELECT 1 FROM guests g WHERE g.id = %s AND {OPT_OUT_SQL_PREDICATE}", (guest_id,))
        return cur.fetchone() is not None


def campaign_has_messages(conn, campaign_id: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM messages_sent WHERE campaign_id=%s LIMIT 1", (campaign_id,))
        return cur.fetchone() is not None


def fetch_campaign_by_id(conn: psycopg2.extensions.connection, campaign_id: str) -> Optional[dict]:
    """Fetch campaign data by ID."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, event_id, name, template, template_key, stage_id, variant_id,
                   custom_message, header_image_url, channel, schedule_time, status,
                   recipient_count, audience, audience_filter, follow_up_after_hours,
                   follow_up_audience, campaign_type
            FROM campaigns
            WHERE id = %s
            """,
            (campaign_id,),
        )
        return cur.fetchone()


def fetch_event_by_id(conn: psycopg2.extensions.connection, event_id: str) -> Optional[dict]:
    """Fetch event data by ID."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, name, description, event_date, location, active, event_type,
                   subjects, public_slug, wa_image_url, gift, share_code, created_at, updated_at, inviters, owners, account_id
            FROM events
            WHERE id = %s
            """,
            (event_id,),
        )
        return cur.fetchone()


def fetch_wa_template(conn: psycopg2.extensions.connection, template_id: str) -> Optional[dict]:
    """Look up an event-scoped/custom template row so the catalog resolver can
    resolve a legacy UUID reference. Best-effort: None if the table/row is absent.

    A `custom__<key>` ref is an admin-authored Template Studio template: its
    `custom_templates` row is returned (resolver -> template_from_custom_row,
    which only delivers the Meta-approved live snapshot)."""
    if isinstance(template_id, str) and template_id.startswith("custom__"):
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT key, doc, meta_name, meta_id, meta_status, version, live, archived "
                    "FROM custom_templates WHERE key = %s",
                    (template_id[len("custom__"):],),
                )
                return cur.fetchone()
        except Exception:
            conn.rollback()
            return None
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, name, body, flow_stage, language, components,
                       event_type, visibility, lifecycle
                FROM wa_templates WHERE id = %s
                """,
                (template_id,),
            )
            return cur.fetchone()
    except Exception:
        conn.rollback()
        return None


def fetch_guests_for_event(conn: psycopg2.extensions.connection, event_id: str) -> Sequence[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                id,
                name,
                phone,
                email,
                status,
                guest_count,
                table_number
            FROM guests
            WHERE event_id = %s
            """,
            (event_id,),
        )
        return cur.fetchall()


def claim_message(conn: psycopg2.extensions.connection, campaign_id: str, guest_id: str) -> bool:
    """Atomically claim a (campaign, guest) send. True if THIS caller won.

    Replaces the old `was_message_sent` check followed by a post-publish
    `mark_message_sent`. That sequence was check-then-act: a crash between the
    publish and the mark re-sent the guest on restart, and two workers (or two
    releases of one campaign) could both pass the check and both send. The
    INSERT is the claim, so the database decides the winner - and because the
    claim precedes the publish, a crash can only ever under-send, never
    double-send a guest.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO messages_sent (campaign_id, guest_id, status)
            VALUES (%s, %s, %s)
            ON CONFLICT (campaign_id, guest_id) DO NOTHING
            RETURNING 1
            """,
            (campaign_id, guest_id, MessageDeliveryStatus.QUEUED.value),
        )
        return cur.fetchone() is not None


def fetch_replacement_ref(conn, template_key: str, event_type: Optional[str]) -> Optional[str]:
    """`custom__<key>` of the Meta-approved Studio copy that replaces this
    catalog template (core app/template_placement.py), for this event type."""
    if not template_key or template_key.startswith("custom__"):
        return None
    fam = template_key.split("__", 1)[0]
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT key, live->'doc'->'event_types' FROM custom_templates
                WHERE NOT archived AND live->>'status' = 'approved'
                  AND live->'doc'->>'replaces' = %s
                ORDER BY updated_at DESC
                """, (fam,))
            for key, ets in cur.fetchall():
                if not ets or (event_type or "").lower() in ets:
                    return f"custom__{key}"
    except Exception:
        return None
    return None


def claim_retry(conn: psycopg2.extensions.connection, campaign_id: str, guest_id: str) -> bool:
    """Re-open a retry-later failure for one more send (True if THIS caller won).

    Resets the row to QUEUED with no wamid, so outpost's send claim treats it as
    a fresh message. Atomic, and bounded by retry_count, so a duplicate retry
    request can never send twice."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE messages_sent
            SET status = %s, wa_message_id = NULL, error_code = NULL, error_detail = NULL,
                send_claimed_at = NULL, send_reclaimed = false,
                retry_count = retry_count + 1, sent_at = NOW(), updated_at = NOW()
            WHERE campaign_id = %s AND guest_id = %s
              AND status = %s AND error_code = ANY(%s) AND retry_count < %s
            RETURNING 1
            """,
            (MessageDeliveryStatus.QUEUED.value, campaign_id, guest_id,
             MessageDeliveryStatus.FAILED.value, list(RETRY_LATER_CODES), RETRY_LATER_MAX),
        )
        return cur.fetchone() is not None


def release_message_claim(conn: psycopg2.extensions.connection, campaign_id: str, guest_id: str) -> None:
    """Undo a claim whose publish failed, so the guest can be retried.

    Only removes rows still QUEUED - never one Meta has already acted on.
    """
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM messages_sent WHERE campaign_id=%s AND guest_id=%s AND status=%s",
            (campaign_id, guest_id, MessageDeliveryStatus.QUEUED.value),
        )


def mark_message_failed(conn: psycopg2.extensions.connection, campaign_id: str, guest_id: str,
                        error_code: str, error_detail: str) -> None:
    """Record a send that failed before it ever reached Meta (e.g. build error).

    Kept as a FAILED row rather than deleted, so the owner can see that this
    guest was not reached instead of the failure vanishing into the logs.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO messages_sent (campaign_id, guest_id, status, error_code, error_detail)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (campaign_id, guest_id) DO UPDATE
            SET status = EXCLUDED.status, error_code = EXCLUDED.error_code,
                error_detail = EXCLUDED.error_detail, updated_at = NOW()
            WHERE messages_sent.status = %s
            """,
            (campaign_id, guest_id, MessageDeliveryStatus.FAILED.value,
             str(error_code)[:100], str(error_detail)[:500],
             MessageDeliveryStatus.QUEUED.value),
        )


def campaign_delivery_counts(conn: psycopg2.extensions.connection, campaign_id: str) -> dict:
    """Per-status message counts for a campaign - the basis of honest stats."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT status, COUNT(*) FROM messages_sent WHERE campaign_id=%s GROUP BY status",
            (campaign_id,),
        )
        return {row[0]: int(row[1]) for row in cur.fetchall()}


def mark_campaign_completed(
    conn: psycopg2.extensions.connection,
    campaign_id: str,
    queued_count: int,
) -> None:
    """Mark a campaign as SENDING once its messages are queued.

    Deliberately not 'sent': at this point outpost has not yet called Meta, so
    nothing is known to have been delivered. `finalize_campaigns` promotes the
    campaign to 'sent' (or 'failed') once no messages remain in flight, which is
    what makes the status reflect Meta's answer rather than our own enqueue.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE campaigns
            SET status = 'sending',
                recipient_count = %s
            WHERE id = %s
            """,
            (queued_count, campaign_id),
        )


def record_message_usage(conn, account_id, event_id: str, quantity: int, ref_id: Optional[str] = None) -> None:
    """Meter messages sent for a campaign (Phase 10). Internal cost metric only.
    Safe no-op if the table is absent (older deployments)."""
    import uuid as _uuid
    if not quantity:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO usage_events (id, account_id, event_id, metric, quantity, ref_id)
                VALUES (%s, %s, %s, 'message_sent', %s, %s)
                """,
                (str(_uuid.uuid4()), account_id, event_id, quantity, ref_id),
            )
    except Exception:
        # Metering must never break sending.
        pass


def create_follow_up_campaign(conn, parent: dict, hours: int, audience: str,
                              recipient_count: int = 0) -> Optional[str]:
    """Create ONE follow-up round (no sequence engine): a new pending campaign
    scheduled `hours` from now, targeting `audience`, reusing the parent's
    message - template AND custom_message / header image / stage + variant, so
    the follow-up is the same message (previously a custom-text or image round
    followed up with the bare template). `recipient_count` is the current audience
    size so the planner sizes it. Follow-up fields are left NULL to prevent
    chaining. Idempotent on (event, name).
    Returns the new campaign id, or None if a matching pending follow-up exists.
    """
    import uuid as _uuid
    from datetime import datetime, timedelta, timezone

    follow_name = (parent.get("name") or "Round") + " (follow-up)"
    with conn.cursor() as cur:
        cur.execute(
            # Any status: a follow-up that already went out must not be re-created
            # when the parent is re-processed (stuck-sweeper re-run, redelivery).
            "SELECT 1 FROM campaigns WHERE event_id=%s AND name=%s LIMIT 1",
            (parent["event_id"], follow_name),
        )
        if cur.fetchone():
            return None  # already created (e.g. on reprocess)

        new_id = str(_uuid.uuid4())
        sched = datetime.now(timezone.utc) + timedelta(hours=int(hours))
        cur.execute(
            """
            INSERT INTO campaigns (id, event_id, name, template, template_key, stage_id, variant_id,
                                   custom_message, header_image_url, campaign_type,
                                   channel, schedule_time, status, recipient_count, audience)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending', %s, %s)
            """,
            (new_id, parent["event_id"], follow_name, parent["template"], parent.get("template_key"),
             parent.get("stage_id"), parent.get("variant_id"), parent.get("custom_message"),
             parent.get("header_image_url"), parent.get("campaign_type"),
             parent["channel"], sched, int(recipient_count or 0), audience),
        )
        return new_id


# --- Planner batch releases -------------------------------------------------
# The planner-service releases a campaign in per-day batches (`campaign_releases`).
# When a message carries a `release_id`, the worker sends only that batch's `count`
# and reports back here. The campaign is completed only when no batches remain.

def mark_release_sent(conn, release_id: str, sent_count: int) -> None:
    """Mark a single planner release row as sent (best-effort - the table only
    exists once the planner-service has run)."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE campaign_releases SET status='sent', count=%s, updated_at=NOW() WHERE id=%s",
                (sent_count, release_id),
            )
    except Exception:
        conn.rollback()


def campaign_has_open_releases(conn, campaign_id: str) -> bool:
    """True if the campaign still has un-sent planner batches (pending/queued).
    'failed' batches (swept by the scheduler) are not open."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM campaign_releases WHERE campaign_id=%s "
                "AND status NOT IN ('sent', 'failed') LIMIT 1",
                (campaign_id,),
            )
            return cur.fetchone() is not None
    except Exception:
        conn.rollback()
        return False


def release_is_final(conn, release_id: str) -> bool:
    """True when the planner marked this batch as the campaign's LAST one with
    nothing left unplaced - the worker then sends ALL remaining eligible guests
    (the planned count may be stale). False if the column/row is missing."""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT is_final FROM campaign_releases WHERE id = %s", (release_id,))
            row = cur.fetchone()
            return bool(row and row[0])
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return False


def park_campaign_no_guests(conn, campaign_id: str) -> None:
    """0-guest guard: an invitation / save-the-date that resolves to nobody is
    NOT a sent round (the owner most likely has not imported guests yet). Back
    to 'draft' (schedule_time kept) with status_reason='no_guests', and its
    planner batches removed so nothing re-fires until the owner re-schedules."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE campaigns SET status = 'draft', status_reason = 'no_guests', "
            "processing_started_at = NULL WHERE id = %s",
            (campaign_id,),
        )
        try:
            cur.execute(
                "DELETE FROM campaign_releases WHERE campaign_id = %s AND status IN ('pending', 'queued')",
                (campaign_id,),
            )
        except Exception:
            pass


def mark_campaign_status(conn, campaign_id: str, status: str) -> None:
    with conn.cursor() as cur:
        cur.execute("UPDATE campaigns SET status=%s WHERE id=%s", (status, campaign_id))




