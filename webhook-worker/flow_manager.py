import json
import logging
import os
from typing import Any, Dict, Optional, Tuple, Type

import aio_pika
from sqlalchemy import select, insert, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.session import get_session
from db.models import Conversation, MessageLog
from states.base_state import BaseState
from states.rsvp_invite import RsvpInviteState
from states.rsvp_count import RsvpCountState
from states.rsvp_info_question import RsvpInfoQuestionState
from states.note_info import NoteInfoState
from states.rsvp_done import RsvpDoneState
from states.rsvp_update import RsvpUpdateState
from states.rsvp_decline import RsvpDeclineState
from states.didnt_understand import DidntUnderstandState


logger = logging.getLogger("flow_manager")


# -----------------------------
# Base State and concrete states
# -----------------------------


class FreeTextState(BaseState):
    """Fallback handler for incoming messages that don't match any specific state."""
    id = "free_text"

    def get_next_state(self, message: Dict[str, Any]) -> str:
        # FreeTextState is just a fallback - always go to fallback state
        return self.flow.fallback_state_id

    async def send(self, session: AsyncSession, conversation: Conversation) -> Optional[Dict[str, Any]]:
        # FreeTextState should not be used for sending - it's just a fallback handler
        # This should never be called, but if it is, return None
        return None


# -----------------------------
# FlowManager
# -----------------------------


class FlowManager:
    """Owns conversation context, state resolution, persistence, and enqueuing outgoing messages."""

    def __init__(self, outpost_queue: str):
        self.initial_state = os.getenv("CONVERSATION_INITIAL_STATE", "rsvp_invite")
        self.fallback_state_id = os.getenv("FALLBACK_TEMPLATE", "didnt_understand")
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
            logger.info(
                "State transition",
                extra={
                    "current_state": conv.current_state,
                    "input_text": text,
                    "next_state": next_state_id,
                    "handler_next_states": handler.next_states,
                },
            )
            await self.update_conversation(session, conv, next_state_id)
            conv = await self.load_conversation(session, guest_phone, event_id)

            # send via next state's send
            next_handler = self.state_handlers.get(next_state_id, FreeTextState)(self)
            logger.info(
                "Sending message from next state",
                extra={
                    "next_state_id": next_state_id,
                    "next_handler_id": next_handler.id,
                },
            )
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

