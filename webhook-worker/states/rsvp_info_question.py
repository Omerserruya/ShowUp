from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState


class RsvpInfoQuestionState(BaseState):
    """"Anything we should know?" after the party size.

    No status write here: 'attending' was recorded with the party size in
    rsvp_count. Re-writing it on "אין שום דבר מיוחד" let a stale tap on an old
    message flip a guest who had since declined back to attending.
    """
    id = "rsvp_info_question"
    button_path = "after_confirm.ask_notes.buttons"
    button_next = {"no_notes": "rsvp_done", "write_note": "note_info"}
    next_states = {
        "אין שום דבר מיוחד": "rsvp_done",
        "לכתוב לנו הערה": "note_info",
        "*": "rsvp_info_question",
    }

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return await self.build_interactive(
            session,
            conversation,
            await self.cfg_text(session, conversation, "after_confirm.ask_notes.text"),
            await self.cfg_buttons(session, conversation),
        )
