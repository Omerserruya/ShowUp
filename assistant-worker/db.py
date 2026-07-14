"""
Database utilities for the assistant worker.

Resolves the WhatsApp sender to a registered user (owner-only authorization)
and lists the active events that user OWNS. Uses the same canonical E.164
phone form as aub-service so WhatsApp msisdns ("972525401686") match the
users table ("+972525401686").
"""

import json
import logging
import os
from typing import Any, Dict, List, Optional

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


def canonical_phone(phone: Optional[str]) -> Optional[str]:
    """Canonical E.164 form ('+972XXXXXXXXX') - mirrors aub-service _canonical_phone."""
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if not digits:
        return None
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0"):
        digits = "972" + digits[1:]
    elif len(digits) == 9:
        digits = "972" + digits
    return "+" + digits


def get_user_by_phone(conn, phone: str) -> Optional[Dict[str, Any]]:
    """Return {user_id, first_name, last_name} for a registered phone, or None."""
    canon = canonical_phone(phone)
    if not canon:
        return None
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, first_name, last_name FROM users WHERE phone = %s",
            (canon,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {"user_id": str(row[0]), "first_name": row[1], "last_name": row[2]}


def get_active_events_owned(conn, user_id: str) -> List[Dict[str, Any]]:
    """Active events whose owners JSON array contains user_id, newest first."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, name, event_date, owners
            FROM events
            WHERE active = true
            ORDER BY created_at DESC
            """
        )
        rows = cur.fetchall()
    events = []
    for row in rows:
        owners = row.get("owners")
        if isinstance(owners, str):
            try:
                owners = json.loads(owners)
            except json.JSONDecodeError:
                owners = []
        if isinstance(owners, list) and user_id in [str(o) for o in owners]:
            events.append({"id": str(row["id"]), "name": row["name"], "event_date": row["event_date"]})
    return events
