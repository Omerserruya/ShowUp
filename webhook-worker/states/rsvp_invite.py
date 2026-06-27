from typing import Any, Dict, Optional
import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from states.base_state import BaseState
from utils.phone import normalize_phone
from shared.domain.enums import RsvpAction


class RsvpInviteState(BaseState):
    id = "rsvp_invite"
    # Semantic routing: the next state is chosen by the resolved RsvpAction
    # (button payload/id), never by matching the displayed button text.
    action_next = {
        RsvpAction.CONFIRMED: "rsvp_count",
        RsvpAction.DECLINED: "rsvp_decline",
        RsvpAction.MAYBE: "rsvp_decline",
        RsvpAction.UNKNOWN: "didnt_understand",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        # Call parent to update last_response
        await super().process_incoming(session, message, conversation)
        
        # Resolve the semantic action; the status is derived from it, never from
        # matching button text. Any confirm/decline/maybe label maps consistently.
        action = self.resolve_action(message)
        guest_status = action.to_guest_status()
        if guest_status is None:
            return  # UNKNOWN -> not a status-changing response
        status_value = guest_status.value  # canonical: 'confirmed' / 'declined' / 'maybe'

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
        logger.info(f"Updating status to '{status_value}' for guest")
        
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

    async def send(self, session: AsyncSession, conversation: Any) -> Optional[Dict[str, Any]]:
        # Template per original spec: event_no_pic with 6 params
        return await self.build_template(
            session,
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


