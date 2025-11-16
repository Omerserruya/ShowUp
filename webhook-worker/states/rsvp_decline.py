from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState


class RsvpDeclineState(BaseState):
    id = "rsvp_decline"
    next_states = {
        "בסוף נוכל להגיע": "rsvp_count",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        return None

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return await self.build_interactive(
            session,
            conversation,
            "חבל 😢 עדכנו שלא תגיע. אם תתחרט תמיד אפשר לכתוב לנו שוב!",
            ["בסוף נוכל להגיע"],
        )


