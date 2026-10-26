import os
import time
import logging
from contextlib import contextmanager
from typing import Iterator, Optional, Sequence, Tuple

import psycopg2
import psycopg2.extras
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


def get_db_url() -> str:
    host = os.getenv("DB_HOST")
    port = os.getenv("DB_PORT")
    user = os.getenv("DB_USER")
    password = os.getenv("DB_PASSWORD")
    name = os.getenv("DB_NAME")
    return f"postgresql://{user}:{password}@{host}:{port}/{name}"


@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, min=1, max=30))
def connect() -> psycopg2.extensions.connection:
    logger.info("Connecting to Postgres...")
    conn = psycopg2.connect(get_db_url())
    conn.autocommit = True
    logger.info("Connected to Postgres")
    
    # Ensure required tables exist
    ensure_tables(conn)
    
    return conn


def ensure_tables(conn: psycopg2.extensions.connection):
    """Ensure required tables exist for scheduler operations."""
    with conn.cursor() as cur:
        # Create campaigns table if it doesn't exist
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS campaigns (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                event_id UUID NOT NULL,
                name VARCHAR(100) NOT NULL,
                template TEXT NOT NULL,
                channel VARCHAR(20) NOT NULL,
                schedule_time TIMESTAMP,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
            """
        )
        
        # Create events table if it doesn't exist (needed for foreign key)
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                owners JSON DEFAULT '[]',
                inviters JSON DEFAULT '[]',
                name VARCHAR(100) NOT NULL,
                description TEXT,
                event_date TIMESTAMP,
                location VARCHAR(200),
                active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
            """
        )
        
        # Create guests table if it doesn't exist (needed for foreign key)
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS guests (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                event_id UUID NOT NULL,
                name VARCHAR(100) NOT NULL,
                phone VARCHAR(20) NOT NULL,
                email VARCHAR(100),
                status VARCHAR(20) DEFAULT 'invited',
                import_count INTEGER NOT NULL DEFAULT 1 CHECK (import_count >= 1),
                guest_count INTEGER CHECK (guest_count >= 1),
                table_number INTEGER CHECK (table_number >= 1 AND table_number <= 128),
                notes TEXT,
                last_response TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                guest_group VARCHAR(100)
            );
            """
        )
        cur.execute("ALTER TABLE guests ALTER COLUMN guest_count DROP DEFAULT")
        cur.execute("ALTER TABLE guests ALTER COLUMN guest_count DROP NOT NULL")
        cur.execute(
            """
            ALTER TABLE guests
            ADD COLUMN IF NOT EXISTS import_count INTEGER NOT NULL DEFAULT 1 CHECK (import_count >= 1)
            """
        )
        cur.execute(
            """
            ALTER TABLE guests
            ADD COLUMN IF NOT EXISTS guest_group VARCHAR(100)
            """
        )
        
        # Create messages_sent table if it doesn't exist
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS messages_sent (
                campaign_id UUID NOT NULL,
                guest_id UUID NOT NULL,
                sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (campaign_id, guest_id)
            );
            """
        )

        # Planner batch releases. Owned by planner-service, but ensured here too so
        # the scheduler's release query is always valid regardless of boot order.
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS campaign_releases (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                campaign_id UUID NOT NULL,
                event_id UUID NOT NULL,
                channel VARCHAR(20) NOT NULL,
                release_date DATE NOT NULL,
                target_date DATE,
                count INTEGER NOT NULL DEFAULT 0,
                moved BOOLEAN NOT NULL DEFAULT false,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_releases_due ON campaign_releases (status, release_date)")
        # Release instant (campaign's local send time on release_date, written by
        # the planner) + a bounded re-publish counter for the stuck-release sweeper.
        cur.execute("ALTER TABLE campaign_releases ADD COLUMN IF NOT EXISTS release_at TIMESTAMPTZ")
        cur.execute("ALTER TABLE campaign_releases ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0")
        # Last batch of a fully-placed campaign: the worker sends ALL remaining
        # eligible guests on it. Owned by planner-service; ensured here too.
        cur.execute("ALTER TABLE campaign_releases ADD COLUMN IF NOT EXISTS is_final BOOLEAN NOT NULL DEFAULT false")
        # Rolling-24h capacity guard scans messages_sent by time.
        cur.execute("CREATE INDEX IF NOT EXISTS ix_messages_sent_sent_at ON messages_sent (sent_at)")

        # Campaign processing bookkeeping (stuck-'processing' sweeper + a reason
        # for every terminal status campaign-worker writes). Also ensured by
        # campaign-worker so boot order does not matter.
        for stmt in CAMPAIGN_PROCESSING_DDL:
            cur.execute(stmt)

        logger.info("Ensured required tables exist")


CAMPAIGN_PROCESSING_DDL = (
    # Planner-owned; the release guard orders by it, so ensure it here too.
    "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS priority INTEGER",
    "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status_reason TEXT",
    "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ",
    "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0",
)

# Local wall-clock zone campaign send times are expressed in.
SEND_TZ = os.getenv("SEND_WINDOW_TZ", "Asia/Jerusalem")


def fetch_and_mark_due(conn: psycopg2.extensions.connection) -> Sequence[Tuple]:
    """Atomically claim due campaigns by setting status=processing and return them.
    Only processes campaigns for events where active = true.
    schedule_time must be stored in UTC (TIMESTAMPTZ); NOW() is compared in UTC.

    Legacy path: only for campaigns the planner is NOT managing (no release rows)
    AND not on a capacity-limited channel. WhatsApp campaigns are NEVER sent here:
    this path sends the whole audience at once with no daily-capacity check, so a
    due whatsapp campaign without releases simply waits for the planner (which
    plans it within seconds - fast path in planner-service/main.py)."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            UPDATE campaigns
            SET status = 'processing', processing_started_at = NOW()
            WHERE id IN (
              SELECT c.id FROM campaigns c
              INNER JOIN events e ON c.event_id = e.id
              WHERE c.status = 'pending'
                AND c.schedule_time IS NOT NULL
                AND c.schedule_time <= NOW()
                AND e.active = true
                AND lower(trim(COALESCE(c.channel, ''))) <> ALL(%s)
                AND NOT EXISTS (
                      SELECT 1 FROM campaign_releases r WHERE r.campaign_id = c.id
                )
              FOR UPDATE SKIP LOCKED
            )
            RETURNING id, event_id, name, template, channel, schedule_time, status
            """,
            (list(CAPACITY_LIMITED_CHANNELS),),
        )
        rows = cur.fetchall()
    return rows


