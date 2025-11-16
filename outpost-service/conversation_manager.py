"""
Conversation Management for Outpost Service

This module handles creating and managing conversations in the webhook-worker database
when campaign messages are sent. This ensures that every outgoing campaign message
is properly associated with a conversation that can be used for webhook processing.

Key design decisions:
- Conversations are created per (guest_id, event_id) pair, not just by phone number
- This supports multiple active events for the same phone number
- Conversations are created at send-time to ensure proper context for webhook processing
"""

import os
import logging
import uuid
from typing import Optional

import psycopg2
from psycopg2.extras import RealDictCursor
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

logger = logging.getLogger("conversation_manager")


def _get_webhook_db_url() -> str:
    """
    Get database connection URL for webhook-worker database.
    
    Note: The webhook-worker database is the same PostgreSQL instance as other services,
    but uses the conversations and messages_log tables. We use the same DB connection
    parameters as configured for outpost-service.
    """
    db_user = os.getenv("DB_USER")
    db_password = os.getenv("DB_PASSWORD")
    db_host = os.getenv("DB_HOST")
    db_port = os.getenv("DB_PORT")
    db_name = os.getenv("DB_NAME")
    
    if not all([db_user, db_password, db_host, db_port, db_name]):
        raise ValueError("Missing required database environment variables for webhook DB connection")
    
    return f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type((psycopg2.OperationalError, psycopg2.InterfaceError))
)
def _get_db_connection():
    """Get a database connection to the webhook-worker database."""
    db_url = _get_webhook_db_url()
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    return conn


def ensure_conversation_for_outgoing_message(
    event_id: str,
    guest_id: str,
    guest_phone: str
) -> Optional[uuid.UUID]:
    """
    Ensure that a conversation exists for the given event + guest combination.
    
    This function:
    1. Checks for an existing active conversation for (guest_id, event_id)
    2. If found, returns the existing conversation_id
    3. If not found, creates a new conversation with:
       - guest_id, guest_phone, event_id
       - current_state = 'rsvp_invite' (initial state for campaign invitations)
       - active = TRUE
    
    Important: This supports multiple conversations per phone number, one per event.
    The uniqueness is enforced per (guest_id, event_id) pair, not just by phone number.
    
    Args:
        event_id: The UUID of the event (as string)
        guest_id: The UUID of the guest (as string)
        guest_phone: The phone number of the guest
    
    Returns:
        The conversation UUID if successful, None if there was an error
    
    Raises:
        ValueError: If required parameters are missing
        psycopg2.Error: If database operation fails
    """
    if not event_id or not guest_id or not guest_phone:
        logger.warning(
            "Missing required parameters for conversation creation",
            extra={"event_id": event_id, "guest_id": guest_id, "guest_phone": guest_phone}
        )
        return None
    
    try:
        conn = _get_db_connection()
        
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Check for existing active conversation for this guest + event
                cur.execute(
                    """
                    SELECT id
                    FROM conversations
                    WHERE guest_id = %s::uuid
                      AND event_id = %s
                      AND active = TRUE
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    (guest_id, event_id)
                )
                
                result = cur.fetchone()
                
                if result:
                    conversation_id = result["id"]
                    logger.info(
                        "Found existing active conversation",
                        extra={
                            "conversation_id": str(conversation_id),
                            "event_id": event_id,
                            "guest_id": guest_id,
                            "guest_phone": guest_phone
                        }
                    )
                    return conversation_id
                
                # No active conversation found, create a new one
                new_conversation_id = uuid.uuid4()
                
                cur.execute(
                    """
                    INSERT INTO conversations (
                        id, guest_id, guest_phone, event_id,
                        current_state, active, created_at, updated_at
                    )
                    VALUES (%s, %s::uuid, %s, %s, 'rsvp_invite', TRUE, NOW(), NOW())
                    """,
                    (new_conversation_id, guest_id, guest_phone, event_id)
                )
                
                logger.info(
                    "Created new conversation for outgoing message",
                    extra={
                        "conversation_id": str(new_conversation_id),
                        "event_id": event_id,
                        "guest_id": guest_id,
                        "guest_phone": guest_phone,
                        "state": "rsvp_invite"
                    }
                )
                
                return new_conversation_id
                
        finally:
            conn.close()
            
    except psycopg2.IntegrityError as e:
        # Handle case where unique constraint violation occurs (race condition)
        # This can happen if two messages are sent simultaneously for the same guest+event
        logger.warning(
            "Conversation creation failed due to constraint violation (likely race condition), retrying lookup",
            extra={"event_id": event_id, "guest_id": guest_id, "error": str(e)}
        )
        
        # Retry the lookup
        try:
            conn = _get_db_connection()
            try:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(
                        """
                        SELECT id
                        FROM conversations
                        WHERE guest_id = %s::uuid
                          AND event_id = %s
                          AND active = TRUE
                        ORDER BY created_at DESC
                        LIMIT 1
                        """,
                        (guest_id, event_id)
                    )
                    result = cur.fetchone()
                    if result:
                        return result["id"]
            finally:
                conn.close()
        except Exception as retry_error:
            logger.error(
                "Failed to retry conversation lookup after constraint violation",
                extra={"error": str(retry_error)}
            )
        
        return None
        
    except Exception as e:
        logger.error(
            "Failed to ensure conversation for outgoing message",
            extra={
                "event_id": event_id,
                "guest_id": guest_id,
                "guest_phone": guest_phone,
                "error": str(e),
                "error_type": type(e).__name__
            },
            exc_info=True
        )
        return None

