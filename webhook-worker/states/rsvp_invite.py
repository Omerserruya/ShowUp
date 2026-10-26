from typing import Any, Dict, Optional
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState
from shared.domain.enums import RsvpAction

logger = logging.getLogger(__name__)

# DB values written by the WhatsApp flow ("attending" is the legacy spelling of
# GuestStatus.CONFIRMED; GuestStatus.normalize maps it).
ACTION_STATUS = {
    RsvpAction.CONFIRMED: "attending",
    RsvpAction.DECLINED: "declined",
    RsvpAction.MAYBE: "maybe",
}

# Where each semantic RSVP answer leads, from ANY state. FlowManager routes a
# template quick-reply (invitation / reminder button) through RsvpInviteState
# regardless of the conversation's current state, so a guest who earlier said
# "maybe" or "no" can confirm straight from a reminder.
RSVP_SEMANTIC_NEXT = {
    RsvpAction.CONFIRMED: "rsvp_count",
    RsvpAction.DECLINED: "rsvp_decline",
    RsvpAction.MAYBE: "rsvp_maybe",
}


class RsvpInviteState(BaseState):
    id = "rsvp_invite"
    # SEMANTIC routing (label-independent) - consulted before the text map. The
    # engine understands the action; the catalog owns the button wording.
    semantic_next = dict(RSVP_SEMANTIC_NEXT)
    # Legacy text fallback (kept so live templates that still send only a title
    # keep working). Remove once every template carries semantic payloads.
    next_states = {
        "ברור שאני בא!": "rsvp_count",
        "ברור שנגיע !": "rsvp_count",
        "ברור שאגיע!": "rsvp_count",
        "לצערי לא אוכל להגיע ):": "rsvp_decline",
        "עוד מתלבט, תחזרו אלי?": "rsvp_maybe",
        "לצערי לא אוכל": "rsvp_decline",
        "לצערי לא אוכל להגיע": "rsvp_decline",
        "עוד מתלבט/ת, תחזרו אלי?": "rsvp_maybe",
        "*": "didnt_understand"
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        await super().process_incoming(session, message, conversation)

        # Status from the SEMANTIC action (label-independent). Fall back to the
        # legacy titles only when there is no action.
        status_value = ACTION_STATUS.get(message.get("action"))
        if status_value is None:
            _LEGACY_TEXT_STATUS = {
                "ברור שאני בא!": "attending",
                "לצערי לא אוכל להגיע ):": "declined",
                "עוד מתלבט, תחזרו אלי?": "maybe",
            }
            status_value = _LEGACY_TEXT_STATUS.get((message.get("text") or "").strip())
        if status_value is None:
            return  # not a status-changing response
        await self.set_guest_status(session, conversation, status_value)

    async def send(self, session: AsyncSession, conversation: Any) -> Optional[Dict[str, Any]]:
        # event_no_pic has exactly 4 body params, in this order:
        #   {{1}} event_date  {{2}} event_time  {{3}} venue_name  {{4}} host_name
        return await self.build_template(
            session,
            conversation,
            template_name="event_no_pic",
            language="he",
            params=[
                "{{event.date}}",
                "{{event.time}}",
                "{{event.location}}",
                "{{event.inviters}}",
            ],
        )
