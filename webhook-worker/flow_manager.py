import os
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import psycopg2
import psycopg2.extras
import yaml
from redis import asyncio as aioredis
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

    def _connect_pg(self):
        conn = psycopg2.connect(self._pg_url())
        conn.autocommit = True
        return conn

    def _ensure_tables(self):
        """Create messages_log if not exists. Assumes guests table already exists in main DB."""
        ddl = """
        CREATE TABLE IF NOT EXISTS messages_log (
            id SERIAL PRIMARY KEY,
            guest_id INTEGER NULL,
            event_id VARCHAR(64) NOT NULL,
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

    def _find_guest_id(self, guest_phone: str, event_id: str) -> Optional[int]:
        sql = """
        SELECT id FROM guests WHERE phone = %s AND event_id = %s LIMIT 1;
        """
        with self.pg_conn.cursor() as cur:
            cur.execute(sql, (guest_phone, event_id))
            row = cur.fetchone()
            return row[0] if row else None

    def _log_message(self,
                      guest_id: Optional[int],
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

    def _resolve_next(self, current_state: str, user_text: str) -> Optional[str]:
        state_def = (self.flow or {}).get(current_state, {})
        next_map: Dict[str, str] = state_def.get("next", {})
        # Exact match on text (case sensitive for Hebrew); fallback to None
        return next_map.get(user_text)

    async def handle_incoming(self,
                              msg_type: str,           # quick_reply | free_text
                              guest_phone: str,
                              event_id: str,
                              text: str,
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
        state_obj = await self.get_state(guest_phone, event_id)
        prev_state = state_obj.get("state", self.initial_state)

        # Log incoming
        guest_id = self._find_guest_id(guest_phone, event_id)
        self._log_message(guest_id, event_id, "incoming", msg_type, text, prev_state, prev_state)

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
            outpost_message["event_id"] = event_id
            outpost_message.setdefault("recipient", guest_phone)

            # Update state in Redis
            new_state_obj = {
                "state": next_state,
                "last_message_id": message_id,
                "last_interaction_at": datetime.now(timezone.utc).isoformat(),
            }
            await self.set_state(guest_phone, event_id, new_state_obj)

            # Guest updates (status, last_response)
            self._update_guest_status(guest_phone, event_id, next_state)

            # Log outgoing template
            self._log_message(guest_id, event_id, "outgoing", "template", next_state, prev_state, next_state)

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
        outpost_message["event_id"] = event_id
        outpost_message.setdefault("recipient", guest_phone)

        # Keep state the same but update timestamps
        state_obj["last_message_id"] = message_id
        state_obj["last_interaction_at"] = datetime.now(timezone.utc).isoformat()
        await self.set_state(guest_phone, event_id, state_obj)

        # Log outgoing fallback
        self._log_message(guest_id, event_id, "outgoing", "template", fallback_template, prev_state, prev_state)

        return outpost_message, prev_state, prev_state


