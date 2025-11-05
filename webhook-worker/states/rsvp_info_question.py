from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState


class RsvpInfoQuestionState(BaseState):
    id = "rsvp_info_question"
    next_states = {
        "אין שום דבר מיוחד": "rsvp_done",
        "לכתוב לנו הערה": "note_info",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        return None

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return self.build_interactive(
            conversation,
            "תודה על העדכון! האם יש משהו שחשוב שנדע? למשל מנה צמחונית/טבעונית או כל הערה מיוחדת – נשמח אם תעדכן כאן ❤️",
            ["אין שום דבר מיוחד", "לכתוב לנו הערה"],
        )


