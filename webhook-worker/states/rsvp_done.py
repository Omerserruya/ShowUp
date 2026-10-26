from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState


class RsvpDoneState(BaseState):
    """RSVP completed.

    process_incoming deliberately does NOT write the guest's status: the status
    was set by the step that decided it (invite / count / decline). Writing
    'attending' here let a stale button tapped on an old message flip a guest
    who had since declined back to attending.
    """
    id = "rsvp_done"
    button_path = "after_confirm.done_message.buttons"
    button_next = {"update": "rsvp_update"}
    next_states = {
        "לעדכן הגעה": "rsvp_update",
        # Free text after completion ("תודה!", a question) stays here instead of
        # falling through to didnt_understand -> re-sending the invite template.
        "*": "rsvp_done",
    }

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return await self.build_interactive(
            session,
            conversation,
            await self.cfg_text(session, conversation, "after_confirm.done_message.text"),
            await self.cfg_buttons(session, conversation),
        )
