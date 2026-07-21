import os
import logging
from typing import Sequence, Tuple, Optional

import psycopg2
import psycopg2.extras
from tenacity import retry, stop_after_attempt, wait_exponential

from shared.domain.delivery import MessageDeliveryStatus, ensure_messages_sent_schema

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


def ensure_schema(conn: psycopg2.extensions.connection):
    """Ensure the per-message delivery table exists (schema owned by shared)."""
    with conn.cursor() as cur:
        ensure_messages_sent_schema(cur)


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
                   subjects, public_slug, wa_image_url, created_at, updated_at, inviters, owners, account_id
            FROM events
            WHERE id = %s
            """,
            (event_id,),
        )
        return cur.fetchone()


def fetch_wa_template(conn: psycopg2.extensions.connection, template_id: str) -> Optional[dict]:
    """Look up an event-scoped/custom template row so the catalog resolver can
    resolve a legacy UUID reference. Best-effort: None if the table/row is absent."""
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


def create_follow_up_campaign(conn, parent: dict, hours: int, audience: str) -> Optional[str]:
    """Create ONE follow-up round (no sequence engine): a new pending campaign
    scheduled `hours` from now, targeting `audience`, reusing the parent's template.
    follow-up fields are left NULL to prevent chaining. Idempotent on (event, name).
    Returns the new campaign id, or None if a matching pending follow-up exists.
    """
    import uuid as _uuid
    from datetime import datetime, timedelta, timezone

    follow_name = (parent.get("name") or "Round") + " (follow-up)"
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM campaigns WHERE event_id=%s AND name=%s AND status='pending' LIMIT 1",
            (parent["event_id"], follow_name),
        )
        if cur.fetchone():
            return None  # already created (e.g. on reprocess)

        new_id = str(_uuid.uuid4())
        sched = datetime.now(timezone.utc) + timedelta(hours=int(hours))
        cur.execute(
            """
            INSERT INTO campaigns (id, event_id, name, template, channel, schedule_time, status, recipient_count, audience)
            VALUES (%s, %s, %s, %s, %s, %s, 'pending', 0, %s)
            """,
            (new_id, parent["event_id"], follow_name, parent["template"], parent["channel"], sched, audience),
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
    """True if the campaign still has un-sent planner batches (pending/queued)."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM campaign_releases WHERE campaign_id=%s AND status <> 'sent' LIMIT 1",
                (campaign_id,),
            )
            return cur.fetchone() is not None
    except Exception:
        conn.rollback()
        return False


def mark_campaign_status(conn, campaign_id: str, status: str) -> None:
    with conn.cursor() as cur:
        cur.execute("UPDATE campaigns SET status=%s WHERE id=%s", (status, campaign_id))




