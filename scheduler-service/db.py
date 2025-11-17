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
                created_at TIMESTAMP DEFAULT NOW()
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
        
        logger.info("Ensured required tables exist")


def fetch_and_mark_due(conn: psycopg2.extensions.connection) -> Sequence[Tuple]:
    """Atomically claim due campaigns by setting status=processing and return them."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            UPDATE campaigns
            SET status = 'processing'
            WHERE id IN (
              SELECT id FROM campaigns
              WHERE status = 'pending' AND schedule_time IS NOT NULL AND schedule_time <= NOW()
              FOR UPDATE SKIP LOCKED
            )
            RETURNING id, event_id, name, template, channel, schedule_time, status
            """
        )
        rows = cur.fetchall()
    return rows


def revert_to_pending(conn: psycopg2.extensions.connection, campaign_id: str):
    with conn.cursor() as cur:
        cur.execute("UPDATE campaigns SET status='pending' WHERE id=%s", (campaign_id,))


