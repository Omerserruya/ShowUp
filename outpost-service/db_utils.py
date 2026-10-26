"""
Database utilities for outpost-service.

Handles conversation management, message logging and per-message delivery
outcomes. All methods are SYNCHRONOUS (psycopg2) and are meant to be called off
the event loop - the consumer runs them on a dedicated thread pool sized to the
connection pool (see `ConversationDB.executor`). Connections come from a
ThreadedConnectionPool instead of one shared connection, so concurrent sends do
not serialize on (or corrupt) a single psycopg2 connection.
"""

import os
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from typing import Optional

import psycopg2
from psycopg2.pool import ThreadedConnectionPool

from utils.phone import normalize_phone, mask_phone

logger = logging.getLogger("db_utils")

# Delivery-status vocabulary is shared with campaign-worker so the two ends of
# the pipeline can never disagree about what a status means.
from shared.domain.delivery import MessageDeliveryStatus

# A claimed-but-unresolved send older than this is considered abandoned by a
# crashed outpost and may be retried ONCE (see claim_send).
STALE_CLAIM_MINUTES = int(os.getenv("OUTPOST_STALE_CLAIM_MINUTES", "10"))

# Send-claim columns. Deliberately NOT a new `status` value: the status ladder
# (shared/domain/delivery.py) and every stats / reply-attribution query treat
# anything other than 'queued' as "handed to Meta" (e.g. REPLY_BY_RECENCY_SQL
# uses status <> 'queued'), so a 'sending' status would be miscounted. A claim
# column is invisible to all existing readers.
ENSURE_SEND_CLAIM_DDL = (
    "ALTER TABLE messages_sent ADD COLUMN IF NOT EXISTS send_claimed_at timestamptz",
    "ALTER TABLE messages_sent ADD COLUMN IF NOT EXISTS send_attempts INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE messages_sent ADD COLUMN IF NOT EXISTS send_reclaimed BOOLEAN NOT NULL DEFAULT false",
)

# claim_send outcomes
CLAIM_OK = "claimed"          # we own the send - call Meta
CLAIM_DONE = "done"           # already resolved (accepted/failed/...) - ack, do nothing
CLAIM_BUSY = "busy"           # another worker is mid-send (fresh claim) - check later
CLAIM_UNCERTAIN = "uncertain" # stale claim already retried once - do not resend blindly
CLAIM_MISSING = "missing"     # no messages_sent row (legacy message) - send unguarded

# Rows a late Meta answer may still resolve: queued, or swept by the finalizer
# because it sat queued too long (the message was still in the RabbitMQ backlog).
_RESOLVABLE_SQL = (
    "(status = 'queued' OR (status = 'failed' AND error_code = 'queued_timeout'))"
)


