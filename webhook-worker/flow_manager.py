import json
import logging
import os
from typing import Any, Dict, Optional, Tuple, Type

import aio_pika
from sqlalchemy import select, insert, update
from sqlalchemy.ext.asyncio import AsyncSession

from .db.session import get_session
from .db.models import Conversation, MessageLog
from .states.base_state import BaseState
from .states.rsvp_invite import RsvpInviteState
from .states.rsvp_count import RsvpCountState
from .states.rsvp_info_question import RsvpInfoQuestionState
from .states.note_info import NoteInfoState
from .states.rsvp_done import RsvpDoneState
from .states.rsvp_update import RsvpUpdateState
from .states.rsvp_decline import RsvpDeclineState
from .states.didnt_understand import DidntUnderstandState


# -----------------------------
# Models
# -----------------------------


@dataclass
logger = logging.getLogger("flow_manager")


# -----------------------------
# Base State and concrete states
# -----------------------------


class FreeTextState(BaseState):
    id = "free_text"

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Conversation) -> None:
        return None

    def get_next_state(self, message: Dict[str, Any]) -> str:
        text = (message.get("text") or "").strip()
        return self.flow.resolve_from_yaml(conversation_state:=self.flow.current_state, user_text=text)  # type: ignore

    async def send(self, session: AsyncSession, conversation: Conversation) -> Optional[Dict[str, Any]]:
        return self.flow.build_outgoing(self.flow.current_state, conversation.guest_phone, str(conversation.event_id))  # type: ignore


# -----------------------------
# FlowManager
# -----------------------------


class FlowManager:
    """Owns conversation context, state resolution, persistence, and enqueuing outgoing messages."""

    def __init__(self, outpost_queue: str):
        self.initial_state = os.getenv("CONVERSATION_INITIAL_STATE", "rsvp_invite")
        self.outpost_queue = outpost_queue
        self.publisher_channel: Optional[aio_pika.abc.AbstractChannel] = None
        self.publisher_routing_key: Optional[str] = None
        # No external YAML message builder; states construct messages directly

        # State registry
        self.state_handlers: Dict[str, Type[BaseState]] = {
            # message-type handlers
            "message": FreeTextState,
            "free_text": FreeTextState,
            "quick_reply": FreeTextState,
            "contacts": FreeTextState,
            "status.update": FreeTextState,
            # flow states
            "rsvp_invite": RsvpInviteState,
            "rsvp_count": RsvpCountState,
            "rsvp_info_question": RsvpInfoQuestionState,
            "note_info": NoteInfoState,
            "rsvp_done": RsvpDoneState,
            "rsvp_update": RsvpUpdateState,
            "rsvp_decline": RsvpDeclineState,
            "didnt_understand": DidntUnderstandState,
        }
        self.current_state: str = self.initial_state

    def attach_publisher(self, channel: aio_pika.abc.AbstractChannel, routing_key: str) -> None:
        self.publisher_channel = channel
        self.publisher_routing_key = routing_key

    # ---------- Conversation/Message persistence ----------

    async def load_conversation(self, session: AsyncSession, guest_phone: str, event_id: str) -> Conversation:
        res = await session.execute(
            select(Conversation).where(Conversation.guest_phone == guest_phone, Conversation.event_id == event_id)
        )
        conv = res.scalars().first()
        if conv:
            self.current_state = conv.current_state
            return conv
        conv = Conversation(guest_phone=guest_phone, event_id=event_id, current_state=self.initial_state)
        session.add(conv)
        await session.commit()
        await session.refresh(conv)
        self.current_state = conv.current_state
        return conv

    async def update_conversation(self, session: AsyncSession, conv: Conversation, new_state: str) -> None:
        await session.execute(
            update(Conversation)
            .where(Conversation.id == conv.id)
            .values(current_state=new_state)
        )
        await session.commit()
        self.current_state = new_state

    async def log_message(self, session: AsyncSession, *, conversation_id, wa_message_id, direction, message_type, reply_to_id, payload, state) -> None:
        entry = MessageLog(
            conversation_id=conversation_id,
            wa_message_id=wa_message_id,
            direction=direction,
            message_type=message_type,
            reply_to_id=reply_to_id,
            payload=payload,
            state=state,
        )
        session.add(entry)
        await session.commit()

    async def resolve_state_from_context(self, session: AsyncSession, context_id: Optional[str]) -> Optional[str]:
        if not context_id:
            return None
        res = await session.execute(
            select(MessageLog.state).where(MessageLog.wa_message_id == context_id).order_by(MessageLog.created_at.desc()).limit(1)
        )
        row = res.first()
        return row[0] if row else None

    # ---------- Flow resolution & building ----------

    # YAML-free flow resolution: Each state class defines its allowed transitions via next_states.

    def build_outgoing(self, next_state: str, guest_phone: str, event_id: str) -> Dict[str, Any]:
        # Deprecated: states must implement send(); kept for compatibility if called
        return {
            "platform": "WA",
            "recipient": guest_phone,
            "message_type": "text",
            "text": "",
            "event_id": event_id,
            "state": next_state,
            "source": "webhook_worker",
        }

    async def publish_outgoing(self, payload: Dict[str, Any]) -> None:
        if not self.publisher_channel or not self.publisher_routing_key:
            logger.error("Publisher not attached; cannot enqueue outgoing")
            return
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        await self.publisher_channel.default_exchange.publish(
            aio_pika.Message(body=body, delivery_mode=aio_pika.DeliveryMode.PERSISTENT),
            routing_key=self.publisher_routing_key,
        )
        logger.info("Enqueued outgoing to outpost_queue", extra={"state": payload.get("state"), "recipient": payload.get("recipient")})

    # ---------- Public entry ----------

    async def handle_event(
        self,
        *,
        message_type: str,
        guest_phone: Optional[str],
        event_id: Optional[str],
        text: str,
        raw: Dict[str, Any],
        context_id: Optional[str],
    ) -> None:
        if not guest_phone or not event_id:
            logger.warning("Missing guest_phone or event_id; skipping")
            return

        async for session in get_session():
            # load or create conversation
            conv = await self.load_conversation(session, guest_phone, event_id)

            # resolve from context (old reply)
            context_state = await self.resolve_state_from_context(session, context_id)
            if context_state:
                logger.info("Resuming from context state", extra={"context_id": context_id, "state": context_state})
                await self.update_conversation(session, conv, context_state)
                # refresh
                conv = await self.load_conversation(session, guest_phone, event_id)

            # Select handler by current conversation state (class-based FSM)
            handler_cls = self.state_handlers.get(conv.current_state, FreeTextState)
            handler = handler_cls(self)

            # log incoming
            await self.log_message(
                session,
                conversation_id=conv.id,
                wa_message_id=raw.get("message_id"),
                direction="incoming",
                message_type=message_type,
                reply_to_id=(raw.get("payload", {}).get("context", {}).get("id") if isinstance(raw.get("payload"), dict) else None),
                payload=json.dumps(raw, ensure_ascii=False)[:4000],
                state=conv.current_state,
            )

            # process
            await handler.process_incoming(session, {"text": text, "raw": raw}, conv)
            next_state_id = handler.get_next_state({"text": text, "raw": raw})
            await self.update_conversation(session, conv, next_state_id)
            conv = await self.load_conversation(session, guest_phone, event_id)

            # send via next state's send
            next_handler = self.state_handlers.get(next_state_id, FreeTextState)(self)
            outgoing = await next_handler.send(session, conv)
            if outgoing:
                await self.log_message(
                    session,
                    conversation_id=conv.id,
                    wa_message_id=None,
                    direction="outgoing",
                    message_type=outgoing.get("message_type", "template"),
                    reply_to_id=None,
                    payload=json.dumps(outgoing, ensure_ascii=False)[:4000],
                    state=next_state_id,
                )
                await self.publish_outgoing(outgoing)

