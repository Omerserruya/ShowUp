from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState
from states.note_info import note_reply_next, save_note_reply


class RsvpInfoQuestionState(BaseState):
    """"Anything we should know?" after the party size.

    No status write here: 'attending' was recorded with the party size in
    rsvp_count. Re-writing it on "אין שום דבר מיוחד" let a stale tap on an old
    message flip a guest who had since declined back to attending.

    A note typed straight here (without the "write_note" button) is saved and
    echoed by note_saved; "nothing" replies ("אין", "לא תודה", an emoji) end the
    conversation; "כן"/"יש" asks them to write it (note_info). Typed "לא ..."
    is a note, not a decline (flow_manager leaves this state out of
    TYPED_CHANGE_OF_HEART_STATES): "לא אוכל בשר" is a note.
    """
    id = "rsvp_info_question"
    button_path = "after_confirm.ask_notes.buttons"
    button_next = {"no_notes": "rsvp_done", "write_note": "note_info"}
    next_states = {
        "אין שום דבר מיוחד": "rsvp_done",
        "לכתוב לנו הערה": "note_info",
        "*": "rsvp_done",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        await super().process_incoming(session, message, conversation)
        if self.tapped_key(message) is None and (message.get("text") or "").strip() not in self.next_states:
            await save_note_reply(self, session, message, conversation, asked=True)

    def get_next_state(self, message: Dict[str, Any]) -> str:
        nxt = super().get_next_state(message)
        if self.tapped_key(message) is None and (message.get("text") or "").strip() not in self.next_states:
            return note_reply_next(message, "rsvp_done", asked=True)
        return nxt

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return await self.build_interactive(
            session,
            conversation,
            await self.cfg_text(session, conversation, "after_confirm.ask_notes.text"),
            await self.cfg_buttons(session, conversation),
        )
