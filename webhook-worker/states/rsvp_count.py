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
        
        logger = __import__('logging').getLogger(__name__)
        logger.info(f"RsvpCountState processing incoming message: '{text_content}'")
        
        # Try to parse as integer
        try:
            guest_count = int(text_content)
            if guest_count > 0:
                # Update guest_count in guests table
                event_id = str(conversation.event_id)
                guest_phone = conversation.guest_phone
                
                logger.info(f"Updating guest_count to {guest_count} for guest {guest_phone}")
                
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
                    logger.info(f"Successfully updated guest_count to {guest_count}, rows updated: {result.rowcount}")
                else:
                    logger.warning(f"No rows updated for guest_count update")
        except (ValueError, TypeError):
            # Not a valid number, ignore
            logger.debug(f"Message '{text_content}' is not a valid number, ignoring")
            pass
        except Exception as e:
            logger.warning(f"Failed to update guest_count: {e}", exc_info=True)
            await session.rollback()

    async def send(self, session: AsyncSession, conversation: Any) -> Optional[Dict[str, Any]]:
        return await self.build_text(
            session,
            conversation,
            "יופי! שמחים לדעת שתוכל להגיע ל{{event.name}} של {{event.inviters}} 🥳\nרק כדי שנוכל להתכונן כמו שצריך – כמה אנשים תגיעו? 😊\n\n *הגב בבקשה במספר בלבד*",
        )


