from typing import Any, Dict
import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from states.base_state import BaseState
from utils.phone import normalize_phone


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
        
        logger = __import__('logging').getLogger(__name__)
        logger.info(f"NoteInfoState processing incoming message: '{text_content}'")
        
        # Get conversation values before any potential errors
        try:
            event_id_value = conversation.event_id
            guest_phone_value = conversation.guest_phone
        except Exception as e:
            logger.warning(f"Failed to get conversation values: {e}")
            return
        
        if text_content:
            event_id_str = str(event_id_value) if event_id_value else None
            guest_phone = normalize_phone(guest_phone_value)
            
            if not guest_phone:
                logger.warning(f"Cannot update notes: invalid guest_phone")
                return
            
            if not event_id_str:
                logger.warning(f"Cannot update notes: missing event_id")
                return
            
            logger.info(f"Updating notes for guest {guest_phone}")
            
            try:
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
                            SET notes = :notes
                            WHERE phone = :phone AND event_id = CAST(:event_id AS uuid)
                        """),
                        {
                            "notes": text_content,
                            "phone": guest_phone,
                            "event_id": str(event_id_uuid)
                        }
                    )
                else:
                    result = await session.execute(
                        text("""
                            UPDATE guests 
                            SET notes = :notes
                            WHERE phone = :phone AND CAST(event_id AS text) = :event_id
                        """),
                        {
                            "notes": text_content,
                            "phone": guest_phone,
                            "event_id": event_id_str
                        }
                    )
                if result.rowcount > 0:
                    await session.commit()
                    logger.info(f"Successfully updated notes, rows updated: {result.rowcount}")
                else:
                    logger.warning(f"No rows updated for notes update")
            except Exception as e:
                logger.warning(f"Failed to update notes: {e}", exc_info=True)
                await session.rollback()

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return await self.build_text(session, conversation, "בוודאי 😊 נשמח אם תכתוב לנו את ההערה כאן 👇")


