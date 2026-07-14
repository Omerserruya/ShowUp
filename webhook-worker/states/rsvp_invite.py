from typing import Any, Dict, Optional
import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from states.base_state import BaseState
from utils.phone import normalize_phone
from shared.domain.enums import RsvpAction


class RsvpInviteState(BaseState):
    id = "rsvp_invite"
    # SEMANTIC routing (label-independent) - consulted before the text map. The
    # engine understands the action; the catalog owns the button wording.
    semantic_next = {
        RsvpAction.CONFIRMED: "rsvp_count",
        RsvpAction.DECLINED: "rsvp_decline",
        RsvpAction.MAYBE: "rsvp_decline",
    }
    # Legacy text fallback (kept so live templates that still send only a title
    # keep working). Remove once every template carries semantic payloads.
    next_states = {
        "ברור שאני בא!": "rsvp_count",
        "ברור שנגיע !": "rsvp_count",
        "ברור שאגיע!": "rsvp_count",
        "לצערי לא אוכל להגיע ):": "rsvp_decline",
        "עוד מתלבט, תחזרו אלי?": "rsvp_decline",
        "לצערי לא אוכל": "rsvp_decline",
        "לצערי לא אוכל להגיע": "rsvp_decline",
        "עוד מתלבט/ת, תחזרו אלי?": "rsvp_decline",
        "*": "didnt_understand"
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        # Call parent to update last_response
        await super().process_incoming(session, message, conversation)
        
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

        # Determine status from the SEMANTIC action (label-independent). The DB
        # values are the existing ones ("attending"/"declined"/"maybe") so behavior
        # is unchanged. Fall back to legacy text only when there is no action.
        _ACTION_STATUS = {
            RsvpAction.CONFIRMED: "attending",
            RsvpAction.DECLINED: "declined",
            RsvpAction.MAYBE: "maybe",
        }
        status_value = _ACTION_STATUS.get(message.get("action"))
        if status_value is None:
            _LEGACY_TEXT_STATUS = {
                "ברור שאני בא!": "attending",
                "לצערי לא אוכל להגיע ):": "declined",
                "עוד מתלבט, תחזרו אלי?": "maybe",
            }
            status_value = _LEGACY_TEXT_STATUS.get(text_content)
        if status_value is None:
            # Not a status-changing response
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
        # event_no_pic has exactly 4 body params, in this order:
        #   {{1}} event_date  {{2}} event_time  {{3}} venue_name  {{4}} host_name
        return await self.build_template(
            session,
            conversation,
            template_name="event_no_pic",
            language="he",
            params=[
                "{{event.date}}",
                "{{event.time}}",
                "{{event.location}}",
                "{{event.inviters}}",
            ],
        )


