"""
Database utilities for contact import worker.

Handles database connections and queries for:
- Finding active events by owner phone number
- Creating guest import records
- Idempotency checks
"""

import os
import json
import logging
from typing import Optional, Dict, Any, List
from uuid import uuid4

import psycopg2
import psycopg2.extras
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


def get_db_url() -> str:
    """Build database connection URL from environment variables."""
    host = os.getenv("DB_HOST")
    port = os.getenv("DB_PORT")
    user = os.getenv("DB_USER")
    password = os.getenv("DB_PASSWORD")
    name = os.getenv("DB_NAME")
    return f"postgresql://{user}:{password}@{host}:{port}/{name}"


@retry(stop=stop_after_attempt(20), wait=wait_exponential(multiplier=1, min=1, max=30))
def connect() -> psycopg2.extensions.connection:
    """Connect to PostgreSQL database with retry logic."""
    logger.info("Connecting to Postgres...")
    conn = psycopg2.connect(get_db_url())
    conn.autocommit = True
    logger.info("Connected to Postgres")
    return conn


def ensure_schema(conn: psycopg2.extensions.connection):
    """Ensure guest_imports and guest_import_contacts tables exist."""
    try:
        with conn.cursor() as cur:
            # Create guest_imports table
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS guest_imports (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
                    source VARCHAR(50) NOT NULL DEFAULT 'whatsapp',
                    raw_payload TEXT NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    message_id VARCHAR(128) UNIQUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            logger.info("Created/verified guest_imports table")
            
            # Create guest_import_contacts table
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS guest_import_contacts (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    import_id UUID NOT NULL REFERENCES guest_imports(id) ON DELETE CASCADE,
                    name VARCHAR(200),
                    phone VARCHAR(20),
                    email VARCHAR(100),
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    validation_errors TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            logger.info("Created/verified guest_import_contacts table")
            
            # Create indexes for performance
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_guest_imports_message_id ON guest_imports(message_id);"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_guest_imports_event_id ON guest_imports(event_id);"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_guest_import_contacts_import_id ON guest_import_contacts(import_id);"
            )
            logger.info("Created/verified indexes for guest_imports tables")
    except Exception as e:
        logger.error(f"Error ensuring schema: {e}", exc_info=True)
        raise


def normalize_phone(phone: str | None) -> str | None:
    """
    Normalize phone number to canonical digits-only format.
    
    Rules:
    - Remove all non-digit characters
    - If it starts with "00", strip those two zeros
    - Result matches WhatsApp's format (e.g., "972525401686")
    """
    if not phone:
        return None
    
    digits = "".join(ch for ch in phone if ch.isdigit())
    
    if not digits:
        return None
    
    if digits.startswith("00"):
        digits = digits[2:]
    
    return digits


def get_owner_phones_for_event(conn: psycopg2.extensions.connection, event_id: str) -> List[str]:
    """
    Get owner phone numbers for an event.
    
    Queries the users table to get phone numbers from owner UUIDs stored in events.owners JSON array.
    
    Args:
        conn: Database connection
        event_id: Event UUID
        
    Returns:
        List of normalized phone numbers (digits only)
    """
    try:
        with conn.cursor() as cur:
            # First, get the owners JSON array from the event
            cur.execute(
                "SELECT owners FROM events WHERE id = %s",
                (event_id,)
            )
            row = cur.fetchone()
            if not row or not row[0]:
                return []
            
            owners_json = row[0]
            if not isinstance(owners_json, list):
                return []
            
            if not owners_json:
                return []
            
            # Convert owner UUIDs to list of strings
            owner_ids = [str(owner_id) for owner_id in owners_json if owner_id]
            
            if not owner_ids:
                return []
            
            # Query users table for phone numbers
            # Use ANY with array parameter for efficient query
            cur.execute(
                """
                SELECT DISTINCT phone
                FROM users
                WHERE id::text = ANY(%s) AND phone IS NOT NULL
                """,
                (owner_ids,)
            )
            
            phones = []
            for row in cur.fetchall():
                normalized = normalize_phone(row[0])
                if normalized:
                    phones.append(normalized)
            
            return phones
            
    except Exception as e:
        # If users table doesn't exist or query fails, log and return empty
        # This allows the system to work even if users table is in a different database
        logger.warning(
            f"Failed to get owner phones for event {event_id}: {e}. "
            "If users table is in a different database, you may need to implement cross-database lookup."
        )
        return []


def find_active_event_by_owner_phone(conn: psycopg2.extensions.connection, owner_phone: str) -> Optional[Dict[str, Any]]:
    """
    Find the MOST RECENT active event where the owner phone number belongs to the event owner.
    
    Args:
        conn: Database connection
        owner_phone: Normalized phone number (digits only)
        
    Returns:
        Event dict with id, name, etc., or None if not found
    """
    normalized_phone = normalize_phone(owner_phone)
    if not normalized_phone:
        return None
    
    # Get all active events ordered by created_at DESC (most recent first)
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, name, description, event_date, location, active, created_at, updated_at, inviters, owners
            FROM events
            WHERE active = true
            ORDER BY created_at DESC
            """
        )
        events = cur.fetchall()
    
    # For each event, check if owner_phone matches any owner
    # NOTE: This assumes get_owner_phones_for_event will be implemented
    for event in events:
        owner_phones = get_owner_phones_for_event(conn, str(event["id"]))
        if normalized_phone in owner_phones:
            logger.info(
                f"Found active event for owner phone",
                extra={"event_id": str(event["id"]), "event_name": event["name"], "owner_phone": normalized_phone}
            )
            return dict(event)
    
    logger.info(f"No active event found for owner phone: {normalized_phone}")
    return None


def find_active_events_by_owner_phone(conn: psycopg2.extensions.connection, owner_phone: str) -> List[Dict[str, Any]]:
    """
    Find ALL active events owned by this phone number, most recent first.

    Args:
        conn: Database connection
        owner_phone: Normalized phone number (digits only)

    Returns:
        List of event dicts (possibly empty)
    """
    normalized_phone = normalize_phone(owner_phone)
    if not normalized_phone:
        return []

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, name, description, event_date, location, active, created_at, updated_at, inviters, owners
            FROM events
            WHERE active = true
            ORDER BY created_at DESC
            """
        )
        events = cur.fetchall()

    owned = []
    for event in events:
        owner_phones = get_owner_phones_for_event(conn, str(event["id"]))
        if normalized_phone in owner_phones:
            owned.append(dict(event))

    logger.info(f"Found {len(owned)} active event(s) for owner phone: {normalized_phone}")
    return owned


