from typing import Any, Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from states.base_state import BaseState


class RsvpCountState(BaseState):
    id = "rsvp_count"
    next_states = {
        "*": "rsvp_info_question",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        # Call parent to update last_response
        await super().process_incoming(session, message, conversation)
        
        # Update guest_count if message is a number
        text_content = (message.get("text") or "").strip()
        
        # Try to parse as integer
        try:
            guest_count = int(text_content)
            if guest_count > 0:
                # Update guest_count in guests table
                event_id = str(conversation.event_id)
                guest_phone = conversation.guest_phone
                
                result = await session.execute(
                    text("""
                        UPDATE guests 
                        SET guest_count = :guest_count
                        WHERE phone = :phone AND event_id = :event_id
                    """),
                    {
                        "guest_count": guest_count,
                        "phone": guest_phone,
                        "event_id": event_id
                    }
                )
                if result.rowcount > 0:
                    await session.commit()
        except (ValueError, TypeError):
            # Not a valid number, ignore
            pass
        except Exception as e:
            logger = __import__('logging').getLogger(__name__)
            logger.warning(f"Failed to update guest_count: {e}")
            await session.rollback()

    async def send(self, session: AsyncSession, conversation: Any) -> Optional[Dict[str, Any]]:
        return await self.build_text(
            session,
            conversation,
            "יופי! שמחים לדעת שתוכל להגיע ל{{event.name}} של {{event.inviters}} 🥳\nרק כדי שנוכל להתכונן כמו שצריך – כמה אנשים תגיעו? 😊\n\n *הגב בבקשה במספר בלבד*",
        )


