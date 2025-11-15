import os
import logging
from typing import Sequence, Tuple, Optional

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


@retry(stop=stop_after_attempt(20), wait=wait_exponential(multiplier=1, min=1, max=30))
def connect() -> psycopg2.extensions.connection:
    logger.info("Connecting to Postgres...")
    conn = psycopg2.connect(get_db_url())
    conn.autocommit = True
    logger.info("Connected to Postgres")
    return conn


def ensure_schema(conn: psycopg2.extensions.connection):
    """Ensure idempotency table exists."""
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS messages_sent (
                campaign_id uuid NOT NULL,
                guest_id uuid NOT NULL,
                sent_at timestamptz NOT NULL DEFAULT NOW(),
                PRIMARY KEY (campaign_id, guest_id)
            );
            """
        )


def fetch_campaign_by_id(conn: psycopg2.extensions.connection, campaign_id: str) -> Optional[dict]:
    """Fetch campaign data by ID."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, event_id, name, template, channel, schedule_time, status
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
            SELECT id, name, description, event_date, location, active, created_at, updated_at
            FROM events
            WHERE id = %s
            """,
            (event_id,),
        )
        return cur.fetchone()


def fetch_guests_for_event(conn: psycopg2.extensions.connection, event_id: str) -> Sequence[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, name, phone, email
            FROM guests
            WHERE event_id = %s
            """,
            (event_id,),
        )
        return cur.fetchall()


def was_message_sent(conn: psycopg2.extensions.connection, campaign_id: str, guest_id: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM messages_sent WHERE campaign_id=%s AND guest_id=%s LIMIT 1",
            (campaign_id, guest_id),
        )
        return cur.fetchone() is not None


def mark_message_sent(conn: psycopg2.extensions.connection, campaign_id: str, guest_id: str):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO messages_sent (campaign_id, guest_id)
            VALUES (%s, %s)
            ON CONFLICT (campaign_id, guest_id) DO NOTHING
            """,
            (campaign_id, guest_id),
        )


def ensure_or_get_conversation(conn: psycopg2.extensions.connection, guest_id: str, guest_phone: str, event_id: str, initial_state: str = "rsvp_invite") -> str:
    """
    Ensure a Conversation exists for guest_phone + event_id.
    Returns the conversation UUID.
    Creates conversation if it doesn't exist, otherwise returns existing one.
    """
    with conn.cursor() as cur:
        # Check if conversation exists
        cur.execute(
            """
            SELECT id FROM conversations
            WHERE guest_phone = %s AND event_id = %s AND active = true
            LIMIT 1
            """,
            (guest_phone, event_id),
        )
        row = cur.fetchone()
        if row:
            return str(row[0])
        
        # Create new conversation
        cur.execute(
            """
            INSERT INTO conversations (guest_id, guest_phone, event_id, current_state, active)
            VALUES (%s::uuid, %s, %s, %s, true)
            RETURNING id
            """,
            (guest_id, guest_phone, event_id, initial_state),
        )
        row = cur.fetchone()
        if row:
            logger.info(
                f"Created new conversation for guest {guest_phone} and event {event_id} | conversation_id={row[0]}"
            )
            return str(row[0])
        raise Exception("Failed to create conversation")


