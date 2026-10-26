import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Type

import aio_pika
from sqlalchemy import select, update, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.session import AsyncSessionLocal, engine
from db.models import Conversation, MessageLog
from shared.domain.delivery import (
    REPLY_BY_RECENCY_SQL,
    REPLY_BY_WAMID_SQL,
    MessageDeliveryStatus,
    canonical_phone_digits,
    canonical_phone_sql,
    status_rank,
    status_rank_sql,
)
from shared.domain.enums import RsvpAction
from shared.domain.rsvp import resolve_rsvp_action
from shared.domain.optout import is_opt_in_text, is_opt_out_text
from states.base_state import BaseState, load_flow_config
from utils.phone import mask_phone, normalize_phone
from states.rsvp_invite import RsvpInviteState
from states.rsvp_count import RsvpCountState, RsvpCountRetryState
from states.rsvp_info_question import RsvpInfoQuestionState
from states.note_info import NoteInfoState
from states.rsvp_done import RsvpDoneState
from states.rsvp_update import RsvpUpdateState
from states.rsvp_decline import RsvpDeclineState
from states.rsvp_maybe import RsvpMaybeState
from states.didnt_understand import DidntUnderstandState
from states.question_answer import (
    QANS_PREFIX,
    QUESTION_STATES,
    QuestionAnswerRetryState,
    QuestionAnswerState,
    fetch_field,
    fetch_pending_question,
    parse_answer_id,
    resolve_guest_id,
    store_answer,
)


logger = logging.getLogger("flow_manager")

# Advisory-lock namespace for "one inbound message per guest phone at a time".
# Two-key form so it can never collide with other advisory-lock users.
GUEST_LOCK_NAMESPACE = 7301

# Meta only allows free-form (non-template) replies within 24h of the guest's
# last message. Anything older (a backlog drained after an outage) is still
# APPLIED (the RSVP is recorded) but we don't try to answer it.
STALE_REPLY_SECONDS = int(os.getenv("WEBHOOK_STALE_REPLY_SECONDS", str(23 * 3600)))

# States that are waiting for the guest to TYPE something. If the guest is
# mid-way through one of these on one event, their next free text belongs to it
# even if they are invited to other events too.
FREE_TEXT_STATES = {"rsvp_count", "rsvp_count_retry", "note_info", *QUESTION_STATES}
HOT_CONVERSATION_SECONDS = 2 * 3600
# States in which a typed decline/maybe is re-applied through RsvpInviteState.
TYPED_CHANGE_OF_HEART_STATES = {"rsvp_done", "rsvp_info_question", "rsvp_update", "rsvp_count", "rsvp_count_retry"}

# already_answered.behavior == "acknowledge": a template tap that repeats the
# answer the guest is already in gets an acknowledgement instead of a re-run.
# A DIFFERENT answer is always applied (that is a change of heart).
ACK_STATES = {
    RsvpAction.CONFIRMED: {"rsvp_done", "rsvp_update"},
    RsvpAction.DECLINED: {"rsvp_decline"},
    RsvpAction.MAYBE: {"rsvp_maybe"},
}

EVENT_CHOICE_PREFIX = "evsel__"

# Host questions ("שאלות לאורחים") are asked between the party size and
# rsvp_info_question. From these states, a transition to rsvp_info_question /
# question_answer goes through the question gate (next pending question or on).
QUESTION_ENTRY_STATES = {"rsvp_count", "rsvp_count_retry", *QUESTION_STATES}
QUESTION_GATE_TARGETS = {"rsvp_info_question", *QUESTION_STATES}
PENDING_CHOICE_TTL_SECONDS = 24 * 3600
SEEN_RETENTION_DAYS = 14

RSVP_ACTIONS = (RsvpAction.CONFIRMED, RsvpAction.DECLINED, RsvpAction.MAYBE)

# messages_log.status ladder: Meta's 'sent' is our 'accepted'.
_LOG_STATUS_ALIASES = {"sent": MessageDeliveryStatus.ACCEPTED.value}


def _log_status_rank(status: Optional[str]) -> int:
    s = str(status or "")
    return status_rank(_LOG_STATUS_ALIASES.get(s, s))


class FreeTextState(BaseState):
    """Fallback handler for incoming messages that don't match any specific state."""
    id = "free_text"

    def get_next_state(self, message: Dict[str, Any]) -> str:
        return self.flow.fallback_state_id

    async def send(self, session: AsyncSession, conversation: Conversation) -> Optional[Dict[str, Any]]:
        return None