# --- Rolling 24h Meta capacity guard ----------------------------------------
# Channels whose sends are capacity-planned (no legacy unlimited path, rolling
# 24h guard at release). Empty/'' channel is treated as whatsapp (the default).
CAPACITY_LIMITED_CHANNELS = ("whatsapp", "")
# When over capacity the release is pushed this far forward (the planner also
# re-plans on its next cycle using the same rolling figure).
CAPACITY_DEFER_MINUTES = int(os.getenv("SCHEDULER_CAPACITY_DEFER_MINUTES", "30"))
_GUARD_LOCK_KEY = 74_202_611  # pg advisory lock: one release-guard decision at a time

# Business-initiated WhatsApp conversations Meta counts = distinct recipients
# of campaign messages in the last 24h; messages that never reached Meta do not
# count. Kept in sync with planner-service/runtime.py ROLLING_24H_SQL.
ROLLING_24H_SQL = """
    SELECT COUNT(DISTINCT m.guest_id)
    FROM messages_sent m
    JOIN campaigns c ON c.id = m.campaign_id
    WHERE m.sent_at > NOW() - INTERVAL '24 hours'
      AND lower(trim(c.channel)) = 'whatsapp'
      AND NOT (m.status = 'failed' AND COALESCE(m.error_code, '') IN ('invalid_phone', 'build_failed'))
"""


def rolling_capacity(cur) -> int:
    """Max business-initiated recipients per rolling 24h we allow ourselves.

    The planner stores the effective number (min(env cap, Meta tier) minus its
    safety margin) in planner_state; fall back to the same env computation
    (META_NEW_CONVERSATIONS_PER_24H=1000, PLANNER_SAFETY_MARGIN_PERCENT=15)."""
    try:
        cur.execute("SAVEPOINT cap_state")
        cur.execute("SELECT planner_capacity FROM planner_state WHERE id = 1")
        row = cur.fetchone()
        cur.execute("RELEASE SAVEPOINT cap_state")
        if row is not None:
            val = row[0] if not isinstance(row, dict) else row.get("planner_capacity")
            if val:
                return int(val)
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT cap_state")
    try:
        raw = int(float(os.getenv("META_NEW_CONVERSATIONS_PER_24H", "1000") or 1000))
        margin = float(os.getenv("PLANNER_SAFETY_MARGIN_PERCENT", "15") or 15)
    except ValueError:
        raw, margin = 1000, 15.0
    return int(raw * (1.0 - max(0.0, min(100.0, margin)) / 100.0))


