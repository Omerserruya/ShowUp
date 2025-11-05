from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState


class RsvpUpdateState(BaseState):
    id = "rsvp_update"
    next_states = {
        "יש הערה שלא ציינו": "note_info",
        "בסוף לא נוכל להגיע": "rsvp_decline",
        "נגיע כמות אחרת בסוף": "rsvp_count",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        return None

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return self.build_interactive(
            conversation,
            "נשמח אם תעדכן אותנו מה השתנה לגבי ההגעה שלך ✨  \nאפשר לעדכן את הפרטים דרך הכפתור למטה ❤️",
            ["יש הערה שלא ציינו", "בסוף לא נוכל להגיע", "נגיע כמות אחרת בסוף"],
        )


