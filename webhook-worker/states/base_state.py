from __future__ import annotations
import re
from typing import Any, Dict, Optional, Tuple, List

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class BaseState:
    id: str = "base"
    next_states: Dict[str, str] = {}

    def __init__(self, flow: "FlowManager"):
        self.flow = flow

    async def on_enter(self, session: AsyncSession, conversation: Any) -> None:
        return None

    async def on_exit(self, session: AsyncSession, conversation: Any) -> None:
        return None

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        return None

    def get_next_state(self, message: Dict[str, Any]) -> str:
        text = (message.get("text") or "").strip()
        # exact
        if text in self.next_states:
            return self.next_states[text]
        # wildcard
        if "*" in self.next_states:
            return self.next_states["*"]
        return getattr(self.flow, "fallback_state_id", self.flow.initial_state)

    async def send(self, session: AsyncSession, conversation: Any) -> Optional[Dict[str, Any]]:
        # Default: plain text noop
        return {
            "platform": "WA",
            "recipient": conversation.guest_phone,
            "message_type": "free_text",
            "text": "",
            "event_id": str(conversation.event_id),
            "state": self.id,
            "source": "webhook_worker",
        }

    # Helpers for building outpost payloads
    def build_template(self, conversation: Any, template_name: str, language: str, params: List[str]) -> Dict[str, Any]:
        parameters: Dict[str, str] = {}
        for idx, val in enumerate(params, start=1):
            parameters[str(idx)] = str(val)
        return {
            "platform": "WA",
            "recipient": conversation.guest_phone,
            "message_type": "template",
            "template": template_name,
            "language": language,
            "parameters": parameters,
            "event_id": str(conversation.event_id),
            "state": self.id,
            "source": "webhook_worker",
        }

    async def _render_text(self, session: AsyncSession, conversation: Any, template_text: str) -> str:
        """Render placeholders like {{event.name}} in template text."""
        # Find all placeholders
        placeholders = re.findall(r'\{\{(\w+)\.(\w+)\}\}', template_text)
        if not placeholders:
            return template_text
        
        # Build replacement dict
        replacements = {}
        
        # Try to fetch event data if event_id looks like a UUID
        event_id = str(conversation.event_id)
        try:
            # Check if event_id is a UUID (36 chars with dashes)
            is_uuid = len(event_id) == 36 and '-' in event_id
            if is_uuid:
                # Fetch event
                result = await session.execute(
                    text("SELECT id, name, date, location, inviters FROM events WHERE id = :event_id"),
                    {"event_id": event_id}
                )
                event_row = result.first()
                if event_row:
                    event_data = dict(event_row._mapping) if hasattr(event_row, '_mapping') else dict(event_row)
                    replacements['event.name'] = event_data.get('name', 'האירוע')
                    replacements['event.date'] = str(event_data.get('date', 'התאריך')) if event_data.get('date') else 'התאריך'
                    replacements['event.location'] = event_data.get('location', 'המיקום')
                    replacements['event.inviters'] = event_data.get('inviters', 'המארחים')
            
            # Fetch guest data
            if is_uuid:
                result = await session.execute(
                    text("SELECT id, name FROM guests WHERE phone = :phone AND event_id = :event_id LIMIT 1"),
                    {"phone": conversation.guest_phone, "event_id": event_id}
                )
                guest_row = result.first()
                if guest_row:
                    guest_data = dict(guest_row._mapping) if hasattr(guest_row, '_mapping') else dict(guest_row)
                    replacements['guest.name'] = guest_data.get('name', 'אורח/ת יקר/ה')
        except Exception as e:
            # If database fetch fails, use defaults
            logger = __import__('logging').getLogger(__name__)
            logger.warning(f"Failed to fetch event/guest data for rendering: {e}")
        
        # Apply replacements
        rendered = template_text
        for placeholder_type, field in placeholders:
            key = f"{placeholder_type}.{field}"
            value = replacements.get(key, f"{{{{{key}}}}}")  # Keep placeholder if not found
            rendered = rendered.replace(f"{{{{{key}}}}}", value)
        
        return rendered
    
    async def build_text(self, session: AsyncSession, conversation: Any, text: str) -> Dict[str, Any]:
        # Render placeholders in text
        rendered_text = await self._render_text(session, conversation, text)
        return {
            "platform": "WA",
            "recipient": conversation.guest_phone,
            "message_type": "free_text",
            "text": rendered_text,
            "event_id": str(conversation.event_id),
            "state": self.id,
            "source": "webhook_worker",
        }

    def build_interactive(self, conversation: Any, text: str, buttons: List[str]) -> Dict[str, Any]:
        action_buttons = []
        for idx, title in enumerate(buttons[:3], start=1):
            action_buttons.append({
                "type": "reply",
                "reply": {"id": f"{self.id}__BTN_{idx}", "title": title}
            })
        interactive = {
            "type": "button",
            "body": {"text": text},
            "action": {"buttons": action_buttons}
        }
        return {
            "platform": "WA",
            "recipient": conversation.guest_phone,
            "message_type": "interactive",
            "interactive": interactive,
            "event_id": str(conversation.event_id),
            "state": self.id,
            "source": "webhook_worker",
        }


