from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from states.base_state import BaseState


class NoteInfoState(BaseState):
    id = "note_info"
    next_states = {
        "*": "rsvp_done",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        # Call parent to update last_response
        await super().process_incoming(session, message, conversation)
        
        # Store note text in guests table
        text_content = (message.get("text") or "").strip()
        
        if text_content:
            event_id = str(conversation.event_id)
            guest_phone = conversation.guest_phone
            
            try:
                result = await session.execute(
                    text("""
                        UPDATE guests 
                        SET notes = :notes
                        WHERE phone = :phone AND event_id = :event_id
                    """),
                    {
                        "notes": text_content,
                        "phone": guest_phone,
                        "event_id": event_id
                    }
                )
                if result.rowcount > 0:
                    await session.commit()
            except Exception as e:
                logger = __import__('logging').getLogger(__name__)
                logger.warning(f"Failed to update notes: {e}")
                await session.rollback()

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return await self.build_text(session, conversation, "בוודאי 😊 נשמח אם תכתוב לנו את ההערה כאן 👇")


