from typing import Any, Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState


class RsvpCountState(BaseState):
    id = "rsvp_count"
    next_states = {
        "*": "rsvp_info_question",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        # Could validate numeric input and store count in DB
        return None

    async def send(self, session: AsyncSession, conversation: Any) -> Optional[Dict[str, Any]]:
        return self.build_text(
            conversation,
            "יופי! שמחים לדעת שתוכל להגיע ל{{event.name}} של {{event.inviters}} 🥳\nרק כדי שנוכל להתכונן כמו שצריך – כמה אנשים יגיעו איתך? 😊\n הגב בבקשה במספר בלבד",
        )


