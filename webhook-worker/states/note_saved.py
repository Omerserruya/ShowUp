from typing import Any, Dict

from sqlalchemy import text as _t
from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState
from states.note_info import GUEST_NOTE_PREFIX, note_reply_next, save_note_reply


class NoteSavedState(BaseState):
    """"Noted, we told the hosts: "<note>"" - after the guest wrote a note.

    Typing again adds another note (and echoes it); "nothing" replies end the
    conversation. A typed "לא" here is NOT a decline: this is the notes step,
    the update button is the way to change the RSVP."""
    id = "note_saved"
    button_path = "after_confirm.ask_notes.saved.buttons"
    button_next = {"another_note": "note_info", "update": "rsvp_update"}
    next_states = {"*": "rsvp_done"}

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        await super().process_incoming(session, message, conversation)
        if self.tapped_key(message) is None:
            await save_note_reply(self, session, message, conversation)

    def get_next_state(self, message: Dict[str, Any]) -> str:
        key = self.tapped_key(message)
        if key in self.button_next:
            return self.button_next[key]
        return note_reply_next(message, "rsvp_done")

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        note = getattr(conversation, "last_note", None) or await _last_note(session, conversation)
        body = (await self.cfg_text(session, conversation, "after_confirm.ask_notes.saved.text")).replace("{note}", note)
        return await self.build_interactive(session, conversation, body, await self.cfg_buttons(session, conversation))


async def _last_note(session: AsyncSession, conversation: Any) -> str:
    """The guest's latest WhatsApp note, when the echo was not carried over."""
    if not conversation.guest_id:
        return ""
    notes = (await session.execute(_t("SELECT notes FROM guests WHERE id = CAST(:g AS uuid)"),
                                   {"g": str(conversation.guest_id)})).scalar() or ""
    i = notes.rfind(GUEST_NOTE_PREFIX)
    return notes[i + len(GUEST_NOTE_PREFIX):].strip() if i >= 0 else ""