class FlowManager:
    """Owns conversation context, state resolution, persistence, and enqueuing outgoing messages."""

    def __init__(self, outpost_queue: str):
        self.initial_state = os.getenv("CONVERSATION_INITIAL_STATE", "rsvp_invite")
        self.fallback_state_id = os.getenv("FALLBACK_TEMPLATE", "didnt_understand")
        self.outpost_queue = outpost_queue
        # Optional: phone number of secondary bot for users without an active conversation
        self.secondary_bot_phone = os.getenv("SECONDARY_BOT_PHONE")
        self.publisher_channel: Optional[aio_pika.abc.AbstractChannel] = None
        self.publisher_routing_key: Optional[str] = None

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
            "rsvp_count_retry": RsvpCountRetryState,
            "rsvp_info_question": RsvpInfoQuestionState,
            "note_info": NoteInfoState,
            "rsvp_done": RsvpDoneState,
            "rsvp_update": RsvpUpdateState,
            "rsvp_decline": RsvpDeclineState,
            "rsvp_maybe": RsvpMaybeState,
            "didnt_understand": DidntUnderstandState,
            "question_answer": QuestionAnswerState,
            "question_answer_retry": QuestionAnswerRetryState,
        }
        # Kept for backwards compatibility with states that read it; never used
        # for routing (it was shared mutable state across concurrent messages).
        self.current_state: str = self.initial_state

    def attach_publisher(self, channel: aio_pika.abc.AbstractChannel, routing_key: str) -> None:
        self.publisher_channel = channel
        self.publisher_routing_key = routing_key

    # ------------------------------------------------------------------
    # Idempotency + per-guest serialization
    # ------------------------------------------------------------------

    async def _claim(self, key: str, kind: str) -> bool:
        """Claim an inbound item for processing. False = already fully applied."""
        async with AsyncSessionLocal() as s:
            res = await s.execute(
                text(
                    """
                    INSERT INTO inbound_seen (wamid, kind) VALUES (:k, :kind)
                    ON CONFLICT (wamid) DO UPDATE
                        SET attempts = inbound_seen.attempts + 1
                        WHERE inbound_seen.done_at IS NULL
                    RETURNING attempts
                    """
                ),
                {"k": key, "kind": kind},
            )
            row = res.first()
            await s.commit()
            return row is not None

    async def _mark_done(self, key: str) -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(text("UPDATE inbound_seen SET done_at = now() WHERE wamid = :k"), {"k": key})
            await s.commit()

    async def cleanup_seen(self) -> None:
        async with AsyncSessionLocal() as s:
            res = await s.execute(
                text(f"DELETE FROM inbound_seen WHERE seen_at < now() - interval '{SEEN_RETENTION_DAYS} days'")
            )
            await s.execute(
                text("DELETE FROM inbound_pending_choice WHERE created_at < now() - interval '2 days'")
            )
            await s.commit()
            if res.rowcount:
                logger.info("inbound_seen cleanup removed %d row(s)", res.rowcount)

    async def handle_inbound(self, *, wamid: Optional[str], guest_phone: Optional[str], **kwargs: Any) -> None:
        """Entry point for a guest message: serialize per phone, dedupe by wamid.

        The per-guest lock is a SESSION-level advisory lock held on a dedicated
        pooled connection for the whole handling. A transaction-level
        (pg_advisory_xact_lock) lock would not work here: the state machine
        commits several times while handling one message, and each commit would
        release it. With prefetch>1, "מגיע" followed immediately by "3" would
        otherwise race and lose the party size.
        """
        if not guest_phone:
            logger.warning("Missing guest_phone; skipping")
            return
        lock_key = canonical_phone_digits(guest_phone) or guest_phone
        async with engine.connect() as lock_conn:
            await lock_conn.execute(
                text("SELECT pg_advisory_lock(:ns, hashtext(:p))"),
                {"ns": GUEST_LOCK_NAMESPACE, "p": lock_key},
            )
            await lock_conn.commit()
            try:
                if wamid and not await self._claim(wamid, "message"):
                    logger.info("Duplicate inbound %s - already processed, skipping", wamid)
                    return
                await self.handle_event(guest_phone=guest_phone, **kwargs)
                if wamid:
                    await self._mark_done(wamid)
            finally:
                try:
                    await lock_conn.execute(
                        text("SELECT pg_advisory_unlock(:ns, hashtext(:p))"),
                        {"ns": GUEST_LOCK_NAMESPACE, "p": lock_key},
                    )
                    await lock_conn.commit()
                except Exception as exc:
                    # Never return a connection that may still hold the lock.
                    logger.warning("advisory unlock failed, invalidating connection: %s", exc)
                    await lock_conn.invalidate()

    # ------------------------------------------------------------------
    # Conversation/Message persistence
    # ------------------------------------------------------------------

    async def update_conversation(self, session: AsyncSession, conv: Conversation, new_state: str) -> None:
        await session.execute(
            update(Conversation)
            .where(Conversation.id == conv.id)
            .values(current_state=new_state, updated_at=datetime.now(timezone.utc))
        )
        await session.commit()

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
        """Log a message to messages_log (guest_phone normalized, digits only)."""
        if not guest_phone and conversation_id:
            conv = await session.get(Conversation, conversation_id)
            if conv:
                guest_phone = conv.guest_phone
        entry = MessageLog(
            conversation_id=conversation_id,
            guest_phone=normalize_phone(guest_phone),
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
        normalized_guest_phone = normalize_phone(guest_phone)
        if not normalized_guest_phone:
            return None
        res = await session.execute(
            select(Conversation)
            .where(Conversation.guest_phone == normalized_guest_phone, Conversation.active == True)  # noqa: E712
            .order_by(Conversation.updated_at.desc())
            .limit(1)
        )
        return res.scalars().first()

    async def resolve_message_from_context(self, session: AsyncSession, context_id: Optional[str]) -> Optional[MessageLog]:
        """The outgoing messages_log row (by wamid) the guest is replying to."""
        if not context_id:
            return None
        res = await session.execute(
            select(MessageLog)
            .where(MessageLog.wa_message_id == context_id, MessageLog.direction == "outgoing")
            .order_by(MessageLog.created_at.desc())
            .limit(1)
        )
        return res.scalars().first()

    async def _conversation_from_messages_sent(
        self, session: AsyncSession, guest_phone: str, context_id: str
    ) -> Optional[Conversation]:
        """Campaign message the guest replied to -> its event -> the conversation.

        Covers template sends that outpost recorded in messages_sent (with the
        wamid) but not in messages_log.
        """
        res = await session.execute(
            text(
                """
                SELECT c.event_id::text
                FROM messages_sent ms
                JOIN campaigns c ON c.id::text = ms.campaign_id::text
                WHERE ms.wa_message_id = :wamid
                LIMIT 1
                """
            ),
            {"wamid": context_id},
        )
        row = res.first()
        if not row or not row[0]:
            return None
        res = await session.execute(
            select(Conversation)
            .where(
                Conversation.guest_phone == guest_phone,
                Conversation.event_id == row[0],
                Conversation.active == True,  # noqa: E712
            )
            .order_by(Conversation.updated_at.desc())
            .limit(1)
        )
        return res.scalars().first()

    async def _open_conversations(self, session: AsyncSession, guest_phone: str) -> List[Dict[str, Any]]:
        """Active conversations of this phone whose event is still ahead.

        Each row: {conv, event_name, event_date, last_out_at, last_out_state}.
        Events that already happened (with a day of slack) or were
        cancelled/archived are not "open" - a guest is no longer answering them.
        """
        res = await session.execute(
            text(
                """
                SELECT c.id,
                       e.name,
                       e.event_date,
                       (SELECT ml.created_at FROM messages_log ml
                         WHERE ml.conversation_id = c.id AND ml.direction = 'outgoing'
                         ORDER BY ml.created_at DESC LIMIT 1) AS last_out_at
                FROM conversations c
                JOIN events e ON e.id::text = c.event_id
                WHERE c.guest_phone = :phone
                  AND c.active = TRUE
                  AND (e.event_date IS NULL OR e.event_date >= now() - interval '1 day')
                  AND COALESCE(e.state, 'active') NOT IN ('cancelled', 'archived', 'completed')
                ORDER BY e.event_date NULLS LAST
                """
            ),
            {"phone": guest_phone},
        )
        rows = res.all()
        out: List[Dict[str, Any]] = []
        for conv_id, name, event_date, last_out_at in rows:
            conv = await session.get(Conversation, conv_id)
            if conv is not None:
                out.append({"conv": conv, "event_name": name or "האירוע", "event_date": event_date,
                            "last_out_at": last_out_at})
        return out

    async def resolve_conversation(
        self,
        session: AsyncSession,
        guest_phone: Optional[str],
        context_id: Optional[str],
        provided_event_id: Optional[str] = None,
    ) -> Tuple[Optional[Conversation], Optional[str], Optional[str], List[Dict[str, Any]]]:
        """Which conversation (event) does this inbound message belong to?

        Returns (conversation, event_id, effective_state, ambiguous_candidates).
        When `ambiguous_candidates` is non-empty the caller must ASK the guest
        which event they mean (conversation is None then).

        1. Reply to a specific message (context wamid): the conversation that
           message was logged under (messages_log), else the campaign that sent
           it (messages_sent -> campaign -> event). The state is the one the
           replied-to message was sent in, so a reply to an old message still
           means what it meant then.
        2. Free text: the guest's OPEN conversations (active, event ahead).
           Exactly one -> it. Several -> the one they are in the middle of
           typing into (a FREE_TEXT_STATES prompt sent within the last 2h, most
           recent wins); otherwise ambiguous. Guessing "the latest outgoing
           message" here used to file event B's answer under event A.
        3. No open conversation: legacy fallback - latest outgoing message,
           then latest active conversation (events that already passed).
        """
        phone = normalize_phone(guest_phone)
        if not phone:
            logger.warning("Cannot resolve conversation: guest_phone is required and must be valid")
            return None, None, None, []

        # Step 1: reply to a specific message.
        if context_id:
            context_message = await self.resolve_message_from_context(session, context_id)
            if context_message:
                conversation = await session.get(Conversation, context_message.conversation_id)
                if conversation and conversation.guest_phone == phone:
                    state = context_message.state or conversation.current_state
                    logger.info("Resolved conversation by context wamid", extra={
                        "conversation_id": str(conversation.id), "event_id": conversation.event_id, "state": state,
                    })
                    return conversation, conversation.event_id, state, []
            conversation = await self._conversation_from_messages_sent(session, phone, context_id)
            if conversation:
                logger.info("Resolved conversation by messages_sent wamid", extra={
                    "conversation_id": str(conversation.id), "event_id": conversation.event_id,
                })
                return conversation, conversation.event_id, conversation.current_state, []

        # Step 2: open conversations for this phone.
        open_convs = await self._open_conversations(session, phone)
        if len(open_convs) == 1:
            conv = open_convs[0]["conv"]
            return conv, conv.event_id, conv.current_state, []
        if len(open_convs) > 1:
            now = datetime.now(timezone.utc)
            hot = [
                c for c in open_convs
                if c["conv"].current_state in FREE_TEXT_STATES
                and c["last_out_at"] is not None
                and (now - c["last_out_at"]).total_seconds() <= HOT_CONVERSATION_SECONDS
            ]
            if hot:
                hot.sort(key=lambda c: c["last_out_at"], reverse=True)
                conv = hot[0]["conv"]
                logger.info("Resolved multi-event free text to the conversation awaiting input",
                            extra={"conversation_id": str(conv.id), "event_id": conv.event_id})
                return conv, conv.event_id, conv.current_state, []
            return None, None, None, open_convs

        # Step 3: legacy fallback (no open event).
        res = await session.execute(
            select(MessageLog)
            .where(MessageLog.guest_phone == phone, MessageLog.direction == "outgoing")
            .order_by(MessageLog.created_at.desc())
            .limit(1)
        )
        latest_outgoing = res.scalars().first()
        if latest_outgoing:
            conversation = await session.get(Conversation, latest_outgoing.conversation_id)
            if conversation:
                return conversation, conversation.event_id, latest_outgoing.state or conversation.current_state, []
        conversation = await self._get_latest_active_conversation(session, phone)
        if conversation:
            return conversation, conversation.event_id, conversation.current_state, []

        logger.warning("Could not resolve conversation for guest %s", mask_phone(phone))
        return None, None, None, []

    # ------------------------------------------------------------------
    # Publishing
    # ------------------------------------------------------------------

    async def publish_outgoing(self, payload: Dict[str, Any]) -> None:
        """Publish a reply to outpost's priority queue. Raises if not confirmed."""
        if not self.publisher_channel or not self.publisher_routing_key:
            raise RuntimeError("Publisher not attached; cannot enqueue outgoing")
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        await self.publisher_channel.default_exchange.publish(
            aio_pika.Message(body=body, delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                             content_type="application/json"),
            routing_key=self.publisher_routing_key,
        )
        logger.info("Enqueued outgoing reply", extra={
            "state": payload.get("state"), "recipient": mask_phone(payload.get("recipient")),
            "queue": self.publisher_routing_key,
        })

    # ------------------------------------------------------------------
    # Public entry
    # ------------------------------------------------------------------

    async def handle_event(
        self,
        *,
        message_type: str,
        guest_phone: Optional[str],
        event_id: Optional[str],
        text: str,
        raw: Dict[str, Any],
        context_id: Optional[str],
        button_id: Optional[str] = None,
        button_payload: Optional[str] = None,
        reply_kind: Optional[str] = None,
        template_parameters: Optional[Dict[str, Any]] = None,
        sent_ts: Optional[int] = None,
    ) -> None:
        if not guest_phone:
            logger.warning("Missing guest_phone; skipping")
            return
        phone = normalize_phone(guest_phone)
        stale = bool(sent_ts and (time.time() - sent_ts) > STALE_REPLY_SECONDS)
        if stale:
            logger.info("Inbound message is older than %ss - will apply but not reply", STALE_REPLY_SECONDS)

        async with AsyncSessionLocal() as session:
            # Opt-out is checked BEFORE the RSVP state machine. A guest replying
            # STOP is making a compliance request, not an RSVP.
            if is_opt_out_text(text):
                await self._apply_opt_out(session, phone, opted_out=True, reason=str(text)[:200])
                if not stale:
                    # Phone-level (no event yet): the GLOBAL flow setting only.
                    opt_out_cfg = await load_flow_config(None)
                    await self.publish_outgoing({
                        "platform": "WA",
                        "message_type": "free_text",
                        "recipient": phone,
                        "text": opt_out_cfg.get("opt_out.text"),
                        "state": "opted_out",
                        "source": "opt_out_ack",
                    })
                return

            if is_opt_in_text(text):
                await self._apply_opt_out(session, phone, opted_out=False, reason=str(text)[:200])
                # Fall through: treat the rest of the conversation normally.

            # The guest picked an event from our "which event?" question.
            if button_id and str(button_id).startswith(EVENT_CHOICE_PREFIX):
                await self._handle_event_choice(session, phone, str(button_id), stale=stale)
                return

            # An answer to a host question ("שאלות לאורחים"). Handled BEFORE the
            # RSVP resolver: an option such as "לא, תודה" must never be read as
            # an RSVP decline.
            if button_id and str(button_id).startswith(QANS_PREFIX):
                await self._handle_question_answer(
                    session, phone, str(button_id), message_type=message_type, raw=raw,
                    context_id=context_id, stale=stale,
                )
                return

            # Resolve the SEMANTIC action once, centrally: Meta payload -> button
            # id -> legacy display text -> conservative free-text heuristic.
            action = resolve_rsvp_action(button_id=button_id, button_payload=button_payload, text=text)

            conv, effective_event_id, effective_state, candidates = await self.resolve_conversation(
                session=session, guest_phone=phone, context_id=context_id, provided_event_id=event_id,
            )

            if candidates:
                await self._ask_which_event(session, phone, candidates, {
                    "message_type": message_type, "text": text, "raw": raw, "context_id": context_id,
                    "button_id": button_id, "button_payload": button_payload, "reply_kind": reply_kind,
                    "sent_ts": sent_ts,
                }, stale=stale)
                return

            if not conv or not effective_event_id:
                await self._redirect_unknown_guest(phone, event_id, stale=stale)
                return

            await self._run_state_machine(
                session, conv,
                effective_state=effective_state or conv.current_state,
                message_type=message_type, text=text, raw=raw, context_id=context_id,
                action=action, button_id=button_id, button_payload=button_payload,
                reply_kind=reply_kind, stale=stale,
            )

    async def _run_state_machine(
        self,
        session: AsyncSession,
        conv: Conversation,
        *,
        effective_state: str,
        message_type: str,
        text: str,
        raw: Dict[str, Any],
        context_id: Optional[str],
        action: RsvpAction,
        button_id: Optional[str],
        button_payload: Optional[str],
        reply_kind: Optional[str],
        stale: bool,
    ) -> None:
        # Admin flow settings for this event (cached 60s; defaults on any error).
        cfg = await load_flow_config(conv.event_id)
        # A quick-reply on an invitation/reminder TEMPLATE always carries RSVP
        # meaning, wherever the conversation stands. Without this, guests who
        # had answered "maybe"/"no" tapped "מגיע" on the reminder and landed in a
        # "didn't understand" loop - exactly the guests reminders are for.
        if reply_kind == "template_button" and action in RSVP_ACTIONS:
            if (cfg.get("already_answered.behavior") == "acknowledge"
                    and conv.current_state in ACK_STATES.get(action, ())):
                await self._acknowledge_already_answered(
                    session, conv, cfg, message_type=message_type, raw=raw, context_id=context_id, stale=stale)
                return
            effective_state = "rsvp_invite"
        # A clearly TYPED change of heart ("בסוף לא באים", "אולי בכל זאת לא")
        # after the guest already confirmed must not be swallowed by the
        # completion states (which would answer "רשמנו לפנינו" and change
        # nothing). Bot quick-replies keep their own state's meaning.
        elif (not reply_kind and action in (RsvpAction.DECLINED, RsvpAction.MAYBE)
              and effective_state in TYPED_CHANGE_OF_HEART_STATES):
            effective_state = "rsvp_invite"

        handler_cls = self.state_handlers.get(effective_state, FreeTextState)
        handler = handler_cls(self)
        handler.set_cfg(cfg)

        logger.debug("Processing message", extra={
            "effective_state": effective_state, "conversation_current_state": conv.current_state,
            "handler_id": handler.id, "action": getattr(action, "value", action),
        })

        await self.log_message(
            session,
            conversation_id=conv.id,
            wa_message_id=raw.get("message_id"),
            direction="incoming",
            message_type=message_type,
            reply_to_id=context_id,
            payload=json.dumps(raw, ensure_ascii=False)[:4000],
            state=effective_state,
        )

        # Credit the reply to the campaign that prompted it, BEFORE the state
        # handler runs - a handler that raises must not cost us the answer.
        await self._record_reply(session, guest_phone=conv.guest_phone, event_id=conv.event_id,
                                 context_id=context_id)

        state_message = {
            "text": text,
            "raw": raw,
            "action": action,                 # semantic RsvpAction (label-independent)
            "button_id": button_id,
            "button_payload": button_payload,
            "reply_kind": reply_kind,
        }
        await handler.process_incoming(session, state_message, conv)
        next_state_id = handler.get_next_state(state_message)

        if next_state_id not in self.state_handlers:
            logger.error("Next state %s unknown, falling back to %s", next_state_id, self.fallback_state_id)
            next_state_id = self.fallback_state_id

        next_state_id = await self._apply_flow_steps(session, conv, cfg, effective_state, next_state_id)

        logger.info("State transition %s -> %s (action=%s)", effective_state, next_state_id,
                    getattr(action, "value", action))

        await self._transition_and_send(session, conv, next_state_id, stale=stale, cfg=cfg)

    async def _apply_flow_steps(self, session: AsyncSession, conv: Conversation, cfg: Any,
                                effective_state: str, next_state_id: str) -> str:
        """Skip the optional after-confirm steps the admin turned off.

        Order is fixed: party size -> host questions -> notes -> done. With all
        defaults this is exactly the old behaviour (only the question gate).
        """
        skipped_count = False
        if (next_state_id in ("rsvp_count", "rsvp_count_retry")
                and not cfg.enabled("after_confirm.ask_party_size.enabled")):
            next_state_id = "rsvp_info_question"   # -> questions / notes / done below
            skipped_count = True
        if next_state_id in QUESTION_GATE_TARGETS and (skipped_count or effective_state in QUESTION_ENTRY_STATES):
            return await self._question_gate(session, conv, next_state_id, cfg)
        if next_state_id == "rsvp_info_question" and not cfg.enabled("after_confirm.ask_notes.enabled"):
            return "rsvp_done"
        return next_state_id

    async def _question_gate(self, session: AsyncSession, conv: Conversation, next_state_id: str,
                             cfg: Any = None) -> str:
        """Ask the next unanswered host question (if enabled), else continue to
        rsvp_info_question - or straight to rsvp_done when notes are off."""
        if cfg is None:
            cfg = await load_flow_config(conv.event_id)
        if cfg.enabled("after_confirm.ask_guest_questions.enabled") and await fetch_pending_question(session, conv):
            return next_state_id if next_state_id in QUESTION_STATES else "question_answer"
        return "rsvp_info_question" if cfg.enabled("after_confirm.ask_notes.enabled") else "rsvp_done"

    async def _acknowledge_already_answered(
        self, session: AsyncSession, conv: Conversation, cfg: Any, *,
        message_type: str, raw: Dict[str, Any], context_id: Optional[str], stale: bool,
    ) -> None:
        """Repeat tap of the answer already recorded: say so, change nothing.
        Buttons are the current state's own, so they keep routing correctly."""
        await self.log_message(
            session, conversation_id=conv.id, wa_message_id=raw.get("message_id"), direction="incoming",
            message_type=message_type, reply_to_id=context_id,
            payload=json.dumps(raw, ensure_ascii=False)[:4000], state=conv.current_state,
        )
        await self._record_reply(session, guest_phone=conv.guest_phone, event_id=conv.event_id,
                                 context_id=context_id)
        handler = self.state_handlers.get(conv.current_state, FreeTextState)(self)
        handler.set_cfg(cfg)
        await BaseState.process_incoming(handler, session, {}, conv)  # stamps last_response only
        logger.info("Already answered (%s) - acknowledging", conv.current_state)
        if stale:
            return
        body = cfg.legacy_text("already_answered.text")
        buttons = await handler.cfg_buttons(session, conv)
        outgoing = (await handler.build_interactive(session, conv, body, buttons) if buttons
                    else await handler.build_text(session, conv, body))
        outgoing.setdefault("conversation_id", str(conv.id))
        outgoing.setdefault("guest_id", str(conv.guest_id) if conv.guest_id else None)
        await self.log_message(
            session, conversation_id=conv.id, wa_message_id=None, direction="outgoing",
            message_type=outgoing.get("message_type", "interactive"), reply_to_id=None,
            payload=json.dumps(outgoing, ensure_ascii=False)[:4000], state=conv.current_state,
        )
        await self.publish_outgoing(outgoing)

    async def _transition_and_send(self, session: AsyncSession, conv: Conversation, next_state_id: str,
                                   *, stale: bool, cfg: Any = None) -> None:
        """Persist the new state and send its prompt (unless outside the 24h window)."""
        await self.update_conversation(session, conv, next_state_id)
        await session.refresh(conv)

        if stale:
            return  # outside the 24h window - the RSVP is recorded, no reply

        next_handler = self.state_handlers.get(next_state_id, FreeTextState)(self)
        next_handler.set_cfg(cfg if cfg is not None else await load_flow_config(conv.event_id))
        outgoing = await next_handler.send(session, conv)
        if outgoing:
            outgoing.setdefault("conversation_id", str(conv.id))
            outgoing.setdefault("guest_id", str(conv.guest_id) if conv.guest_id else None)
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

    # ------------------------------------------------------------------
    # Host questions ("שאלות לאורחים")
    # ------------------------------------------------------------------

    async def _handle_question_answer(
        self, session: AsyncSession, phone: str, button_id: str, *,
        message_type: str, raw: Dict[str, Any], context_id: Optional[str], stale: bool,
    ) -> None:
        """A `qans__<field>__<idx>` tap: store the answer, never touch the RSVP.

        The field id names the event, so the conversation is found by
        (phone, event) - not by RSVP state. If the guest is still in the
        question loop, continue to the next question / rsvp_info_question;
        a tap on an OLD question message just updates the answer and thanks.
        """
        parsed = parse_answer_id(button_id)
        field = await fetch_field(session, parsed[0]) if parsed else None
        if not parsed or not field:
            logger.warning("Question answer for unknown field (%s) from %s", button_id, mask_phone(phone))
            return
        res = await session.execute(
            select(Conversation)
            .where(Conversation.guest_phone == phone, Conversation.event_id == field["event_id"],
                   Conversation.active == True)  # noqa: E712
            .order_by(Conversation.updated_at.desc())
            .limit(1)
        )
        conv = res.scalars().first()
        if conv is None:
            logger.warning("Question answer without a conversation from %s", mask_phone(phone))
            return

        await self.log_message(
            session, conversation_id=conv.id, wa_message_id=raw.get("message_id"), direction="incoming",
            message_type=message_type, reply_to_id=context_id,
            payload=json.dumps(raw, ensure_ascii=False)[:4000], state="question_answer",
        )
        await self._record_reply(session, guest_phone=conv.guest_phone, event_id=conv.event_id,
                                 context_id=context_id)
        idx = parsed[1]
        guest_id = await resolve_guest_id(session, conv)
        if guest_id:
            try:
                await session.execute(
                    text("UPDATE guests SET last_response = now() WHERE id = CAST(:gid AS uuid)"),
                    {"gid": guest_id},
                )
                await session.commit()
            except Exception:
                await session.rollback()
        in_loop = conv.current_state in QUESTION_STATES
        if guest_id and 0 <= idx < len(field["options"]):
            await store_answer(session, guest_id, field["id"], field["options"][idx])
        elif not in_loop:
            logger.info("Stale/invalid question answer ignored (field=%s idx=%s)", field["id"], idx)
            return

        if in_loop:
            next_state_id = await self._question_gate(session, conv, "question_answer")
            await self._transition_and_send(session, conv, next_state_id, stale=stale)
            return
        if stale:
            return
        ack = {
            "platform": "WA",
            "recipient": conv.guest_phone,
            "message_type": "free_text",
            "text": "תודה! עדכנו את התשובה שלך ✓",
            "event_id": str(conv.event_id),
            "state": conv.current_state,
            "source": "webhook_worker",
            "conversation_id": str(conv.id),
            "guest_id": str(conv.guest_id) if conv.guest_id else None,
        }
        await self.log_message(
            session, conversation_id=conv.id, wa_message_id=None, direction="outgoing",
            message_type="free_text", reply_to_id=None,
            payload=json.dumps(ack, ensure_ascii=False)[:4000], state=conv.current_state,
        )
        await self.publish_outgoing(ack)

    # ------------------------------------------------------------------
    # Multi-event disambiguation
    # ------------------------------------------------------------------

    @staticmethod
    def _fmt_date(d: Any) -> str:
        try:
            return d.strftime("%d.%m.%y") if d else ""
        except Exception:
            return ""

    async def _ask_which_event(
        self, session: AsyncSession, phone: str, candidates: List[Dict[str, Any]],
        pending: Dict[str, Any], *, stale: bool,
    ) -> None:
        """Park the message and ask the guest which of their events it is for."""
        await session.execute(
            text(
                """
                INSERT INTO inbound_pending_choice (guest_phone, payload, created_at)
                VALUES (:p, :payload, now())
                ON CONFLICT (guest_phone) DO UPDATE SET payload = EXCLUDED.payload, created_at = now()
                """
            ),
            {"p": phone, "payload": json.dumps(pending, ensure_ascii=False, default=str)},
        )
        await session.commit()
        logger.info("Guest %s has %d open events - asking which one", mask_phone(phone), len(candidates))
        if stale:
            return

        body = "היי 😊 ראינו שהוזמנת ליותר מאירוע אחד.\nעל איזה אירוע ההודעה שלך?"
        options = candidates[:10]
        titles = [str(c["event_name"]).strip() or "האירוע" for c in options]
        if len(set(t[:20] for t in titles)) < len(titles):
            # Same-named events: Meta rejects duplicate button titles - add the date.
            titles = [f"{t[:11]} {self._fmt_date(c['event_date'])[:5]}".strip() for t, c in zip(titles, options)]
        if len(options) <= 3:
            interactive = {
                "type": "button",
                "body": {"text": body},
                "action": {"buttons": [
                    {"type": "reply", "reply": {
                        "id": f"{EVENT_CHOICE_PREFIX}{c['conv'].id}",
                        "title": t[:20],  # Meta: button title <= 20 chars
                    }}
                    for c, t in zip(options, titles)
                ]},
            }
        else:
            interactive = {
                "type": "list",
                "body": {"text": body},
                "action": {
                    "button": "בחירת אירוע",
                    "sections": [{
                        "title": "האירועים שלך",
                        "rows": [
                            {
                                "id": f"{EVENT_CHOICE_PREFIX}{c['conv'].id}",
                                "title": t[:24],  # Meta: row title <= 24
                                "description": self._fmt_date(c["event_date"]),
                            }
                            for c, t in zip(options, titles)
                        ],
                    }],
                },
            }
        first = candidates[0]["conv"]
        await self.publish_outgoing({
            "platform": "WA",
            "recipient": phone,
            "message_type": "interactive",
            "interactive": interactive,
            "event_id": str(first.event_id),
            "conversation_id": str(first.id),
            "state": "event_select",
            "source": "webhook_worker",
        })

    async def _handle_event_choice(self, session: AsyncSession, phone: str, button_id: str, *, stale: bool) -> None:
        try:
            conv = await session.get(Conversation, uuid.UUID(button_id[len(EVENT_CHOICE_PREFIX):]))
        except Exception:
            conv = None
        if conv is None or conv.guest_phone != phone:
            logger.warning("Event choice for unknown/foreign conversation from %s", mask_phone(phone))
            return
        res = await session.execute(
            text(
                """
                DELETE FROM inbound_pending_choice WHERE guest_phone = :p
                RETURNING payload, created_at
                """
            ),
            {"p": phone},
        )
        row = res.first()
        await session.commit()
        if not row:
            logger.info("Event choice without a pending message (already applied?) - ignoring")
            return
        payload_s, created_at = row
        if created_at and (datetime.now(timezone.utc) - created_at).total_seconds() > PENDING_CHOICE_TTL_SECONDS:
            logger.info("Pending message expired before the guest chose an event - ignoring")
            return
        try:
            pending = json.loads(payload_s)
        except Exception:
            return
        p_text = pending.get("text") or ""
        p_action = resolve_rsvp_action(button_id=pending.get("button_id"),
                                       button_payload=pending.get("button_payload"), text=p_text)
        await self._run_state_machine(
            session, conv,
            effective_state=conv.current_state,
            message_type=pending.get("message_type") or "free_text",
            text=p_text,
            raw=pending.get("raw") or {},
            context_id=pending.get("context_id"),
            action=p_action,
            button_id=pending.get("button_id"),
            button_payload=pending.get("button_payload"),
            reply_kind=pending.get("reply_kind"),
            stale=stale,
        )

    async def _redirect_unknown_guest(self, phone: str, event_id: Optional[str], *, stale: bool) -> None:
        """No conversation at all: point them at the secondary bot (if configured)."""
        logger.warning("No conversation for inbound message from %s", mask_phone(phone))
        if not self.secondary_bot_phone or stale:
            return
        wa_link = f"https://wa.me/{self.secondary_bot_phone}"
        body_text = (
            "היי 👋\n"
            "לא מצאתי אצלך אירוע פתוח… אולי זה כי אתה עובד על משהו סופר סודי 😎\n"
            "אם בא לך לפתוח אירוע, לשאול שאלות או לקבל מידע -\n"
            "לחץ על הכפתור, ונציג שלנו ימשיך איתך משם"
        )
        await self.publish_outgoing({
            "platform": "WA",
            "recipient": phone,
            "message_type": "interactive",
            "interactive": {
                "type": "cta_url",
                "body": {"text": body_text},
                "action": {
                    "name": "cta_url",
                    "parameters": {"display_text": "לדבר עם נציג שלנו", "url": wa_link},
                },
            },
            "event_id": event_id or "",
            "state": "no_conversation_redirect",
            "source": "webhook_worker",
        })

    # ------------------------------------------------------------------
    # Opt-out, reply attribution, receipts
    # ------------------------------------------------------------------

    async def _apply_opt_out(self, session: AsyncSession, guest_phone: str, *, opted_out: bool, reason: str) -> None:
        """Set/clear the opt-out flag for every guest row with this phone.

        Applied across ALL of the phone's events on purpose: a person who says
        STOP is opting out of being messaged by us, not out of one guest list.
        Matched on the FULL canonical international number - a last-9-digits
        match could opt out a stranger in another country. Raises on DB error
        so the message is retried: a lost STOP is a compliance problem.
        """
        canonical = canonical_phone_digits(guest_phone)
        if not canonical:
            return
        res = await session.execute(
            text(
                f"""
                UPDATE guests
                SET opted_out_at = :ts,
                    opted_out_reason = :reason,
                    opted_out_source = :source
                WHERE {canonical_phone_sql('phone')} = :phone
                """
            ),
            {
                "ts": None if not opted_out else datetime.now(timezone.utc),
                "reason": reason if opted_out else None,
                "source": "whatsapp_stop" if opted_out else None,
                "phone": canonical,
            },
        )
        await session.commit()
        logger.info("Guest opt-out %s (rows=%d)", "set" if opted_out else "cleared", res.rowcount or 0,
                    extra={"phone": mask_phone(canonical)})

    async def _record_reply(
        self, session: AsyncSession, *, guest_phone: str, event_id: Optional[str], context_id: Optional[str]
    ) -> None:
        """Credit an inbound guest message to the campaign that prompted it.

        1. the guest replied to a specific message (Meta gives us its wamid) -
           credit exactly that one;
        2. otherwise the most recent campaign message this guest actually
           received for this event.
        First reply wins (`replied_at IS NULL`). Best-effort: runs in a
        SAVEPOINT so a failure never disturbs the RSVP conversation.
        """
        canonical = canonical_phone_digits(guest_phone)
        if not canonical:
            return
        try:
            async with session.begin_nested():
                rows = 0
                if context_id:
                    res = await session.execute(text(REPLY_BY_WAMID_SQL), {"wamid": context_id})
                    rows = res.rowcount or 0
                if not rows and event_id:
                    await session.execute(text(REPLY_BY_RECENCY_SQL), {"event_id": event_id, "phone": canonical})
            await session.commit()
        except Exception as exc:
            logger.warning("Could not attribute reply to a campaign: %s", exc)
            try:
                await session.rollback()
            except Exception:
                pass

    async def _record_delivery_receipt(
        self, session: AsyncSession, wa_message_id: str, status_value: str, status_payload: Dict[str, Any]
    ) -> None:
        """Advance a campaign message's delivery state from a Meta receipt.

        Rank-guarded with the shared ladder (shared/domain/delivery.py): a late
        'failed' DOES override 'accepted' (Meta accepted, then could not
        deliver), but never 'delivered'/'read'.
        """
        error = (status_payload.get("errors") or [{}])[0] if status_payload.get("errors") else {}
        await session.execute(
            text(
                f"""
                UPDATE messages_sent
                SET status = :new_status,
                    error_code = COALESCE(:error_code, error_code),
                    error_detail = COALESCE(:error_detail, error_detail),
                    updated_at = NOW()
                WHERE wa_message_id = :wamid
                  AND :new_rank > {status_rank_sql('status')}
                """
            ),
            {
                "new_status": status_value,
                "new_rank": status_rank(status_value),
                "wamid": wa_message_id,
                "error_code": str(error.get("code"))[:100] if error.get("code") else None,
                "error_detail": str(error.get("title") or error.get("message") or "")[:500] or None,
            },
        )
        await session.commit()

    async def handle_status_update(
        self,
        *,
        wa_message_id: Optional[str],
        status_payload: Dict[str, Any],
        guest_phone: Optional[str],
        event_id: Optional[str],
    ) -> None:
        """Apply a Meta status webhook (sent / delivered / read / failed).

        Idempotent per (wamid, status): Meta and our own 5xx-retry contract can
        deliver the same receipt more than once.
        """
        status_value = status_payload.get("status")
        status_wa_id = status_payload.get("id") or wa_message_id
        if not status_wa_id:
            return
        key = f"{status_wa_id}:{status_value}"
        if not await self._claim(key, "status"):
            logger.debug("Duplicate status %s - skipping", key)
            return

        async with AsyncSessionLocal() as session:
            if status_value in (
                MessageDeliveryStatus.DELIVERED.value,
                MessageDeliveryStatus.READ.value,
                MessageDeliveryStatus.FAILED.value,
            ):
                await self._record_delivery_receipt(session, status_wa_id, status_value, status_payload)

            res = await session.execute(
                select(MessageLog)
                .where(MessageLog.wa_message_id == status_wa_id, MessageLog.direction == "outgoing")
                .order_by(MessageLog.created_at.desc())
                .limit(1)
            )
            message_entry = res.scalars().first()
            conversation: Optional[Conversation] = None
            if message_entry:
                conversation = await session.get(Conversation, message_entry.conversation_id)
                # Rank-guarded: 'read' then a late 'delivered' must not regress.
                if status_value and _log_status_rank(status_value) > _log_status_rank(message_entry.status):
                    message_entry.status = status_value
                    await session.commit()
            elif guest_phone:
                # Unknown wamid (not ours, or logged later than the receipt).
                # Keep the status row against the guest's latest conversation so
                # read/delivered reporting that joins on wamid still sees it -
                # but never stamp this wamid onto an unrelated outgoing row.
                conversation = await self._get_latest_active_conversation(session, guest_phone)

            if conversation is not None:
                await self.log_message(
                    session,
                    conversation_id=conversation.id,
                    wa_message_id=status_wa_id,
                    direction="status",
                    message_type="status",
                    reply_to_id=status_wa_id,
                    payload=json.dumps(status_payload, ensure_ascii=False)[:4000],
                    state=(message_entry.state if message_entry and message_entry.state
                           else conversation.current_state),
                    status=status_value,
                )
        await self._mark_done(key)