import os
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional, Tuple

import yaml
from redis import asyncio as aioredis

from message_builder import MessageBuilder


logger = logging.getLogger(__name__)


class ConversationFlowManager:
    """Async conversation flow engine with Redis context resolution.

    Responsibilities:
    - Load conversation_flow.yaml and messages.yaml
    - Resolve current state from Redis conversation key
    - On incoming reply with context.id: resolve state from message_context in Redis
    - Resolve next_state from conversation_flow.yaml
    - Build outgoing payload via MessageBuilder
    - Update conversation and store message_context
    """

    def __init__(self,
                 flow_path: Optional[str] = None,
                 messages_path: Optional[str] = None,
                 initial_state: Optional[str] = None,
                 redis_url: Optional[str] = None):
        # Load flow config
        self.flow_path = flow_path or os.getenv("CONVERSATION_FLOW_PATH", os.path.join(os.path.dirname(__file__), "conversation_flow.yaml"))
        self.flow: Dict[str, Any] = self._load_yaml(self.flow_path)
        self.initial_state = initial_state or os.getenv("CONVERSATION_INITIAL_STATE", "rsvp_invite")
        self.state_status_mapping: Dict[str, str] = self.flow.get("state_status_mapping", {})

        # Messages config
        self.messages_path = messages_path or os.getenv("MESSAGES_CONFIG_PATH", os.path.join(os.path.dirname(__file__), "messages.yaml"))
        messages_config = self._load_yaml(self.messages_path)
        self.message_builder = MessageBuilder(messages_config) if messages_config else None

        # Redis
        self.redis = aioredis.from_url(
            redis_url or os.getenv("REDIS_URL", "redis://redis:6379/0"),
            encoding="utf-8",
            decode_responses=True,
        )

        # TTLs
        self.message_context_ttl_seconds: int = int(os.getenv("MESSAGE_CONTEXT_TTL", "86400"))
        self.conversation_ttl_seconds: int = int(os.getenv("CONVERSATION_TTL", str(7 * 24 * 3600)))

    def _load_yaml(self, path: str) -> Dict[str, Any]:
        try:
            if not os.path.exists(path):
                return {}
            with open(path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f) or {}
        except Exception as e:
            logger.warning(f"Failed to load yaml {path}: {e}")
            return {}

    @staticmethod
    def _conversation_key(guest_phone: str, event_id: str) -> str:
        return f"conversation:{guest_phone}:{event_id}"

    @staticmethod
    def _message_context_key(message_id: str) -> str:
        return f"message_context:{message_id}"

    async def get_conversation_state(self, guest_phone: str, event_id: str) -> Dict[str, Any]:
        raw = await self.redis.get(self._conversation_key(guest_phone, event_id))
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

    async def set_conversation_state(self, guest_phone: str, event_id: str, state_obj: Dict[str, Any]) -> None:
        await self.redis.setex(
            self._conversation_key(guest_phone, event_id),
            self.conversation_ttl_seconds,
            json.dumps(state_obj, ensure_ascii=False)
        )

    async def store_message_context(self, message_id: str, state: str, event_id: str, guest_phone: str) -> None:
        if not message_id:
            return
        payload = {
            "message_id": message_id,
            "state": state,
            "event_id": event_id,
            "guest_phone": guest_phone,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await self.redis.setex(
            self._message_context_key(message_id),
            self.message_context_ttl_seconds,
            json.dumps(payload, ensure_ascii=False)
        )

    async def resolve_state_from_context(self, context_id: Optional[str]) -> Optional[Dict[str, Any]]:
        if not context_id:
            return None
        raw = await self.redis.get(self._message_context_key(context_id))
        if not raw:
            logger.info("Message context not found or expired", extra={"context_id": context_id})
            return None
        try:
            data = json.loads(raw)
            return data
        except Exception as e:
            logger.warning(f"Invalid message context for {context_id}: {e}")
            return None

    def _resolve_next_state(self, current_state: str, user_text: str) -> Optional[str]:
        state_def: Dict[str, Any] = (self.flow or {}).get(current_state, {})
        next_map: Dict[str, str] = state_def.get("next", {})
        if not isinstance(next_map, dict):
            return None

        # Match order: wildcard, exact, normalized exact, case-insensitive
        normalized = (user_text or "").strip()

        if "*" in next_map:
            return next_map["*"]
        if user_text in next_map:
            return next_map[user_text]
        if normalized in next_map:
            return next_map[normalized]
        # case-insensitive compare against normalized keys
        lower_norm = normalized.lower()
        for key, value in next_map.items():
            if isinstance(key, str) and key.strip().lower() == lower_norm:
                return value
        return None

    def _build_outgoing(self, next_state: str, guest_phone: str, event_id: str, template_parameters: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        # Try MessageBuilder config first
        if self.message_builder is not None:
            try:
                message = self.message_builder.build(next_state, event={"id": event_id}, guest={"phone": guest_phone})
                # message_builder returns a structure that may include interactive/text/template shapes
                # Normalize metadata for outpost
                if message.get("interactive"):
                    message["message_type"] = "interactive"
                elif message.get("type") == "text" or message.get("message_type") == "text":
                    message["message_type"] = "text"
                else:
                    message["message_type"] = "template"
                message.setdefault("platform", "WA")
                message.setdefault("recipient", guest_phone)
                message["event_id"] = event_id
                message["state"] = next_state
                return message
            except Exception:
                pass

        # Fallback to simple template reference
        return {
            "platform": "WA",
            "recipient": guest_phone,
            "message_type": "template",
            "template": next_state,
            "parameters": (template_parameters or {}),
            "event_id": event_id,
            "state": next_state,
        }

    async def process_incoming(self,
                               message_type: str,
                               guest_phone: str,
                               text: str,
                               event_id: str,
                               context_id: Optional[str],
                               template_parameters: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, Any], str, str]:
        """Resolve next message given an incoming event.

        Returns (outgoing_payload, prev_state, next_state)
        """
        # 1) Try resolve from context
        prev_state = self.initial_state
        context = await self.resolve_state_from_context(context_id) if context_id else None
        if context and context.get("state"):
            prev_state = context["state"]
            # override event if provided by context
            if context.get("event_id"):
                event_id = context["event_id"]
            logger.info("Using state resolved from message context", extra={"state": prev_state, "context_id": context_id})
        else:
            # 2) Fallback to conversation state
            conv = await self.get_conversation_state(guest_phone, event_id)
            prev_state = conv.get("state", self.initial_state)
            logger.info("Using state from conversation", extra={"state": prev_state})

        # 3) Resolve next
        next_state = self._resolve_next_state(prev_state, text or "")
        if not next_state:
            fallback_state = os.getenv("FALLBACK_TEMPLATE", "didnt_understand")
            next_state = fallback_state

        # 4) Build message
        outgoing = self._build_outgoing(next_state, guest_phone=guest_phone, event_id=event_id, template_parameters=template_parameters)

        # 5) Update conversation immediately (we will store message_context later when we have a temp id)
        new_state_obj = {
            "state": next_state,
            "last_message_id": context_id,  # not the real WA id, but we keep the last inbound for trace
            "last_interaction_at": datetime.now(timezone.utc).isoformat(),
        }
        await self.set_conversation_state(guest_phone, event_id, new_state_obj)

        return outgoing, prev_state, next_state


