from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState

DECLINE_LABEL = "בסוף לא נוכל להגיע"


class RsvpUpdateState(BaseState):
    id = "rsvp_update"
    button_path = "after_confirm.update_menu.buttons"
    button_next = {"add_note": "note_info", "decline": "rsvp_decline", "change_count": "rsvp_count"}
    next_states = {
        "יש הערה שלא ציינו": "note_info",
        DECLINE_LABEL: "rsvp_decline",
        "נגיע כמות אחרת בסוף": "rsvp_count",
        "*": "rsvp_update",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        await super().process_incoming(session, message, conversation)
        await self.get_cfg(session, conversation)
        if self.tapped_key(message) == "decline" or (message.get("text") or "").strip() == DECLINE_LABEL:
            await self.set_guest_status(session, conversation, "declined")

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return await self.build_interactive(
            session,
            conversation,
            await self.cfg_text(session, conversation, "after_confirm.update_menu.text"),
            await self.cfg_buttons(session, conversation),
        )
