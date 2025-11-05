from typing import Any, Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from .base_state import BaseState


class RsvpInviteState(BaseState):
    id = "rsvp_invite"
    # These should reflect conversation_flow.yaml next map for rsvp_invite
    next_states = {
        "ברור שאני בא!": "rsvp_count",
        "לצערי לא אוכל להגיע ):": "rsvp_decline",
        "עוד מתלבט, תחזרו אלי?": "rsvp_decline",
        "*": "rsvp_count",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        # No-op for example; could update guest attributes
        return None

    async def send(self, session: AsyncSession, conversation: Any) -> Optional[Dict[str, Any]]:
        # Template per original spec: event_no_pic with 6 params
        return self.build_template(
            conversation,
            template_name="event_no_pic",
            language="he",
            params=[
                "{{event.name}}",
                "{{event.inviters}}",
                "{{event.date}}",
                "{{event.date}}",
                "{{event.location}}",
                "{{guest.name}}",
            ],
        )


