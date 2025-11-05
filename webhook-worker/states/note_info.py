from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState


class NoteInfoState(BaseState):
    id = "note_info"
    next_states = {
        "*": "rsvp_done",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        # Could store note text
        return None

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return await self.build_text(session, conversation, "בוודאי 😊 נשמח אם תכתוב לנו את ההערה כאן 👇")


