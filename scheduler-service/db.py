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
    return conn


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