def check_import_exists(conn: psycopg2.extensions.connection, message_id: str) -> bool:
    """Check if an import with this message_id already exists (idempotency check)."""
    if not message_id:
        return False
    
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM guest_imports WHERE message_id = %s LIMIT 1",
            (message_id,)
        )
        return cur.fetchone() is not None


def create_guest_import(
    conn: psycopg2.extensions.connection,
    event_id: str,
    raw_payload: str,
    message_id: Optional[str] = None,
    source: str = "whatsapp"
) -> str:
    """
    Create a new guest import record.
    
    Args:
        conn: Database connection
        event_id: Event UUID
        raw_payload: Full message payload as JSON string
        message_id: WhatsApp message ID for idempotency (optional)
        source: Import source (default: "whatsapp")
        
    Returns:
        Import ID (UUID string)
    """
    import_id = str(uuid4())
    
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO guest_imports (id, event_id, source, raw_payload, status, message_id)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (import_id, event_id, source, raw_payload, "pending", message_id)
        )
        result = cur.fetchone()
        return str(result[0])


def create_guest_import_contact(
    conn: psycopg2.extensions.connection,
    import_id: str,
    name: Optional[str],
    phone: Optional[str],
    email: Optional[str]
) -> str:
    """
    Create a guest import contact record.
    
    Args:
        conn: Database connection
        import_id: Import UUID
        name: Contact name
        phone: Contact phone number
        email: Contact email
        
    Returns:
        Contact ID (UUID string)
    """
    contact_id = str(uuid4())
    
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO guest_import_contacts (id, import_id, name, phone, email, status)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (contact_id, import_id, name, phone, email, "pending")
        )
        result = cur.fetchone()
        return str(result[0])

