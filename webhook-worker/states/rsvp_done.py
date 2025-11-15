from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState


class RsvpDoneState(BaseState):
    id = "rsvp_done"
    next_states = {
        "לעדכן הגעה": "rsvp_update",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        return None

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return await self.build_interactive(
            session,
            conversation,
            "מעולה! רשמנו לפנינו שתגיעו ✨  \nאם יהיו שינויים, נשמח אם תעדכן כאן או תענה על ההודעה ❤️",
            ["לעדכן הגעה"],
        )