def rolling_used(cur) -> int:
    """Recipients in the last 24h + batches already claimed but not executed."""
    cur.execute(ROLLING_24H_SQL)
    row = cur.fetchone()
    used = int((row[0] if not isinstance(row, dict) else list(row.values())[0]) or 0)
    cur.execute("SELECT COALESCE(SUM(count), 0) FROM campaign_releases "
                "WHERE status = 'queued' AND lower(trim(channel)) = 'whatsapp'")
    row = cur.fetchone()
    return used + int((row[0] if not isinstance(row, dict) else list(row.values())[0]) or 0)


def fetch_and_mark_due_releases(conn: psycopg2.extensions.connection,
                                deferred_out: Optional[list] = None) -> Sequence[Tuple]:
    """Atomically claim planner releases whose release INSTANT has arrived
    (status=queued) and return them for publishing. The planner decided the day +
    batch size; the scheduler only transports. Skips inactive events.

    * Timing: `release_at` = release_date at the campaign's local (Israel)
      time-of-day, written by the planner. Rows planned before that column
      existed fall back to the same computation in SQL.
    * The campaign must still be 'pending': a paused/failed/cancelled campaign
      never has another batch released (review 4.7b).
    * ROLLING 24h GUARD (whatsapp): distinct recipients messaged in the last 24h
      + in-flight batches + this batch must stay <= the capacity. Batches that
      would exceed it are DEFERRED (release_at pushed forward) instead of sent;
      the planner re-plans them from the same rolling figure. Due batches are
      considered in priority order (priority, sooner event, older campaign).
      `deferred_out`, when given, receives the deferred rows (for logging)."""
    prev_autocommit = conn.autocommit
    conn.autocommit = False
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Serialise guard decisions (multiple scheduler instances).
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (_GUARD_LOCK_KEY,))
            cur.execute(
                """
                SELECT r2.id, r2.count, lower(trim(COALESCE(r2.channel, ''))) AS channel
                FROM campaign_releases r2
                INNER JOIN campaigns c2 ON r2.campaign_id = c2.id
                INNER JOIN events e2 ON c2.event_id = e2.id
                WHERE r2.status = 'pending'
                  AND c2.status = 'pending'
                  AND COALESCE(
                        r2.release_at,
                        (r2.release_date + COALESCE((c2.schedule_time AT TIME ZONE %(tz)s)::time,
                                                    TIME '09:00')) AT TIME ZONE %(tz)s
                      ) <= NOW()
                  AND r2.count > 0
                  AND e2.active = true
                ORDER BY COALESCE(c2.priority, 0) DESC, e2.event_date ASC NULLS LAST,
                         c2.created_at ASC NULLS LAST, r2.release_date ASC, r2.id
                FOR UPDATE OF r2 SKIP LOCKED
                """,
                {"tz": SEND_TZ},
            )
            candidates = cur.fetchall()
            claim_ids, defer_ids = [], []
            if candidates:
                capacity = None
                used = 0
                for c in candidates:
                    if c["channel"] not in CAPACITY_LIMITED_CHANNELS:
                        claim_ids.append(c["id"])
                        continue
                    if capacity is None:
                        capacity = rolling_capacity(cur)
                        used = rolling_used(cur)
                    n = int(c["count"] or 0)
                    # A batch larger than the whole capacity (should not happen -
                    # the planner caps per day) may go only into an empty window,
                    # never stall forever.
                    if used + n <= capacity or (used == 0 and n > capacity):
                        claim_ids.append(c["id"])
                        used += n
                    else:
                        defer_ids.append(c["id"])
            rows = []
            if defer_ids:
                cur.execute(
                    """
                    UPDATE campaign_releases
                    SET release_at = NOW() + make_interval(mins => %s), updated_at = NOW()
                    WHERE id = ANY(%s::uuid[])
                    RETURNING id, campaign_id, count
                    """,
                    (CAPACITY_DEFER_MINUTES, defer_ids),
                )
                deferred = cur.fetchall()
                if deferred_out is not None:
                    deferred_out.extend(deferred)
            if claim_ids:
                cur.execute(
                    """
                    UPDATE campaign_releases r
                    SET status = 'queued', updated_at = NOW()
                    FROM campaigns c
                    WHERE r.campaign_id = c.id AND r.id = ANY(%s::uuid[])
                    RETURNING r.id AS release_id, r.count, r.campaign_id, r.event_id,
                              c.name, c.template, c.channel, r.release_date, r.release_at,
                              r.is_final
                    """,
                    (claim_ids,),
                )
                rows = cur.fetchall()
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.autocommit = prev_autocommit
    return rows


