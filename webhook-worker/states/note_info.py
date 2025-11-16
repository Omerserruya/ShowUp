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
            guest_id_value = conversation.guest_id
            event_id_value = conversation.event_id
            guest_phone_value = conversation.guest_phone
        except Exception as e:
            logger.warning(f"Failed to get conversation values: {e}")
            return
        
        if text_content:
            logger.info(f"Updating notes")
            
            try:
                # First try to update by guest_id if available (most reliable)
                if guest_id_value:
                    result = await session.execute(
                        text("""
                            UPDATE guests 
                            SET notes = :notes
                            WHERE id = CAST(:guest_id AS uuid)
                        """),
                        {
                            "notes": text_content,
                            "guest_id": str(guest_id_value)
                        }
                    )
                    if result.rowcount > 0:
                        await session.commit()
                        logger.info(f"Successfully updated notes by guest_id {guest_id_value}, rows updated: {result.rowcount}")
                        
                        # Also update status to 'attending' since guest completed RSVP flow with a note
                        logger.info(f"Guest completed RSVP with note, updating status to 'attending'")
                        try:
                            status_result = await session.execute(
                                text("""
                                    UPDATE guests 
                                    SET status = :status
                                    WHERE id = CAST(:guest_id AS uuid)
                                """),
                                {
                                    "status": "attending",
                                    "guest_id": str(guest_id_value)
                                }
                            )
                            if status_result.rowcount > 0:
                                await session.commit()
                                logger.info(f"Successfully updated status to 'attending' by guest_id {guest_id_value}, rows updated: {status_result.rowcount}")
                        except Exception as status_e:
                            logger.warning(f"Failed to update status: {status_e}", exc_info=True)
                            await session.rollback()
                        return
                
                # Fallback to phone + event_id if guest_id is not available
                event_id_str = str(event_id_value) if event_id_value else None
                guest_phone = normalize_phone(guest_phone_value)
                
                if not guest_phone:
                    logger.warning(f"Cannot update notes: invalid guest_phone")
                    return
                
                if not event_id_str:
                    logger.warning(f"Cannot update notes: missing event_id")
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
                    
                    # Also update status to 'attending' since guest completed RSVP flow with a note
                    logger.info(f"Guest completed RSVP with note, updating status to 'attending'")
                    try:
                        if guest_id_value:
                            status_result = await session.execute(
                                text("""
                                    UPDATE guests 
                                    SET status = :status
                                    WHERE id = CAST(:guest_id AS uuid)
                                """),
                                {
                                    "status": "attending",
                                    "guest_id": str(guest_id_value)
                                }
                            )
                            if status_result.rowcount > 0:
                                await session.commit()
                                logger.info(f"Successfully updated status to 'attending' by guest_id {guest_id_value}, rows updated: {status_result.rowcount}")
                                return
                        
                        # Fallback to phone + event_id
                        if event_id_uuid:
                            status_result = await session.execute(
                                text("""
                                    UPDATE guests 
                                    SET status = :status
                                    WHERE phone = :phone AND event_id = CAST(:event_id AS uuid)
                                """),
                                {
                                    "status": "attending",
                                    "phone": guest_phone,
                                    "event_id": str(event_id_uuid)
                                }
                            )
                        else:
                            status_result = await session.execute(
                                text("""
                                    UPDATE guests 
                                    SET status = :status
                                    WHERE phone = :phone AND CAST(event_id AS text) = :event_id
                                """),
                                {
                                    "status": "attending",
                                    "phone": guest_phone,
                                    "event_id": event_id_str
                                }
                            )
                        
                        if status_result.rowcount > 0:
                            await session.commit()
                            logger.info(f"Successfully updated status to 'attending', rows updated: {status_result.rowcount}")
                    except Exception as status_e:
                        logger.warning(f"Failed to update status: {status_e}", exc_info=True)
                        await session.rollback()
                else:
                    logger.warning(f"No rows updated for notes update")
            except Exception as e:
                logger.warning(f"Failed to update notes: {e}", exc_info=True)
                await session.rollback()

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return await self.build_text(session, conversation, "בוודאי 😊 נשמח אם תכתוב לנו את ההערה כאן 👇")


