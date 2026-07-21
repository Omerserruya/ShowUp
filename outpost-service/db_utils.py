"""
Database utilities for outpost-service.

Handles conversation management and message logging in the webhook-worker database.
This module provides reusable functions for:
- Creating/retrieving conversations
- Logging outgoing messages
- Managing conversation state

This is separate from RabbitMQ consumer logic to allow reuse across different components.
"""

import os
import logging
import uuid
import json
from typing import Optional

import psycopg2
from psycopg2.extras import RealDictCursor
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

# Import phone normalization utility
try:
    from utils.phone import normalize_phone
except ImportError:
    # Fallback if utils.phone doesn't exist (shouldn't happen, but defensive)
    def normalize_phone(phone: str | None) -> str | None:
        if not phone:
            return None
        digits = "".join(ch for ch in phone if ch.isdigit())
        if not digits:
            return None
        if digits.startswith("00"):
            digits = digits[2:]
        return digits

logger = logging.getLogger("db_utils")


# Delivery-status vocabulary is shared with campaign-worker so the two ends of
# the pipeline can never disagree about what a status means.
from shared.domain.delivery import MessageDeliveryStatus


class ConversationDB:
    """Manages conversations and message logging in the webhook-worker database."""
    
    def __init__(self):
        self.logger = logging.getLogger("db_utils.ConversationDB")
        self.pg_conn = None
        self.db_url = None
        self.db_config = {}
        
        # Check if DB logging is enabled
        enable_db_logging = (os.getenv('OUTPOST_ENABLE_DB_LOGGING', 'false').lower() == 'true')
        
        if enable_db_logging:
            db_user = os.getenv('DB_USER')
            db_password = os.getenv('DB_PASSWORD')
            db_host = os.getenv('DB_HOST')
            db_port = os.getenv('DB_PORT')
            db_name = os.getenv('DB_NAME')

            self.logger.info(
                "DB logging enabled, will attempt to connect to Postgres",
                extra={
                    "db_host": db_host,
                    "db_port": db_port,
                    "db_name": db_name,
                    "db_user": db_user if db_user else None
                }
            )

            if all([db_user, db_password, db_host, db_port, db_name]):
                self.db_url = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
                self.db_config = {
                    'user': db_user,
                    'password': db_password,
                    'host': db_host,
                    'port': db_port,
                    'database': db_name
                }
                # Don't connect immediately - Postgres might not be ready yet
                # Will connect on first use with retry logic
            else:
                missing = [k for k, v in {'DB_USER': db_user, 'DB_PASSWORD': db_password, 'DB_HOST': db_host, 'DB_PORT': db_port, 'DB_NAME': db_name}.items() if not v]
                self.logger.warning(f"DB logging disabled: missing DB_* envs: {missing}")
        else:
            self.logger.info("DB logging disabled: OUTPOST_ENABLE_DB_LOGGING is not 'true'")

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((psycopg2.OperationalError, psycopg2.InterfaceError))
    )
    def _ensure_connection(self) -> bool:
        """Ensure Postgres connection is established. Returns True if connected."""
        if self.pg_conn and not self.pg_conn.closed:
            return True
        
        if not self.db_url:
            return False
        
        try:
            self.pg_conn = psycopg2.connect(self.db_url)
            self.pg_conn.autocommit = True
            self.logger.info("Successfully connected to Postgres for message logging")
            return True
        except Exception as e:
            self.logger.warning(f"Could not connect to Postgres for logging: {e}")
            self.pg_conn = None
            return False
    
    def ensure_or_get_conversation(
        self,
        event_id: Optional[str],
        guest_phone: Optional[str],
        guest_id: Optional[str] = None,
        initial_state: str = "rsvp_invite"
    ) -> Optional[str]:
        """
        Ensure a Conversation exists for guest_phone + event_id. Returns conversation_id UUID.
        
        This function:
        1. Checks for an existing active conversation for (guest_phone, event_id)
        2. If found, returns the existing conversation_id
        3. If not found, creates a new conversation with the specified initial_state
        
        Important: This supports multiple conversations per phone number, one per event.
        The uniqueness is enforced per (guest_phone, event_id) pair.
        
        Args:
            event_id: The UUID of the event (as string, must be valid UUID)
            guest_phone: The phone number of the guest
            guest_id: Optional UUID of the guest (as string)
            initial_state: Initial conversation state (default: "rsvp_invite")
        
        Returns:
            The conversation UUID as string if successful, None if there was an error
        """
        self.logger.info(
            "Attempting to ensure/get conversation",
            extra={
                "event_id": event_id,
                "guest_phone": guest_phone,
                "guest_id": guest_id,
                "initial_state": initial_state
            }
        )
        
        # Ensure Postgres connection
        if not self._ensure_connection():
            self.logger.warning("Postgres connection not available for conversation creation")
            return None
        
        if not event_id or not guest_phone:
            self.logger.warning(
                "Missing required params for conversation",
                extra={"event_id": event_id, "guest_phone": guest_phone}
            )
            return None
        
        # Normalize guest_phone to canonical format (digits only, no +, no 00 prefix)
        # This ensures consistent lookups regardless of how the phone was originally stored
        normalized_guest_phone = normalize_phone(guest_phone)
        if not normalized_guest_phone:
            self.logger.warning(
                "Invalid guest_phone after normalization",
                extra={"original_guest_phone": guest_phone, "event_id": event_id}
            )
            return None
        
        # Validate event_id is a UUID (not wamid)
        try:
            uuid.UUID(event_id)  # Will raise ValueError if not a valid UUID
        except (ValueError, AttributeError):
            self.logger.warning(
                "event_id is not a valid UUID, skipping conversation creation",
                extra={"event_id": event_id, "event_id_type": type(event_id).__name__}
            )
            return None
        
        try:
            with self.pg_conn.cursor() as cur:
                # Check if conversation exists
                # Lookup by normalized guest_phone + event_id (supports multiple events per phone)
                cur.execute(
                    """
                    SELECT id FROM conversations
                    WHERE guest_phone = %s AND event_id = %s AND active = true
                    LIMIT 1
                    """,
                    (normalized_guest_phone, event_id),
                )
                row = cur.fetchone()
                if row:
                    conversation_id = str(row[0])
                    self.logger.info(
                        "Found existing active conversation",
                        extra={
                            "conversation_id": conversation_id,
                            "event_id": event_id,
                            "guest_phone": normalized_guest_phone
                        }
                    )
                    return conversation_id
                
                # Create new conversation with normalized phone
                conversation_id = str(uuid.uuid4())
                
                # guest_id can be None, so handle it properly
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
                if row:
                    self.logger.info(
                        "Created new conversation",
                        extra={
                            "conversation_id": str(row[0]),
                            "event_id": event_id,
                            "guest_phone": normalized_guest_phone,
                            "original_guest_phone": guest_phone,
                            "guest_id": guest_id,
                            "initial_state": initial_state
                        }
                    )
                    return str(row[0])
                return None
        except psycopg2.IntegrityError as e:
            # Handle case where unique constraint violation occurs (race condition)
            # Retry the lookup using normalized phone
            self.logger.warning(
                "Conversation creation failed due to constraint violation (likely race condition), retrying lookup",
                extra={"event_id": event_id, "guest_phone": normalized_guest_phone, "error": str(e)}
            )
            try:
                with self.pg_conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT id FROM conversations
                        WHERE guest_phone = %s AND event_id = %s AND active = true
                        LIMIT 1
                        """,
                        (normalized_guest_phone, event_id),
                    )
                    row = cur.fetchone()
                    if row:
                        return str(row[0])
            except Exception as retry_error:
                self.logger.error(
                    "Failed to retry conversation lookup after constraint violation",
                    extra={"error": str(retry_error)}
                )
            return None
        except Exception as e:
            self.logger.warning(f"Failed to ensure/get conversation: {e}", exc_info=True)
            return None

    def get_conversation_state(self, conversation_id: str) -> Optional[str]:
        """
        Get the current_state of a conversation from the database.
        
        Args:
            conversation_id: The UUID of the conversation (as string)
        
        Returns:
            The current state string, or None if not found or error
        """
        if not self._ensure_connection():
            return None
        try:
            with self.pg_conn.cursor() as cur:
                cur.execute(
                    "SELECT current_state FROM conversations WHERE id = %s::uuid LIMIT 1",
                    (conversation_id,)
                )
                row = cur.fetchone()
                return row[0] if row else None
        except Exception as e:
            self.logger.warning(f"Failed to get conversation state: {e}", exc_info=True)
            return None

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

        This is the step that makes "sent" mean sent. campaign-worker claims a
        row in `messages_sent` as QUEUED and hands the message to us; only here,
        after the Graph API call, do we know whether Meta accepted it. Previously
        a Meta rejection was logged and the AMQP message acked, so a wholly
        failed campaign was indistinguishable from a delivered one.

        No-ops for non-campaign traffic (RSVP bot replies, OTPs), which carries
        no campaign_id/guest_id and has no row to resolve.
        """
        if not campaign_id or not guest_id:
            return False
        if not self._ensure_connection():
            self.logger.warning("Postgres unavailable, cannot record delivery outcome")
            return False
        try:
            with self.pg_conn.cursor() as cur:
                # Guarded by status rank so an out-of-order webhook (Meta may send
                # 'delivered' before we store 'accepted') cannot move a message
                # backwards. Only advances from QUEUED here.
                cur.execute(
                    """
                    UPDATE messages_sent
                    SET status = %s,
                        wa_message_id = COALESCE(%s, wa_message_id),
                        error_code = %s,
                        error_detail = %s,
                        updated_at = NOW()
                    WHERE campaign_id = %s::uuid AND guest_id = %s::uuid
                      AND status = %s
                    """,
                    (status, wa_message_id,
                     (str(error_code)[:100] if error_code else None),
                     (str(error_detail)[:500] if error_detail else None),
                     campaign_id, guest_id, MessageDeliveryStatus.QUEUED.value),
                )
                return cur.rowcount > 0
        except Exception as e:
            self.logger.error(f"Failed to record delivery outcome: {e}", exc_info=True)
            return False

    def log_outgoing_message(
        self,
        conversation_id: Optional[str],
        message_type: str,
        state: Optional[str],
        whatsapp_message_id: str,
        payload: Optional[str] = None,
        campaign_id: Optional[str] = None
    ) -> bool:
        """
        Log outgoing message to messages_log table with conversation_id.
        
        Args:
            conversation_id: The UUID of the conversation (as string)
            message_type: Type of message (e.g., "template", "free_text", "interactive")
            state: The conversation state when message was sent
            whatsapp_message_id: The WhatsApp message ID (wamid)
            payload: Optional JSON payload (truncated to 4000 chars)
            campaign_id: Optional campaign ID if this is a campaign message
        
        Returns:
            True if logged successfully, False otherwise
        """
        # Ensure Postgres connection
        if not self._ensure_connection():
            self.logger.warning("Postgres connection not available, cannot log to messages_log")
            return False
        
        if not conversation_id:
            self.logger.warning("Skipping message log - no conversation_id provided")
            return False
        
        try:
            with self.pg_conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO messages_log (conversation_id, wa_message_id, direction, message_type, payload, state, campaign_id, created_at)
                    VALUES (%s::uuid, %s, 'outgoing', %s, %s, %s, %s::uuid, NOW())
                    """,
                    (conversation_id, whatsapp_message_id, message_type, payload, state, campaign_id)
                )
                self.logger.info(
                    "Logged outgoing message to messages_log",
                    extra={
                        "conversation_id": conversation_id,
                        "wa_message_id": whatsapp_message_id,
                        "message_type": message_type,
                        "state": state,
                        "campaign_id": campaign_id
                    }
                )
                return True
        except Exception as e:
            self.logger.error(f"Failed to log WhatsApp message id: {e}", exc_info=True)
            return False

    def close(self):
        """Close the database connection."""
        if self.pg_conn and not self.pg_conn.closed:
            self.pg_conn.close()
            self.pg_conn = None
            self.logger.info("Closed Postgres connection")


# Global instance for convenience (can be instantiated per-use if needed)
_conversation_db_instance = None


def get_conversation_db() -> ConversationDB:
    """Get or create the global ConversationDB instance."""
    global _conversation_db_instance
    if _conversation_db_instance is None:
        _conversation_db_instance = ConversationDB()
    return _conversation_db_instance

