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

    async def log_message(self, session: AsyncSession, *, conversation_id, wa_message_id, direction, message_type, reply_to_id, payload, state, status: Optional[str] = None) -> MessageLog:
        entry = MessageLog(
            conversation_id=conversation_id,
            wa_message_id=wa_message_id,
            direction=direction,
            message_type=message_type,
            reply_to_id=reply_to_id,
            payload=payload,
            state=state,
            status=status,
        )
        session.add(entry)
        await session.commit()
        await session.refresh(entry)
        return entry

    async def _get_latest_conversation(self, session: AsyncSession, guest_phone: str) -> Optional[Conversation]:
        res = await session.execute(
            select(Conversation)
            .where(Conversation.guest_phone == guest_phone)
            .order_by(Conversation.updated_at.desc())
            .limit(1)
        )
        return res.scalars().first()

    async def resolve_message_from_context(self, session: AsyncSession, context_id: Optional[str]) -> Optional[MessageLog]:
        """Resolve message from context_id (wamid) by looking up in MessageLog table."""
        if not context_id:
            return None
        
        # Look up in MessageLog by wa_message_id
        res = await session.execute(
            select(MessageLog)
            .where(MessageLog.wa_message_id == context_id)
            .order_by(MessageLog.created_at.desc())
            .limit(1)
        )
        msg_log = res.scalars().first()
        
        if msg_log:
            logger.info(
                "Resolved message from context",
                extra={
                    "context_id": context_id,
                    "message_log_id": msg_log.id,
                    "message_log_state": msg_log.state,
                    "conversation_id": str(msg_log.conversation_id),
                }
            )
        
        return msg_log

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
        template_parameters: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Handle incoming webhook event.
        
        Resolution logic:
        1. If context_id exists (quick_reply to old message):
           - Find MessageLog by wa_message_id in Postgres
           - Get conversation_id from MessageLog
           - Get event_id from Conversation (this is the real event UUID)
           - Use the state from MessageLog to resume the flow from that point
        2. If no context_id (free_text):
           - Find latest conversation by guest_phone
           - Use its event_id
        3. If no conversation found and no event_id:
           - Skip (cannot create conversation without event_id)
        """
        if not guest_phone:
            logger.warning("Missing guest_phone; skipping")
            return

        async for session in get_session():
            try:
                logger.info(
                    f"handle_event start: type={message_type} guest={guest_phone} event_id={event_id} context={context_id}",
                )
                conv: Optional[Conversation] = None
                effective_event_id: Optional[str] = None

                # Step 1: Try to resolve from context_id (quick_reply to old message)
                context_state: Optional[str] = None  # State from the original message
                if context_id:
                    context_entry = await self.resolve_message_from_context(session, context_id)
                    if context_entry:
                        # Check if context_entry has an id (it might be a TempMessageLog)
                        entry_id = getattr(context_entry, 'id', None)
                        logger.info(
                            "Found context entry",
                            extra={
                                "context_id": context_id,
                                "message_log_id": entry_id,
                                "message_log_state": context_entry.state,
                                "message_log_direction": getattr(context_entry, 'direction', None),
                                "message_log_type": getattr(context_entry, 'message_type', None),
                                "conversation_id": str(context_entry.conversation_id),
                            },
                        )
                        conv = await session.get(Conversation, context_entry.conversation_id)
                        if conv:
                            # Validate that event_id is a UUID (not wamid)
                            # If it's a UUID, use it; otherwise, it's invalid
                            try:
                                import uuid
                                uuid.UUID(conv.event_id)
                                effective_event_id = conv.event_id
                                # Use the state from the original message (context_entry.state)
                                # This allows replying to old messages and resuming from that state
                                if context_entry.state:
                                    context_state = context_entry.state
                                    logger.info(
                                        "Using state from context entry",
                                        extra={
                                            "context_state": context_state,
                                            "conversation_current_state": conv.current_state,
                                        },
                                    )
                                    # Update conversation state to match the original message state
                                    if conv.current_state != context_entry.state:
                                        logger.info(
                                            "Updating conversation state to match context",
                                            extra={
                                                "old_state": conv.current_state,
                                                "new_state": context_entry.state,
                                            },
                                        )
                                        await self.update_conversation(session, conv, context_entry.state)
                                        await session.refresh(conv)
                                else:
                                    logger.warning(
                                        "Context entry has no state",
                                        extra={
                                            "context_id": context_id,
                                            "message_log_id": entry_id,
                                            "conversation_id": conv.id,
                                        },
                                    )
                                logger.info(
                                    "Resolved conversation from context",
                                    extra={
                                        "context_id": context_id,
                                        "conversation_id": conv.id,
                                        "original_state": context_entry.state,
                                        "context_state": context_state,
                                        "conversation_state": conv.current_state,
                                        "event_id": effective_event_id,
                                    },
                                )
                            except (ValueError, AttributeError):
                                logger.warning(
                                    f"Conversation.event_id is not a valid UUID: {conv.event_id}, skipping",
                                    extra={"conversation_id": conv.id, "context_id": context_id}
                                )
                                conv = None
                                effective_event_id = None
                                context_state = None
                

                # Step 2: If no context resolution, try latest conversation (free_text)
                if not conv and not effective_event_id:
                    latest_conv = await self._get_latest_conversation(session, guest_phone)
                    if latest_conv:
                        # Validate event_id is UUID
                        try:
                            import uuid
                            uuid.UUID(latest_conv.event_id)
                            conv = latest_conv
                            effective_event_id = latest_conv.event_id
                            logger.info(
                                "Resolved from latest conversation",
                                extra={
                                    "guest_phone": guest_phone,
                                    "event_id": effective_event_id,
                                    "state": conv.current_state,
                                },
                            )
                        except (ValueError, AttributeError):
                            logger.warning(f"Latest conversation has invalid event_id: {latest_conv.event_id}")

                # Step 3: If still no event_id, cannot proceed
                if not effective_event_id:
                    logger.warning(
                        "Could not resolve event_id (UUID) for incoming message; skipping",
                        extra={"guest_phone": guest_phone, "context_id": context_id, "provided_event_id": event_id},
                    )
                    return

                # Step 4: Load or create conversation
                if not conv:
                    conv = await self.load_conversation(session, guest_phone, effective_event_id)
                    logger.info(
                        "Created/loaded conversation",
                        extra={
                            "conversation_id": conv.id,
                            "guest_phone": guest_phone,
                            "event_id": effective_event_id,
                            "state": conv.current_state,
                        },
                    )
                else:
                    self.current_state = conv.current_state

                # Use context_state if available (from old message), otherwise use conversation.current_state
                effective_state = context_state if context_state else conv.current_state
                handler_cls = self.state_handlers.get(effective_state, FreeTextState)
                handler = handler_cls(self)
                
                logger.info(
                    "State resolution",
                    extra={
                        "context_state": context_state,
                        "conversation_state": conv.current_state,
                        "effective_state": effective_state,
                        "handler_id": handler.id,
                    },
                )

                logger.info(
                    "Processing message",
                    extra={
                        "effective_state": effective_state,
                        "conversation_state": conv.current_state,
                        "handler_id": handler.id,
                        "handler_next_states": handler.next_states,
                        "input_text": text,
                        "context_id": context_id,
                        "event_id": effective_event_id,
                    },
                )

                await self.log_message(
                    session,
                    conversation_id=conv.id,
                    wa_message_id=raw.get("message_id"),
                    direction="incoming",
                    message_type=message_type,
                    reply_to_id=(raw.get("payload", {}).get("context", {}).get("id") if isinstance(raw.get("payload"), dict) else None),
                    payload=json.dumps(raw, ensure_ascii=False)[:4000],
                    state=effective_state,
                )

                await handler.process_incoming(session, {"text": text, "raw": raw}, conv)
                next_state_id = handler.get_next_state({"text": text, "raw": raw})

                logger.info(
                    "State transition",
                    extra={
                        "current_state": conv.current_state,
                        "handler_id": handler.id,
                        "input_text": repr(text),
                        "input_text_len": len(text),
                        "next_state": next_state_id,
                        "handler_next_states": handler.next_states,
                        "matched_key": text if text in handler.next_states else ("*" if "*" in handler.next_states else None),
                    },
                )

                if next_state_id not in self.state_handlers:
                    logger.error(
                        f"Next state {next_state_id} not found in state_handlers, falling back to {self.fallback_state_id}",
                        extra={"available_states": list(self.state_handlers.keys())},
                    )
                    next_state_id = self.fallback_state_id

                await self.update_conversation(session, conv, next_state_id)
                await session.refresh(conv)

                logger.info(
                    "Conversation updated",
                    extra={
                        "new_state": conv.current_state,
                        "expected_next_state": next_state_id,
                        "states_match": conv.current_state == next_state_id,
                    },
                )

                next_handler = self.state_handlers.get(next_state_id, FreeTextState)(self)
                logger.info(
                    "Sending message from next state",
                    extra={
                        "next_state_id": next_state_id,
                        "next_handler_id": next_handler.id,
                        "next_handler_type": type(next_handler).__name__,
                    },
                )
                outgoing = await next_handler.send(session, conv)
                if outgoing:
                    # Save outgoing message with the state it was sent FROM (effective_state),
                    # not the state it transitions TO (next_state_id).
                    # This allows context resolution to find the correct state when user replies.
                    await self.log_message(
                        session,
                        conversation_id=conv.id,
                        wa_message_id=None,  # Will be updated when status update arrives
                        direction="outgoing",
                        message_type=outgoing.get("message_type", "template"),
                        reply_to_id=None,
                        payload=json.dumps(outgoing, ensure_ascii=False)[:4000],
                        state=effective_state,  # State FROM which message was sent
                    )
                    await self.publish_outgoing(outgoing)
            except Exception as e:
                # Rollback transaction on error
                await session.rollback()
                logger.error(
                    f"Error handling event: {e}",
                    extra={
                        "message_type": message_type,
                        "guest_phone": guest_phone,
                        "context_id": context_id,
                        "error": str(e),
                    },
                    exc_info=True,
                )
                raise

    async def handle_status_update(
        self,
        *,
        wa_message_id: Optional[str],
        status_payload: Dict[str, Any],
        guest_phone: Optional[str],
        event_id: Optional[str],
    ) -> None:
        status_value = status_payload.get("status")
        status_wa_id = status_payload.get("id")

        async for session in get_session():
            conversation: Optional[Conversation] = None
            message_entry: Optional[MessageLog] = None

            # 1) Try to locate message by explicit WA id (context id)
            if wa_message_id:
                res = await session.execute(
                    select(MessageLog).where(MessageLog.wa_message_id == wa_message_id).order_by(MessageLog.created_at.desc()).limit(1)
                )
                message_entry = res.scalars().first()
                if message_entry:
                    conv_res = await session.execute(
                        select(Conversation).where(Conversation.id == message_entry.conversation_id)
                    )
                    conversation = conv_res.scalars().first()

            if not conversation and guest_phone:
                conversation = await self._get_latest_conversation(session, guest_phone)

            if not conversation:
                logger.warning(
                    "Status update received but conversation not found",
                    extra={"wa_message_id": wa_message_id or status_wa_id, "guest_phone": guest_phone, "status": status_value},
                )
                return

            # 2) If we found conversation but not specific message, try to link to latest outgoing without WA id yet
            if not message_entry:
                res = await session.execute(
                    select(MessageLog)
                    .where(
                        MessageLog.conversation_id == conversation.id,
                        MessageLog.direction == "outgoing",
                    )
                    .order_by(MessageLog.created_at.desc())
                    .limit(1)
                )
                message_entry = res.scalars().first()
                # attach WA id if missing
                if message_entry and not message_entry.wa_message_id and status_wa_id:
                    message_entry.wa_message_id = status_wa_id

            if message_entry:
                if status_value:
                    message_entry.status = status_value
                if status_wa_id and not message_entry.wa_message_id:
                    message_entry.wa_message_id = status_wa_id
                await session.commit()

            state_for_status = (
                message_entry.state if message_entry and message_entry.state else conversation.current_state
            )

            await self.log_message(
                session,
                conversation_id=conversation.id,
                wa_message_id=wa_message_id,
                direction="status",
                message_type="status",
                reply_to_id=wa_message_id,
                payload=json.dumps(status_payload, ensure_ascii=False),
                state=state_for_status,
                status=status_value,
            )

