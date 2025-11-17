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
from utils.phone import normalize_phone
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
        """
        Load or create a conversation for the given guest_phone and event_id.
        
        The guest_phone is normalized to canonical format before lookup/creation.
        """
        # Normalize guest_phone to ensure consistent lookups
        normalized_guest_phone = normalize_phone(guest_phone)
        if not normalized_guest_phone:
            raise ValueError(f"Cannot load conversation: invalid guest_phone: {guest_phone}")
        
        res = await session.execute(
            select(Conversation).where(
                Conversation.guest_phone == normalized_guest_phone,
                Conversation.event_id == event_id
            )
        )
        conv = res.scalars().first()
        if conv:
            self.current_state = conv.current_state
            return conv
        # Create new conversation with normalized phone
        conv = Conversation(
            guest_phone=normalized_guest_phone,
            event_id=event_id,
            current_state=self.initial_state
        )
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

    async def log_message(
        self,
        session: AsyncSession,
        *,
        conversation_id,
        wa_message_id,
        direction,
        message_type,
        reply_to_id,
        payload,
        state,
        status: Optional[str] = None,
        guest_phone: Optional[str] = None,
    ) -> MessageLog:
        """
        Log a message to messages_log.
        
        If guest_phone is not provided, it will be fetched from the conversation.
        The guest_phone is always normalized to canonical format (digits only, no +, no 00 prefix)
        to ensure consistent lookups.
        """
        # If guest_phone not provided, fetch it from the conversation
        if not guest_phone and conversation_id:
            conv = await session.get(Conversation, conversation_id)
            if conv:
                guest_phone = conv.guest_phone
        
        # Normalize guest_phone to canonical format (digits only)
        # This ensures consistent lookups regardless of how the phone was originally stored
        normalized_guest_phone = normalize_phone(guest_phone)
        
        entry = MessageLog(
            conversation_id=conversation_id,
            guest_phone=normalized_guest_phone,  # Denormalized and normalized for efficient queries
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

    async def _get_latest_active_conversation(self, session: AsyncSession, guest_phone: str) -> Optional[Conversation]:
        """
        Get the most recently updated active conversation for a guest phone number.
        
        This is used as a fallback when no context_id is provided, to determine
        which conversation is "current" for free-text messages when multiple
        conversations exist for the same phone number (different events).
        
        The guest_phone should already be normalized before calling this method.
        """
        # Ensure guest_phone is normalized (defensive check)
        normalized_guest_phone = normalize_phone(guest_phone)
        if not normalized_guest_phone:
            return None
        
        res = await session.execute(
            select(Conversation)
            .where(
                Conversation.guest_phone == normalized_guest_phone,
                Conversation.active == True
            )
            .order_by(Conversation.updated_at.desc())
            .limit(1)
        )
        return res.scalars().first()

    async def resolve_message_from_context(self, session: AsyncSession, context_id: Optional[str]) -> Optional[MessageLog]:
        """
        Resolve message from context_id (wamid) by looking up in MessageLog table.
        
        The context_id is the WhatsApp message ID (wamid) of the original outgoing
        message that the user is replying to.
        """
        if not context_id:
            return None
        res = await session.execute(
            select(MessageLog)
            .where(MessageLog.wa_message_id == context_id)
            .order_by(MessageLog.created_at.desc())
            .limit(1)
        )
        return res.scalars().first()

    async def resolve_conversation(
        self,
        session: AsyncSession,
        guest_phone: Optional[str],
        context_id: Optional[str],
        provided_event_id: Optional[str] = None,
    ) -> Tuple[Optional[Conversation], Optional[str], Optional[str]]:
        """
        Centralized conversation resolution logic.
        
        This method implements a deterministic two-step strategy:
        
        1. **Primary Resolution (by context_id)**: If context_id is provided (reply to a message):
           - Look up the original outgoing message in messages_log using context_id (wamid)
           - From that message, get the conversation_id
           - Return that conversation, its event_id, and the state from the original message
           - This ensures replies are always associated with the correct conversation/event
        
        2. **Fallback Resolution (by guest_phone via last outgoing message)**: If no context_id or step 1 fails:
           - CRITICAL: Query messages_log directly by guest_phone (denormalized field) for efficiency
           - Find the most recent outgoing message (system → guest) where:
             * guest_phone = :guest_phone (normalized, digits only)
             * direction = 'outgoing'
             * Ordered by created_at DESC, limit 1
           - From that message, get:
             * conversation_id → the correct conversation
             * event_id (via conversation) → the correct event
             * state (from message) → the exact state when that message was sent
           - This is the PRIMARY rule for free-text messages (not a recovery fallback)
           - It ensures multi-event scenarios work correctly and the flow continues from where it left off
           - Only if no outgoing messages exist in messages_log, fall back to most recent active conversation by updated_at
        
        This design ensures:
        - Quick replies (with context_id) → always go to the exact conversation/event referenced
        - Free text (no context_id) → continues from the last message sent, preserving flow continuity
        - Multiple events per phone → each conversation is correctly identified by the message flow
        
        Args:
            session: Database session
            guest_phone: Phone number of the guest (will be normalized to canonical format)
            context_id: WhatsApp message ID (wamid) of the message being replied to (if any)
            provided_event_id: Optional event_id from webhook (may be None or invalid)
        
        Returns:
            Tuple of (conversation, event_id, effective_state):
            - conversation: The resolved Conversation object, or None if not found
            - event_id: The event_id (UUID string) associated with the conversation
            - effective_state: The state to use (from original message if context_id, else from last outgoing message)
        """
        # Normalize guest_phone to canonical format (digits only, no +, no 00 prefix)
        # This ensures consistent lookups regardless of how the phone was originally stored
        normalized_guest_phone = normalize_phone(guest_phone)
        if not normalized_guest_phone:
            logger.warning("Cannot resolve conversation: guest_phone is required and must be valid")
            return None, None, None
        
        conversation: Optional[Conversation] = None
        effective_event_id: Optional[str] = None
        effective_state: Optional[str] = None
        
        # Step 1: Try to resolve by context_id (reply to a previous message)
        if context_id:
            logger.info(
                "Attempting to resolve conversation by context_id",
                extra={"context_id": context_id, "guest_phone": normalized_guest_phone}
            )
            
            # Find the original outgoing message that this is a reply to
            context_message = await self.resolve_message_from_context(session, context_id)
            
            if context_message:
                # Get the conversation that the original message belonged to
                conversation = await session.get(Conversation, context_message.conversation_id)
                
                if conversation:
                    # Use the state from the original message (allows replying to old messages)
                    effective_state = context_message.state
                    effective_event_id = conversation.event_id
                    
                    logger.info(
                        "Resolved conversation by context_id",
                        extra={
                            "context_id": context_id,
                            "conversation_id": str(conversation.id),
                            "event_id": effective_event_id,
                            "original_message_state": effective_state,
                            "conversation_current_state": conversation.current_state,
                        }
                    )
                    
                    # Update conversation state to match the original message state if different
                    # This ensures the conversation reflects the state when the original message was sent
                    if effective_state and conversation.current_state != effective_state:
                        await self.update_conversation(session, conversation, effective_state)
                        await session.refresh(conversation)
                    
                    return conversation, effective_event_id, effective_state
                else:
                    logger.warning(
                        "Context message found but conversation not found",
                        extra={
                            "context_id": context_id,
                            "message_log_id": context_message.id,
                            "conversation_id": context_message.conversation_id,
                        }
                    )
            else:
                logger.info(
                    "Context_id provided but message not found in messages_log",
                    extra={"context_id": context_id, "guest_phone": normalized_guest_phone}
                )
        
        # Step 2: Fallback - resolve by guest_phone using most recent outgoing message
        # This handles free-text messages without context_id, or when context_id lookup fails
        # 
        # CRITICAL: For free-text messages, we must use the last outgoing message sent to this phone,
        # not just the most recent conversation by updated_at. This ensures:
        # - We get the correct conversation/event/state from the actual message flow
        # - Multi-event scenarios work correctly (same phone, different events)
        # - The state machine continues from where we left off in the conversation
        # 
        # This is the PRIMARY rule for free-text resolution, not a recovery fallback.
        logger.info(
            "Falling back to resolve conversation by guest_phone (using most recent outgoing message from messages_log)",
            extra={"guest_phone": normalized_guest_phone, "context_id": context_id}
        )
        
        # Query messages_log directly by normalized guest_phone (denormalized field for efficiency)
        # This is the primary free-text resolution path
        # CRITICAL: Use normalized_guest_phone to ensure we match the canonical format stored in DB
        res = await session.execute(
            select(MessageLog)
            .where(
                MessageLog.guest_phone == normalized_guest_phone,
                MessageLog.direction == "outgoing"
            )
            .order_by(MessageLog.created_at.desc())
            .limit(1)
        )
        latest_outgoing_message = res.scalars().first()
        
        if latest_outgoing_message:
            # Get the conversation that this outgoing message belongs to
            conversation = await session.get(Conversation, latest_outgoing_message.conversation_id)
            
            if conversation:
                # Use the state from the outgoing message (not conversation.current_state)
                # This ensures we continue from the exact state when that message was sent
                effective_state = latest_outgoing_message.state
                effective_event_id = conversation.event_id
                
                logger.info(
                    "Resolved conversation by guest_phone (using most recent outgoing message from messages_log)",
                    extra={
                        "guest_phone": normalized_guest_phone,
                        "conversation_id": str(conversation.id),
                        "event_id": effective_event_id,
                        "state_from_message": effective_state,
                        "conversation_current_state": conversation.current_state,
                        "message_created_at": latest_outgoing_message.created_at.isoformat() if latest_outgoing_message.created_at else None,
                        "message_log_id": latest_outgoing_message.id,
                    }
                )
                
                # Update conversation state to match the message state if different
                # This ensures conversation.current_state reflects where we are in the flow
                if effective_state and conversation.current_state != effective_state:
                    await self.update_conversation(session, conversation, effective_state)
                    await session.refresh(conversation)
                
                return conversation, effective_event_id, effective_state
            else:
                logger.warning(
                    "Found outgoing message but conversation not found",
                    extra={
                        "guest_phone": normalized_guest_phone,
                        "message_log_id": latest_outgoing_message.id,
                        "conversation_id": latest_outgoing_message.conversation_id,
                    }
                )
        else:
            logger.info(
                "No outgoing messages found in messages_log for guest_phone",
                extra={"guest_phone": normalized_guest_phone}
            )
        
        # If no outgoing message found, try fallback to most recent active conversation
        # This is a last resort when no messages have been logged yet
        logger.info(
            "No outgoing messages found in messages_log, trying fallback to most recent active conversation",
            extra={"guest_phone": normalized_guest_phone}
        )
        
        conversation = await self._get_latest_active_conversation(session, normalized_guest_phone)
        
        if conversation:
            effective_event_id = conversation.event_id
            effective_state = conversation.current_state
            
            logger.info(
                "Resolved conversation by guest_phone (fallback: most recent active conversation)",
                extra={
                    "guest_phone": normalized_guest_phone,
                    "conversation_id": str(conversation.id),
                    "event_id": effective_event_id,
                    "state": effective_state,
                    "updated_at": conversation.updated_at.isoformat() if conversation.updated_at else None,
                }
            )
            
            return conversation, effective_event_id, effective_state
        
        # No conversation found at all
        logger.warning(
            "Could not resolve conversation: no active conversation found for guest_phone",
            extra={
                "guest_phone": normalized_guest_phone,
                "original_guest_phone": guest_phone,
                "context_id": context_id,
                "provided_event_id": provided_event_id,
            }
        )
        
        return None, None, None

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
        if not guest_phone:
            logger.warning("Missing guest_phone; skipping")
            return

        async for session in get_session():
            logger.info(
                f"handle_event start: type={message_type} guest={guest_phone} event_id={event_id} context={context_id}",
            )
            
            # Use centralized conversation resolution logic
            # This implements the two-step strategy:
            # 1. First try to resolve by context_id (reply to a message)
            # 2. Fall back to most recent active conversation by guest_phone
            conv, effective_event_id, effective_state = await self.resolve_conversation(
                session=session,
                guest_phone=guest_phone,
                context_id=context_id,
                provided_event_id=event_id,
            )
            
            # If no conversation was resolved, we cannot proceed
            if not conv or not effective_event_id:
                logger.warning(
                    "Could not resolve conversation for incoming message; skipping",
                    extra={
                        "guest_phone": guest_phone,
                        "context_id": context_id,
                        "provided_event_id": event_id,
                    },
                )
                return
            
            # Ensure we have an effective_state
            if not effective_state:
                effective_state = conv.current_state
            
            self.current_state = effective_state

            # Use effective_state (from original message) instead of conversation.current_state
            handler_cls = self.state_handlers.get(effective_state, FreeTextState)
            handler = handler_cls(self)

            logger.info(
                "Processing message",
                extra={
                    "effective_state": effective_state,
                    "conversation_current_state": conv.current_state,
                    "handler_id": handler.id,
                    "handler_next_states": handler.next_states,
                    "input_text": text,
                    "input_text_repr": repr(text),
                    "input_text_bytes": text.encode('utf-8') if text else b'',
                    "input_text_len": len(text) if text else 0,
                    "context_id": context_id,
                    "event_id": effective_event_id,
                    "text_in_next_states": text in handler.next_states if text else False,
                    "wildcard_in_next_states": "*" in handler.next_states,
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
                state=effective_state,  # Log with effective_state (from original message)
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

    async def handle_status_update(
        self,
        *,
        wa_message_id: Optional[str],
        status_payload: Dict[str, Any],
        guest_phone: Optional[str],
        event_id: Optional[str],
    ) -> None:
        """
        Handle WhatsApp status updates (sent, delivered, read, etc.).
        
        Uses the same conversation resolution strategy as handle_event:
        - First tries to resolve by wa_message_id (context_id equivalent)
        - Falls back to most recent active conversation by guest_phone
        """
        status_value = status_payload.get("status")
        status_wa_id = status_payload.get("id") or wa_message_id

        async for session in get_session():
            conversation: Optional[Conversation] = None
            message_entry: Optional[MessageLog] = None

            # Use centralized resolution: try by wa_message_id first (like context_id)
            if status_wa_id:
                logger.info(
                    "Attempting to resolve conversation for status update by wa_message_id",
                    extra={"wa_message_id": status_wa_id, "guest_phone": guest_phone}
                )
                
                # Find the message log entry for this WhatsApp message ID
                res = await session.execute(
                    select(MessageLog)
                    .where(MessageLog.wa_message_id == status_wa_id)
                    .order_by(MessageLog.created_at.desc())
                    .limit(1)
                )
                message_entry = res.scalars().first()
                
                if message_entry:
                    # Get the conversation that this message belongs to
                    conversation = await session.get(Conversation, message_entry.conversation_id)
                    if conversation:
                        logger.info(
                            "Resolved conversation for status update by wa_message_id",
                            extra={
                                "wa_message_id": status_wa_id,
                                "conversation_id": str(conversation.id),
                                "event_id": conversation.event_id,
                            }
                        )

            # Fallback: if no conversation found by wa_message_id, use guest_phone
            if not conversation and guest_phone:
                logger.info(
                    "Falling back to resolve conversation for status update by guest_phone",
                    extra={"guest_phone": guest_phone, "wa_message_id": status_wa_id}
                )
                conversation = await self._get_latest_active_conversation(session, guest_phone)
                if conversation:
                    logger.info(
                        "Resolved conversation for status update by guest_phone (most recent active)",
                        extra={
                            "guest_phone": guest_phone,
                            "conversation_id": str(conversation.id),
                            "event_id": conversation.event_id,
                        }
                    )

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

