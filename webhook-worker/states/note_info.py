from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from .base_state import BaseState


class NoteInfoState(BaseState):
    id = "note_info"
    next_states = {
        "*": "rsvp_done",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        # Could store note text
        return None

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return self.build_text(conversation, "בוודאי 😊 נשמח אם תכתוב לנו את ההערה כאן 👇")


