from typing import Any, Dict, Optional
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState
from shared.domain.rsvp import GUEST_COUNT_MAX, GUEST_COUNT_MIN, is_valid_guest_count, parse_guest_count

logger = logging.getLogger(__name__)


class RsvpCountState(BaseState):
    """"How many of you are coming?" - accepts 1..GUEST_COUNT_MAX.

    Anything else (a typed phone number, "0", "המון") moves to
    rsvp_count_retry, which re-asks with a friendlier explanation instead of
    repeating the same question verbatim - and, crucially, never stores it
    (a pasted phone number used to become a 501-million-guest RSVP).
    """
    id = "rsvp_count"
    next_states = {}

    @staticmethod
    def _count(message: Dict[str, Any], min_count: int = GUEST_COUNT_MIN,
               max_count: int = GUEST_COUNT_MAX) -> Optional[int]:
        n = parse_guest_count(message.get("text"))
        return n if is_valid_guest_count(n, max_count, min_count) else None

    def _bounded_count(self, message: Dict[str, Any]) -> Optional[int]:
        return self._count(message, self.cfg.party_min, self.cfg.party_max)

    def get_next_state(self, message: Dict[str, Any]) -> str:
        # rsvp_info_question is a gate target: flow_manager turns it into the
        # next enabled step (host questions -> notes -> done).
        if self._bounded_count(message) is not None:
            return "rsvp_info_question"
        return "rsvp_count_retry"

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        await super().process_incoming(session, message, conversation)
        await self.get_cfg(session, conversation)
        guest_count = self._bounded_count(message)
        if guest_count is None:
            logger.info("RsvpCount: no valid party size in reply; re-asking")
            return
        # Count + status together: giving a party size IS confirming.
        rows = await self.update_guest(session, conversation, {"guest_count": guest_count, "status": "attending"})
        logger.info("RsvpCount: guest_count=%d status=attending (rows=%d)", guest_count, rows)

    async def send(self, session: AsyncSession, conversation: Any) -> Optional[Dict[str, Any]]:
        # Copy: admin flow settings (after_confirm.ask_party_size.text); the
        # default is the original "יופי! שמחים לדעת שתוכל להגיע..." text.
        return await self.build_text(
            session,
            conversation,
            await self.cfg_text(session, conversation, "after_confirm.ask_party_size.text"),
        )


class RsvpCountRetryState(RsvpCountState):
    """Same parsing as RsvpCountState; only the prompt differs."""
    id = "rsvp_count_retry"

    async def send(self, session: AsyncSession, conversation: Any) -> Optional[Dict[str, Any]]:
        return await self.build_text(
            session,
            conversation,
            await self.cfg_text(session, conversation, "after_confirm.ask_party_size.retry_text"),
        )
