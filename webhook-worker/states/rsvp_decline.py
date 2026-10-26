from typing import Any, Dict
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState
from shared.domain.enums import RsvpAction

logger = logging.getLogger(__name__)

CHANGED_MIND_LABEL = "בסוף נוכל להגיע"


class RsvpDeclineState(BaseState):
    id = "rsvp_decline"
    button_path = "after_decline.buttons"
    button_next = {"change_mind": "rsvp_count"}
    # A typed "בסוף באים!" is as good as the button.
    semantic_next = {
        RsvpAction.CONFIRMED: "rsvp_count",
    }
    next_states = {
        CHANGED_MIND_LABEL: "rsvp_count",
        # Anything else: stay here (re-sending the invitation template to a guest
        # who already declined is noise).
        "*": "rsvp_decline",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        await super().process_incoming(session, message, conversation)
        await self.get_cfg(session, conversation)
        text_content = (message.get("text") or "").strip()
        # Status 'declined' was written when they declined; only a change of mind
        # moves it.
        if (self.tapped_key(message) == "change_mind" or text_content == CHANGED_MIND_LABEL
                or message.get("action") == RsvpAction.CONFIRMED):
            await self.set_guest_status(session, conversation, "attending")

    def shown_button_keys(self, cfg=None):
        cfg = cfg or self.cfg
        return ["change_mind"] if cfg.enabled("after_decline.allow_change_mind") else []

    def tapped_key(self, message: Dict[str, Any]):
        # Accept the change-of-mind tap even if the toggle was turned off after
        # the message went out (an old message's button still means "coming").
        key = super().tapped_key(message)
        if key:
            return key
        bid = str(message.get("button_id") or "").lower()
        text_value = (message.get("text") or "").strip()
        if bid == f"{self.id}__btn_1" or text_value in (
                self.cfg.button(self.button_path, "change_mind"), CHANGED_MIND_LABEL):
            return "change_mind"
        return None

    def get_next_state(self, message: Dict[str, Any]) -> str:
        if (message.get("text") or "").strip() == CHANGED_MIND_LABEL:
            return "rsvp_count"
        return super().get_next_state(message)

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        text_value = await self.cfg_text(session, conversation, "after_decline.text")
        buttons = await self.cfg_buttons(session, conversation)
        if not buttons:  # allow_change_mind off
            return await self.build_text(session, conversation, text_value)
        return await self.build_interactive(session, conversation, text_value, buttons)
