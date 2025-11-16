from __future__ import annotations
import re
from typing import Any, Dict, Optional, Tuple, List
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# מיפוי של שמות הימים באנגלית לעברית
WEEKDAY_HEBREW = {
    0: "יום שני",
    1: "יום שלישי",
    2: "יום רביעי",
    3: "יום חמישי",
    4: "יום שישי",
    5: "יום שבת",
    6: "יום ראשון"
}


def _format_event_date(event_date_str: str) -> str:
    """Format date string (ISO format) to 'יום שלישי, ה־3.12.25' style."""
    if not event_date_str:
        return ""
    if isinstance(event_date_str, datetime):
        dt = event_date_str
    else:
        dt = datetime.fromisoformat(str(event_date_str).replace('Z', '+00:00'))
    weekday = WEEKDAY_HEBREW.get(dt.weekday(), "יום")  # weekday() returns 0=Monday, 6=Sunday
    day = dt.day
    month = dt.month
    year = str(dt.year)[-2:]
    return f"{weekday}, ה־{day}.{month}.{year}"


def _format_event_time(event_date_str: str) -> str:
    """Extract just the time (HH:MM) from an ISO datetime string."""
    if not event_date_str:
        return ""
    if isinstance(event_date_str, datetime):
        dt = event_date_str
    else:
        dt = datetime.fromisoformat(str(event_date_str).replace('Z', '+00:00'))
    return dt.strftime("%H:%M")


def _format_inviters(inviters: List[Dict[str, str]]) -> str:
    """Format inviters list as 'fn ln ו fn ln' (Hebrew format)."""
    if not inviters:
        return " "  # Return space instead of empty string for WhatsApp API compatibility
    
    formatted_names = [f"{inviter.get('fn', '')} {inviter.get('ln', '')}" for inviter in inviters]
    return " ו ".join(formatted_names)


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
    async def build_template(self, session: AsyncSession, conversation: Any, template_name: str, language: str, params: List[str]) -> Dict[str, Any]:
        parameters: Dict[str, str] = {}
        for idx, val in enumerate(params, start=1):
            # Render placeholders in each parameter
            rendered_val = await self._render_text(session, conversation, val)
            parameters[str(idx)] = rendered_val
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
                # Fetch event including inviters
                result = await session.execute(
                    text("SELECT id, name, event_date, location, inviters FROM events WHERE id = :event_id"),
                    {"event_id": event_id}
                )
                event_row = result.first()
                if event_row:
                    event_data = dict(event_row._mapping) if hasattr(event_row, '_mapping') else dict(event_row)
                    replacements['event.name'] = event_data.get('name', 'האירוע')
                    
                    # Format date like handlers.py
                    event_date = event_data.get('event_date')
                    if event_date:
                        replacements['event.date'] = _format_event_date(str(event_date))
                    else:
                        replacements['event.date'] = 'התאריך'
                    
                    # Format time like handlers.py
                    if event_date:
                        replacements['event.time'] = _format_event_time(str(event_date))
                    else:
                        replacements['event.time'] = 'השעה'
                    
                    replacements['event.location'] = event_data.get('location', 'המיקום')
                    
                    # Format inviters like handlers.py
                    inviters = event_data.get('inviters', [])
                    if inviters:
                        # Handle both JSON string and already parsed list
                        if isinstance(inviters, str):
                            import json
                            try:
                                inviters = json.loads(inviters)
                            except:
                                inviters = []
                        replacements['event.inviters'] = _format_inviters(inviters if isinstance(inviters, list) else [])
                    else:
                        replacements['event.inviters'] = ' '  # Space for WhatsApp API compatibility
            
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

    async def build_interactive(self, session: AsyncSession, conversation: Any, text: str, buttons: List[str]) -> Dict[str, Any]:
        # Render placeholders in text
        rendered_text = await self._render_text(session, conversation, text)
        
        action_buttons = []
        for idx, title in enumerate(buttons[:3], start=1):
            action_buttons.append({
                "type": "reply",
                "reply": {"id": f"{self.id}__BTN_{idx}", "title": title}
            })
        interactive = {
            "type": "button",
            "body": {"text": rendered_text},
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


