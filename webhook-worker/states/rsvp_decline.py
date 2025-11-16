from typing import Any, Dict
import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from states.base_state import BaseState
from utils.phone import normalize_phone


class RsvpDeclineState(BaseState):
    id = "rsvp_decline"
    next_states = {
        "בסוף נוכל להגיע": "rsvp_count",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        # Call parent to update last_response
        await super().process_incoming(session, message, conversation)
        
        # Check if the response is "בסוף נוכל להגיע" (changing mind to attend)
        text_content = (message.get("text") or "").strip()
        
        # Get conversation values
        try:
            guest_id_value = conversation.guest_id
            event_id_value = conversation.event_id
            guest_phone_value = conversation.guest_phone
        except Exception as e:
            logger = __import__('logging').getLogger(__name__)
            logger.warning(f"Failed to get conversation values: {e}")
            return
        
        logger = __import__('logging').getLogger(__name__)
        
        if text_content == "בסוף נוכל להגיע":
            # Guest changed mind - update status to 'attending'
            logger.info(f"Guest changed mind, updating status to 'attending'")
            status_value = "attending"
        else:
            # Guest confirmed decline - update status to 'declined'
            logger.info(f"Guest confirmed decline, updating status to 'declined'")
            status_value = "declined"
        
        try:
            # First try to update by guest_id if available (most reliable)
            if guest_id_value:
                result = await session.execute(
                    text("""
                        UPDATE guests 
                        SET status = :status
                        WHERE id = CAST(:guest_id AS uuid)
                    """),
                    {
                        "status": status_value,
                        "guest_id": str(guest_id_value)
                    }
                )
                if result.rowcount > 0:
                    await session.commit()
                    logger.info(f"Successfully updated status to '{status_value}' by guest_id {guest_id_value}, rows updated: {result.rowcount}")
                    return
            
            # Fallback to phone + event_id if guest_id is not available
            event_id_str = str(event_id_value) if event_id_value else None
            guest_phone = normalize_phone(guest_phone_value)
            
            if not guest_phone or not event_id_str:
                logger.warning(f"Cannot update status: missing guest_phone or event_id")
                return
            
            # Try to convert event_id to UUID if it's a valid UUID string
            try:
                event_id_uuid = uuid.UUID(event_id_str) if event_id_str else None
            except (ValueError, AttributeError):
                event_id_uuid = None
            
            # Try both UUID and string formats
            if event_id_uuid:
                result = await session.execute(
                    text("""
                        UPDATE guests 
                        SET status = :status
                        WHERE phone = :phone AND event_id = CAST(:event_id AS uuid)
                    """),
                    {
                        "status": status_value,
                        "phone": guest_phone,
                        "event_id": str(event_id_uuid)
                    }
                )
            else:
                result = await session.execute(
                    text("""
                        UPDATE guests 
                        SET status = :status
                        WHERE phone = :phone AND CAST(event_id AS text) = :event_id
                    """),
                    {
                        "status": status_value,
                        "phone": guest_phone,
                        "event_id": event_id_str
                    }
                )
            
            if result.rowcount > 0:
                await session.commit()
                logger.info(f"Successfully updated status to '{status_value}', rows updated: {result.rowcount}")
            else:
                logger.warning(f"No rows updated for status update")
        except Exception as e:
            logger.warning(f"Failed to update status: {e}", exc_info=True)
            await session.rollback()

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return await self.build_interactive(
            session,
            conversation,
            "חבל 😢 עדכנו שלא תגיע. אם תתחרט תמיד אפשר לכתוב לנו שוב!",
            ["בסוף נוכל להגיע"],
        )