def revert_to_pending(conn: psycopg2.extensions.connection, campaign_id: str):
    with conn.cursor() as cur:
        cur.execute("UPDATE campaigns SET status='pending' WHERE id=%s", (campaign_id,))


def revert_release_to_pending(conn: psycopg2.extensions.connection, release_id: str):
    with conn.cursor() as cur:
        cur.execute("UPDATE campaign_releases SET status='pending' WHERE id=%s", (release_id,))




# --- Stuck work sweepers ------------------------------------------------------
STUCK_PROCESSING_MINUTES = int(os.getenv("CAMPAIGN_STUCK_PROCESSING_MINUTES", "30"))
STUCK_PROCESSING_MAX_RETRIES = int(os.getenv("CAMPAIGN_STUCK_PROCESSING_MAX_RETRIES", "1"))


def sweep_stuck_processing(conn: psycopg2.extensions.connection) -> dict:
    """Campaigns left in 'processing' (worker crashed / message lost) go back to
    'pending' once - claims in messages_sent make the re-run idempotent - and
    are failed with a reason after that. Same for planner releases stuck in
    'queued'."""
    out = {"requeued": 0, "failed": 0, "releases_requeued": 0, "releases_failed": 0}
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE campaigns
            SET status = CASE WHEN processing_attempts < %(max)s THEN 'pending' ELSE 'failed' END,
                status_reason = CASE WHEN processing_attempts < %(max)s
                                     THEN 'requeued: stuck in processing'
                                     ELSE 'stuck in processing (worker never finished)' END,
                processing_attempts = processing_attempts + 1,
                processing_started_at = NULL
            WHERE status = 'processing'
              AND COALESCE(processing_started_at, updated_at, created_at)
                  < NOW() - make_interval(mins => %(mins)s)
            RETURNING status
            """,
            {"max": STUCK_PROCESSING_MAX_RETRIES, "mins": STUCK_PROCESSING_MINUTES},
        )
        for (status,) in cur.fetchall():
            out["requeued" if status == "pending" else "failed"] += 1

        cur.execute(
            """
            UPDATE campaign_releases
            SET status = CASE WHEN attempts < %(max)s THEN 'pending' ELSE 'failed' END,
                attempts = attempts + 1,
                updated_at = NOW()
            WHERE status = 'queued'
              AND updated_at < NOW() - make_interval(mins => %(mins)s)
            RETURNING status, campaign_id
            """,
            {"max": STUCK_PROCESSING_MAX_RETRIES, "mins": STUCK_PROCESSING_MINUTES},
        )
        failed_campaigns = set()
        for status, cid in cur.fetchall():
            if status == "pending":
                out["releases_requeued"] += 1
            else:
                out["releases_failed"] += 1
                failed_campaigns.add(str(cid))
        if failed_campaigns:
            # The batch was never executed; surface it on the campaign instead of
            # leaving it open forever.
            cur.execute(
                """
                UPDATE campaigns c
                SET status_reason = 'a planner release never completed',
                    status = CASE
                        WHEN c.status <> 'pending' THEN c.status
                        WHEN EXISTS (SELECT 1 FROM campaign_releases r
                                     WHERE r.campaign_id = c.id AND r.status IN ('pending', 'queued'))
                            THEN c.status
                        WHEN EXISTS (SELECT 1 FROM messages_sent m WHERE m.campaign_id = c.id)
                            THEN 'sending'          -- finalizer resolves sent/failed
                        ELSE 'failed' END
                WHERE c.id = ANY(%s::uuid[])
                """,
                (list(failed_campaigns),),
            )
    return out
