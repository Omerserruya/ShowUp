from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState


class DidntUnderstandState(BaseState):
    id = "didnt_understand"
    next_states = {
        "*": "rsvp_invite",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        return None

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return self.build_text(conversation, "לא כל כך הבנו את התשובה 😅 נסה לבחור אחת מהאפשרויות למעלה או כתוב 'עזרה'.")


