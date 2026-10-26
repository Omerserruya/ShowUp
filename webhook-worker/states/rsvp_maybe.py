from typing import Any, Dict
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState
from shared.domain.enums import RsvpAction

logger = logging.getLogger(__name__)

CONFIRM_LABEL = "בסוף נוכל להגיע"
DECLINE_LABEL = "לצערי לא נוכל"


class RsvpMaybeState(BaseState):
    """The guest is still deciding ("עוד מתלבט/ת").

    Before this state existed, "maybe" was routed into rsvp_decline and the guest
    got the decline copy ("חבל 😢 עדכנו שלא תגיע") - wrong, and it left them in a
    state that ignored a later "we're coming". Here we acknowledge the doubt
    warmly, promise a reminder (the owner's reminder round targets maybes), and
    keep both answers one tap away. Status 'maybe' was already written by
    RsvpInviteState when they answered.
    """
    id = "rsvp_maybe"
    button_path = "after_maybe.buttons"
    button_next = {"confirm": "rsvp_count", "decline": "rsvp_decline"}
    semantic_next = {
        RsvpAction.CONFIRMED: "rsvp_count",
        RsvpAction.DECLINED: "rsvp_decline",
    }
    next_states = {
        CONFIRM_LABEL: "rsvp_count",
        DECLINE_LABEL: "rsvp_decline",
        # Anything else (a question, "תודה") - stay, don't re-send the invite.
        "*": "rsvp_maybe",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        await super().process_incoming(session, message, conversation)
        await self.get_cfg(session, conversation)
        text_content = (message.get("text") or "").strip()
        action = message.get("action")
        key = self.tapped_key(message)
        if key == "confirm" or (key is None and (action == RsvpAction.CONFIRMED or text_content == CONFIRM_LABEL)):
            await self.set_guest_status(session, conversation, "attending")
        elif key == "decline" or (key is None and (action == RsvpAction.DECLINED or text_content == DECLINE_LABEL)):
            await self.set_guest_status(session, conversation, "declined")

    def get_next_state(self, message: Dict[str, Any]) -> str:
        key = self.tapped_key(message)  # configured buttons win over legacy labels
        if key:
            return self.button_next[key]
        text_content = (message.get("text") or "").strip()
        if text_content in (CONFIRM_LABEL, DECLINE_LABEL):
            return self.next_states[text_content]
        return super().get_next_state(message)

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return await self.build_interactive(
            session,
            conversation,
            await self.cfg_text(session, conversation, "after_maybe.text"),
            await self.cfg_buttons(session, conversation),
        )
