from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from states.rsvp_invite import RsvpInviteState


class DidntUnderstandState(RsvpInviteState):
    """Recovery state after an unrecognized reply.

    Inherits the full RSVP handling from RsvpInviteState (semantic_next routing +
    guest-status update in process_incoming), so a guest who answers properly on
    the retry moves forward instead of being bounced back to the invite. Only an
    unrecognized reply falls through to re-sending the invite with its buttons.
    """
    id = "didnt_understand"
    next_states = {
        "*": "rsvp_invite",
    }

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return await self.build_text(session, conversation, "לא כל כך הבנו את התשובה 😅 נסו לבחור אחת מהאפשרויות בהודעה למעלה")
