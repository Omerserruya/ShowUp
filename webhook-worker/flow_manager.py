import os
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import psycopg2
import psycopg2.extras
import yaml
from redis import asyncio as aioredis
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from message_builder import MessageBuilder


logger = logging.getLogger(__name__)


class ConversationFlowManager:
    """Manages WhatsApp conversation flow using YAML config, Redis state, and Postgres history."""

    def __init__(self,
                 flow_path: Optional[str] = None,
                 initial_state: Optional[str] = None):
        # Load flow config
        self.flow_path = flow_path or os.getenv("CONVERSATION_FLOW_PATH", 
                                                os.path.join(os.path.dirname(__file__), "conversation_flow.yaml"))
        self.flow: Dict[str, Any] = self._load_flow(self.flow_path)
        self.initial_state = initial_state or os.getenv("CONVERSATION_INITIAL_STATE", "rsvp_invite")
        self.state_status_mapping: Dict[str, str] = self.flow.get("state_status_mapping", {})

        # Messages config for MessageBuilder (optional)
        self.messages_path = os.getenv("MESSAGES_CONFIG_PATH", os.path.join(os.path.dirname(__file__), "messages.yaml"))
        self.message_builder = None
        try:
            if os.path.exists(self.messages_path):
                with open(self.messages_path, "r", encoding="utf-8") as f:
                    messages_config = yaml.safe_load(f) or {}
                self.message_builder = MessageBuilder(messages_config)
        except Exception as e:
            logger.warning(f"Failed to load messages config: {e}")

        # Redis
        self.redis = aioredis.from_url(
            os.getenv("REDIS_URL", "redis://redis:6379/0"),
            encoding="utf-8",
            decode_responses=True,
        )

        # Postgres (sync driver; small queries only)
        self.pg_conn = self._connect_pg()
        self._ensure_tables()

    def _load_flow(self, path: str) -> Dict[str, Any]:
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    def _pg_url(self) -> str:
        # Prefer DATABASE_URL if present (as used by core-service)
        url = os.getenv("DATABASE_URL")
        if url:
            return url
        host = os.getenv("DB_HOST", "postgres")
        port = os.getenv("DB_PORT", "5432")
        user = os.getenv("DB_USER", "postgres")
        password = os.getenv("DB_PASSWORD", "postgres")
        name = os.getenv("DB_NAME", "showup")
        return f"postgresql://{user}:{password}@{host}:{port}/{name}"

    @retry(
        stop=stop_after_attempt(20),
        wait=wait_exponential(multiplier=1, min=1, max=30),
        retry=retry_if_exception_type((psycopg2.OperationalError, psycopg2.InterfaceError))
    )
    def _connect_pg(self):
        logger.info("Connecting to Postgres...")
        conn = psycopg2.connect(self._pg_url())
        conn.autocommit = True
        logger.info("Connected to Postgres")
        return conn

    def _ensure_tables(self):
        """Create messages_log if not exists. Assumes guests table already exists in main DB."""
        ddl = """
        CREATE TABLE IF NOT EXISTS messages_log (
            id SERIAL PRIMARY KEY,
            guest_id UUID NULL,
            event_id UUID NOT NULL,
            direction VARCHAR(16) NOT NULL, -- incoming | outgoing
            type VARCHAR(32) NOT NULL,       -- quick_reply | free_text | template
            content TEXT NULL,
            state_before VARCHAR(64) NULL,
            state_after VARCHAR(64) NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        );
        """
        with self.pg_conn.cursor() as cur:
            cur.execute(ddl)
            # Also add foreign key if possible (don't fail if it exists)
            try:
                cur.execute("""
                    DO $$ 
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM pg_constraint 
                            WHERE conname = 'messages_log_guest_id_fkey'
                        ) THEN
                            ALTER TABLE messages_log 
                            ADD CONSTRAINT messages_log_guest_id_fkey 
                            FOREIGN KEY (guest_id) REFERENCES guests(id);
                        END IF;
                    END $$;
                """)
            except Exception as e:
                logger.warning(f"Could not add foreign key constraint: {e}")

    @staticmethod
    def _state_key(guest_phone: str, event_id: str) -> str:
        return f"conversation:{guest_phone}:{event_id}"

    async def get_state(self, guest_phone: str, event_id: str) -> Dict[str, Any]:
        raw = await self.redis.get(self._state_key(guest_phone, event_id))
        if not raw:
            return {
                "state": self.initial_state,
                "last_message_id": None,
                "last_interaction_at": datetime.now(timezone.utc).isoformat(),
            }
        try:
            return json.loads(raw)
        except Exception:
            return {"state": self.initial_state}

    async def set_state(self, guest_phone: str, event_id: str, state: Dict[str, Any]):
        await self.redis.set(self._state_key(guest_phone, event_id), json.dumps(state, ensure_ascii=False))

    def _find_guest_and_event(self, guest_phone: str) -> Tuple[Optional[str], Optional[str]]:
        """Find guest_id and event_id by phone number.
        
        Returns:
            (guest_id, event_id) as strings, or (None, None) if not found
        """
        # Normalize phone: remove + and any spaces, try multiple formats
        normalized_phone = guest_phone.replace("+", "").replace(" ", "").replace("-", "")
        
        # Try multiple phone formats: original, without +, with country code variations
        sql = """
        SELECT id, event_id FROM guests 
        WHERE phone = %s 
           OR phone = %s
           OR phone LIKE %s
           OR phone LIKE %s
        ORDER BY created_at DESC 
        LIMIT 1;
        """
        with self.pg_conn.cursor() as cur:
            # Try exact matches and variations
            cur.execute(sql, (
                guest_phone,                    # Original format
                normalized_phone,               # Without + and spaces
                f"%{normalized_phone}",         # Ends with normalized
                f"{normalized_phone}%"          # Starts with normalized
            ))
            row = cur.fetchone()
            if row:
                logger.info(
                    f"Found guest for phone {guest_phone}",
                    extra={"guest_id": str(row[0]), "event_id": str(row[1])}
                )
                return (str(row[0]), str(row[1]))
            else:
                logger.warning(
                    f"No guest found for phone {guest_phone}",
                    extra={"tried_formats": [guest_phone, normalized_phone]}
                )
            return (None, None)

    def _log_message(self,
                      guest_id: Optional[str],
                      event_id: str,
                      direction: str,
                      msg_type: str,
                      content: Optional[str],
                      state_before: Optional[str],
                      state_after: Optional[str]):
        sql = """
        INSERT INTO messages_log (guest_id, event_id, direction, type, content, state_before, state_after)
        VALUES (%s, %s, %s, %s, %s, %s, %s);
        """
        with self.pg_conn.cursor() as cur:
            # guest_id and event_id are now UUIDs (strings)
            cur.execute(sql, (guest_id, event_id, direction, msg_type, content, state_before, state_after))

    def _update_guest_status(self, guest_phone: str, event_id: str, next_state: str):
        status = self.state_status_mapping.get(next_state)
        if not status:
            return
        sql = """
        UPDATE guests
        SET status = %s,
            last_response = NOW()
        WHERE phone = %s AND event_id = %s;
        """
        with self.pg_conn.cursor() as cur:
            cur.execute(sql, (status, guest_phone, event_id))

    def _normalize_text(self, text: str) -> str:
        """Normalize text for matching: strip whitespace, normalize quotes, remove extra spaces."""
        if not text:
            return ""
        # Strip leading/trailing whitespace
        normalized = text.strip()
        # Normalize different quote types to standard quotes
        # Replace curly quotes and other Unicode quotes with straight quotes
        normalized = normalized.replace('״', '"').replace('״', '"').replace('"', '"').replace('"', '"')
        normalized = normalized.replace(''', "'").replace(''', "'")
        # Remove extra whitespace (multiple spaces, tabs, newlines)
        normalized = re.sub(r'\s+', ' ', normalized)
        normalized = normalized.strip()
        return normalized
    
    def _resolve_next(self, current_state: str, user_text: str) -> Optional[str]:
        state_def = (self.flow or {}).get(current_state, {})
        next_map: Dict[str, str] = state_def.get("next", {})
        
        # Normalize user text
        normalized_user_text = self._normalize_text(user_text)
        
        # Log for debugging
        logger.info(
            f"Resolving next state from '{current_state}'",
            extra={
                "current_state": current_state,
                "user_text": user_text,
                "normalized_user_text": normalized_user_text,
                "user_text_length": len(user_text),
                "user_text_bytes": user_text.encode('utf-8').hex(),
                "available_transitions": list(next_map.keys()),
                "available_transitions_count": len(next_map)
            }
        )
        
        # Check for wildcard match first
        if "*" in next_map:
            logger.info(f"Wildcard match found in state '{current_state}', transitioning to '{next_map['*']}'")
            return next_map["*"]
        
        # Try exact match first
        result = next_map.get(user_text)
        if result:
            logger.info(f"Exact match found: '{user_text}' -> '{result}'")
            return result
        
        # Try normalized match
        result = next_map.get(normalized_user_text)
        if result:
            logger.info(f"Normalized match found: '{normalized_user_text}' -> '{result}'")
            return result
        
        # Try matching each key after normalization
        for key, value in next_map.items():
            normalized_key = self._normalize_text(key)
            if normalized_key == normalized_user_text:
                logger.info(f"Normalized key match found: '{key}' (normalized: '{normalized_key}') -> '{value}'")
                return value
        
        # Last resort: try case-insensitive matching (if all else fails)
        normalized_user_text_lower = normalized_user_text.lower()
        for key, value in next_map.items():
            normalized_key = self._normalize_text(key)
            if normalized_key.lower() == normalized_user_text_lower:
                logger.info(f"Case-insensitive normalized match found: '{key}' -> '{value}'")
                return value
        
        # No match found - log detailed comparison
        logger.warning(
            f"No transition found for text '{user_text}' (normalized: '{normalized_user_text}') in state '{current_state}'",
            extra={
                "current_state": current_state,
                "user_text": user_text,
                "normalized_user_text": normalized_user_text,
                "user_text_hex": user_text.encode('utf-8').hex(),
                "normalized_user_text_hex": normalized_user_text.encode('utf-8').hex(),
                "available_options": list(next_map.keys()),
                "available_options_normalized": [self._normalize_text(k) for k in next_map.keys()],
                "available_options_hex": [k.encode('utf-8').hex() for k in next_map.keys()],
                "available_options_normalized_hex": [self._normalize_text(k).encode('utf-8').hex() for k in next_map.keys()]
            }
        )
        
        return None

    async def handle_incoming(self,
                              msg_type: str,           # quick_reply | free_text
                              guest_phone: str,
                              text: str,
                              event_id: Optional[str] = None,  # Optional - will be looked up if not provided
                              message_id: Optional[str] = None,
                              template_parameters: Optional[Dict[str, Any]] = None,
                              guest: Optional[Dict[str, Any]] = None,
                              event: Optional[Dict[str, Any]] = None
                              ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        """
        Process incoming user text, decide next template or fallback.

        Returns:
          (outpost_template_message | None, previous_state, next_state)
        """
        # Look up guest and event_id from database by phone number
        guest_id, actual_event_id = self._find_guest_and_event(guest_phone)
        
        # Use provided event_id or the one from database lookup
        final_event_id = event_id or actual_event_id
        
        if not final_event_id:
            logger.warning(
                f"No event found for phone {guest_phone}, cannot process conversation flow",
                extra={"phone": guest_phone, "message_id": message_id}
            )
            # Return None message to skip processing
            return None, "", ""
        
        state_obj = await self.get_state(guest_phone, final_event_id)
        prev_state = state_obj.get("state", self.initial_state)

        # Log incoming with detailed info
        logger.info(
            f"Processing incoming {msg_type} message",
            extra={
                "guest_phone": guest_phone,
                "event_id": final_event_id,
                "prev_state": prev_state,
                "text": text,
                "message_id": message_id
            }
        )
        
        self._log_message(guest_id, final_event_id, "incoming", msg_type, text, prev_state, prev_state)

        # Resolve next state
        next_state = self._resolve_next(prev_state, text)

        if next_state:
            # Build outpost message via MessageBuilder when available; otherwise fallback to simple template
            outpost_message: Dict[str, Any]
            try:
                if self.message_builder is not None:
                    guest_ctx = guest or {"phone": guest_phone}
                    event_ctx = event or {"id": event_id}
                    outpost_message = self.message_builder.build(next_state, event=event_ctx, guest=guest_ctx)
                else:
                    raise RuntimeError("MessageBuilder not available")
            except Exception:
                params = template_parameters or {}
                outpost_message = {
                    "platform": "WA",
                    "recipient": guest_phone,
                    "template": next_state,  # template name == next_state
                    "parameters": params,
                }

            # Ensure message metadata - detect interactive messages
            if outpost_message.get("interactive"):
                outpost_message["message_type"] = "interactive"
            elif outpost_message.get("type") == "text" or outpost_message.get("message_type") == "free_text":
                outpost_message["message_type"] = "free_text"
            else:
                outpost_message["message_type"] = "template"
            outpost_message["source"] = "webhook_worker"
            outpost_message["event_id"] = final_event_id
            outpost_message.setdefault("recipient", guest_phone)

            # Update state in Redis
            new_state_obj = {
                "state": next_state,
                "last_message_id": message_id,
                "last_interaction_at": datetime.now(timezone.utc).isoformat(),
            }
            await self.set_state(guest_phone, final_event_id, new_state_obj)

            # Guest updates (status, last_response)
            self._update_guest_status(guest_phone, final_event_id, next_state)

            # Log outgoing template
            self._log_message(guest_id, final_event_id, "outgoing", "template", next_state, prev_state, next_state)

            return outpost_message, prev_state, next_state

        # Fallback: didn't understand. Try MessageBuilder with fallback id; else build template
        fallback_template = os.getenv("FALLBACK_TEMPLATE", "didnt_understand")
        try:
            if self.message_builder is not None:
                guest_ctx = guest or {"phone": guest_phone}
                event_ctx = event or {"id": event_id}
                outpost_message = self.message_builder.build(fallback_template, event=event_ctx, guest=guest_ctx)
            else:
                raise RuntimeError("MessageBuilder not available")
        except Exception:
            outpost_message = {
                "platform": "WA",
                "recipient": guest_phone,
                "template": fallback_template,
                "parameters": template_parameters or {},
            }
        # Ensure message metadata - detect interactive messages
        if outpost_message.get("interactive"):
            outpost_message["message_type"] = "interactive"
        elif outpost_message.get("type") == "text" or outpost_message.get("message_type") == "free_text":
            outpost_message["message_type"] = "free_text"
        else:
            outpost_message["message_type"] = "template"
        outpost_message["source"] = "webhook_worker"
        outpost_message["event_id"] = final_event_id
        outpost_message.setdefault("recipient", guest_phone)

        # Keep state the same but update timestamps
        state_obj["last_message_id"] = message_id
        state_obj["last_interaction_at"] = datetime.now(timezone.utc).isoformat()
        await self.set_state(guest_phone, final_event_id, state_obj)

        # Log outgoing fallback
        self._log_message(guest_id, final_event_id, "outgoing", "template", fallback_template, prev_state, prev_state)

        return outpost_message, prev_state, prev_state