class ConversationDB:
    """Conversations, messages_log and messages_sent access for outpost."""

    def __init__(self):
        self.logger = logging.getLogger("db_utils.ConversationDB")
        self.db_url = None
        self._pool: Optional[ThreadedConnectionPool] = None
        self.pool_size = max(2, int(os.getenv("OUTPOST_DB_POOL_SIZE", "8")))
        # Exactly as many DB threads as pooled connections: a thread never waits
        # for a connection, and the event loop never blocks on psycopg2.
        self.executor = ThreadPoolExecutor(max_workers=self.pool_size, thread_name_prefix="outpost-db")

        enable_db_logging = (os.getenv('OUTPOST_ENABLE_DB_LOGGING', 'false').lower() == 'true')
        if enable_db_logging:
            db_user = os.getenv('DB_USER')
            db_password = os.getenv('DB_PASSWORD')
            db_host = os.getenv('DB_HOST')
            db_port = os.getenv('DB_PORT')
            db_name = os.getenv('DB_NAME')
            if all([db_user, db_password, db_host, db_port, db_name]):
                self.db_url = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
                self.logger.info("DB logging enabled", extra={"db_host": db_host, "db_name": db_name,
                                                             "pool_size": self.pool_size})
            else:
                missing = [k for k, v in {'DB_USER': db_user, 'DB_PASSWORD': db_password, 'DB_HOST': db_host,
                                          'DB_PORT': db_port, 'DB_NAME': db_name}.items() if not v]
                self.logger.warning(f"DB logging disabled: missing DB_* envs: {missing}")
        else:
            self.logger.info("DB logging disabled: OUTPOST_ENABLE_DB_LOGGING is not 'true'")

    @property
    def enabled(self) -> bool:
        return bool(self.db_url)

    # ------------------------------------------------------------------ pool
    def _get_pool(self) -> Optional[ThreadedConnectionPool]:
        if not self.db_url:
            return None
        if self._pool is None or self._pool.closed:
            # Lazy: Postgres may not be ready at boot. minconn=1 so we hold one
            # warm connection; the rest open on demand.
            self._pool = ThreadedConnectionPool(1, self.pool_size, self.db_url)
            self.logger.info("Postgres connection pool ready")
        return self._pool

    @contextmanager
    def _conn(self):
        """Borrow a pooled autocommit connection. A broken connection is discarded
        (not returned to the pool) so the next borrower gets a fresh one."""
        pool = self._get_pool()
        if pool is None:
            raise RuntimeError("database disabled")
        conn = pool.getconn()
        broken = False
        try:
            if conn.closed:
                broken = True
                raise psycopg2.InterfaceError("pooled connection closed")
            conn.autocommit = True
            yield conn
        except (psycopg2.OperationalError, psycopg2.InterfaceError):
            broken = True
            raise
        finally:
            try:
                pool.putconn(conn, close=broken)
            except Exception:
                pass

    def _run(self, fn, default=None, retries: int = 2):
        """Run fn(conn) with one reconnect-retry on connection-level errors."""
        if not self.db_url:
            return default
        last = None
        for _ in range(retries):
            try:
                with self._conn() as conn:
                    return fn(conn)
            except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
                last = e
                continue
        if last:
            raise last
        return default

    def ensure_schema(self) -> bool:
        """Idempotent DDL for the send-claim columns. Safe on every boot."""
        if not self.db_url:
            return False

        def _do(conn):
            with conn.cursor() as cur:
                for stmt in ENSURE_SEND_CLAIM_DDL:
                    cur.execute(stmt)
            return True
        try:
            return self._run(_do, default=False)
        except Exception as e:
            self.logger.error(f"Failed ensuring outpost schema: {e}")
            return False

    # ---------------------------------------------------------- conversations
    def ensure_or_get_conversation(
        self,
        event_id: Optional[str],
        guest_phone: Optional[str],
        guest_id: Optional[str] = None,
        initial_state: str = "rsvp_invite"
    ) -> Optional[str]:
        """Ensure a Conversation exists for (guest_phone, event_id); return its id.

        Supports multiple conversations per phone (one per event). The phone is
        normalized to digits-only so lookups match webhook-worker's.
        """
        if not self.db_url or not event_id or not guest_phone:
            return None
        normalized_guest_phone = normalize_phone(guest_phone)
        if not normalized_guest_phone:
            return None
        try:
            uuid.UUID(str(event_id))
        except (ValueError, AttributeError):
            return None

        lookup_sql = """
            SELECT id FROM conversations
            WHERE guest_phone = %s AND event_id = %s AND active = true
            LIMIT 1
        """

        def _do(conn):
            with conn.cursor() as cur:
                cur.execute(lookup_sql, (normalized_guest_phone, event_id))
                row = cur.fetchone()
                if row:
                    return str(row[0])
                conversation_id = str(uuid.uuid4())
                try:
                    if guest_id:
                        cur.execute(
                            """
                            INSERT INTO conversations (id, guest_id, guest_phone, event_id, current_state, active)
                            VALUES (%s::uuid, %s::uuid, %s, %s, %s, true)
                            RETURNING id
                            """,
                            (conversation_id, guest_id, normalized_guest_phone, event_id, initial_state),
                        )
                    else:
                        cur.execute(
                            """
                            INSERT INTO conversations (id, guest_phone, event_id, current_state, active)
                            VALUES (%s::uuid, %s, %s, %s, true)
                            RETURNING id
                            """,
                            (conversation_id, normalized_guest_phone, event_id, initial_state),
                        )
                    row = cur.fetchone()
                    return str(row[0]) if row else None
                except psycopg2.IntegrityError:
                    # Race: another sender created it first.
                    cur.execute(lookup_sql, (normalized_guest_phone, event_id))
                    row = cur.fetchone()
                    return str(row[0]) if row else None

        try:
            return self._run(_do)
        except Exception as e:
            self.logger.warning(f"Failed to ensure/get conversation: {e}",
                                extra={"event_id": event_id, "guest_phone": mask_phone(guest_phone)})
            return None

    def get_conversation_state(self, conversation_id: str) -> Optional[str]:
        if not conversation_id:
            return None

        def _do(conn):
            with conn.cursor() as cur:
                cur.execute("SELECT current_state FROM conversations WHERE id = %s::uuid LIMIT 1",
                            (conversation_id,))
                row = cur.fetchone()
                return row[0] if row else None
        try:
            return self._run(_do)
        except Exception as e:
            self.logger.warning(f"Failed to get conversation state: {e}")
            return None

    # ------------------------------------------------------- idempotent send
    def claim_send(self, campaign_id: Optional[str], guest_id: Optional[str],
                   max_attempts: int = 5) -> str:
        """Atomically claim the right to call Meta for a campaign message.

        The claim is `send_claimed_at` (see ENSURE_SEND_CLAIM_DDL for why not a
        status). Rules:
          * resolvable row (queued / queued_timeout), no wamid, no claim -> CLAIM_OK
          * a claim older than STALE_CLAIM_MINUTES with no wamid means an outpost
            crashed mid-send. It is retried ONCE (send_reclaimed) -> CLAIM_OK;
            a second stale claim -> CLAIM_UNCERTAIN (never resend blindly).
          * fresh claim -> CLAIM_BUSY (another in-flight copy of this message)
          * anything else (accepted/delivered/read/failed, or wamid present)
            -> CLAIM_DONE
        """
        if not campaign_id or not guest_id or not self.db_url:
            return CLAIM_MISSING

        def _do(conn):
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE messages_sent
                    SET send_claimed_at = NOW(),
                        send_attempts = send_attempts + 1,
                        send_reclaimed = send_reclaimed OR (send_claimed_at IS NOT NULL),
                        updated_at = NOW()
                    WHERE campaign_id = %s::uuid AND guest_id = %s::uuid
                      AND {_RESOLVABLE_SQL}
                      AND wa_message_id IS NULL
                      AND (
                            send_claimed_at IS NULL
                         OR (send_claimed_at < NOW() - make_interval(mins => %s)
                             AND send_reclaimed = false)
                      )
                    RETURNING send_attempts
                    """,
                    (campaign_id, guest_id, STALE_CLAIM_MINUTES),
                )
                if cur.fetchone() is not None:
                    return CLAIM_OK
                cur.execute(
                    f"""
                    SELECT {_RESOLVABLE_SQL} AS resolvable, wa_message_id,
                           send_claimed_at,
                           (send_claimed_at < NOW() - make_interval(mins => %s)) AS stale
                    FROM messages_sent
                    WHERE campaign_id = %s::uuid AND guest_id = %s::uuid
                    """,
                    (STALE_CLAIM_MINUTES, campaign_id, guest_id),
                )
                row = cur.fetchone()
                if row is None:
                    return CLAIM_MISSING
                resolvable, wamid, claimed_at, stale = row
                if not resolvable or wamid:
                    return CLAIM_DONE
                if claimed_at is not None and stale:
                    return CLAIM_UNCERTAIN
                return CLAIM_BUSY

        return self._run(_do, default=CLAIM_MISSING)

    def release_send_claim(self, campaign_id: Optional[str], guest_id: Optional[str]) -> None:
        """Give the claim back (Meta did not take the message and we will retry
        later via the retry queue / requeue). Does not touch resolved rows."""
        if not campaign_id or not guest_id or not self.db_url:
            return

        def _do(conn):
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE messages_sent SET send_claimed_at = NULL, updated_at = NOW()
                    WHERE campaign_id = %s::uuid AND guest_id = %s::uuid
                      AND {_RESOLVABLE_SQL} AND wa_message_id IS NULL
                    """,
                    (campaign_id, guest_id),
                )
        try:
            self._run(_do)
        except Exception as e:
            self.logger.error(f"Failed to release send claim: {e}")

    def record_delivery_outcome(
        self,
        campaign_id: Optional[str],
        guest_id: Optional[str],
        status: str,
        wa_message_id: Optional[str] = None,
        error_code: Optional[str] = None,
        error_detail: Optional[str] = None,
    ) -> bool:
        """Record what Meta actually did with a campaign message.

        Advances only rows still resolvable: QUEUED, or swept by the finalizer as
        `failed/queued_timeout` while the message was still waiting in the
        RabbitMQ backlog (late acceptance - previously Meta's answer was thrown
        away and the reply could not be attributed to the round).

        No-ops for non-campaign traffic (no campaign_id/guest_id).
        """
        if not campaign_id or not guest_id or not self.db_url:
            return False

        def _do(conn):
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE messages_sent
                    SET status = %s,
                        wa_message_id = COALESCE(%s, wa_message_id),
                        error_code = %s,
                        error_detail = %s,
                        updated_at = NOW()
                    WHERE campaign_id = %s::uuid AND guest_id = %s::uuid
                      AND {_RESOLVABLE_SQL}
                    """,
                    (status, wa_message_id,
                     (str(error_code)[:100] if error_code else None),
                     (str(error_detail)[:500] if error_detail else None),
                     campaign_id, guest_id),
                )
                return cur.rowcount > 0
        try:
            # Accepted outcomes are what prevent a double send on stale-claim
            # recovery, so try harder than for logging.
            return bool(self._run(_do, default=False, retries=3))
        except Exception as e:
            self.logger.error(f"Failed to record delivery outcome: {e}")
            return False

    # ------------------------------------------------------------ messages_log
    def log_outgoing_message(
        self,
        conversation_id: Optional[str],
        message_type: str,
        state: Optional[str],
        whatsapp_message_id: str,
        payload: Optional[str] = None,
        campaign_id: Optional[str] = None,
        guest_phone: Optional[str] = None,
    ) -> bool:
        """Log an outgoing message to messages_log.

        `guest_phone` (normalized digits) is denormalized onto the row: inbound
        free-text replies (no Meta context id) are attributed by looking up the
        latest outgoing row for that phone (webhook-worker flow_manager), which
        never matched while outpost left it NULL.
        """
        if not conversation_id or not self.db_url:
            return False
        normalized = normalize_phone(guest_phone) if guest_phone else None

        def _do(conn):
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO messages_log (conversation_id, wa_message_id, direction, message_type,
                                              payload, state, campaign_id, guest_phone, created_at)
                    VALUES (%s::uuid, %s, 'outgoing', %s, %s, %s, %s::uuid, %s, NOW())
                    """,
                    (conversation_id, whatsapp_message_id, message_type, payload, state,
                     campaign_id, normalized),
                )
                return True
        try:
            return bool(self._run(_do, default=False))
        except Exception as e:
            self.logger.error(f"Failed to log outgoing message: {e}")
            return False

    def close(self):
        try:
            if self._pool is not None and not self._pool.closed:
                self._pool.closeall()
        except Exception:
            pass
        self.executor.shutdown(wait=False)


_conversation_db_instance = None


def get_conversation_db() -> ConversationDB:
    """Get or create the global ConversationDB instance."""
    global _conversation_db_instance
    if _conversation_db_instance is None:
        _conversation_db_instance = ConversationDB()
    return _conversation_db_instance
