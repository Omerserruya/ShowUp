from __future__ import annotations
import json
import re
from typing import Any, Dict, Optional, Tuple, List
from datetime import datetime
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from utils.phone import normalize_phone
from shared.domain.delivery import canonical_phone_digits, canonical_phone_sql
from shared.domain import flow_config as _fc
import logging as _logging

_logger = _logging.getLogger(__name__)

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


def _location_name(loc: Any) -> str:
    """Event.location may be a plain string OR a structured JSON object
    ({name, address, coordinates}). Return the venue NAME (never the raw JSON,
    which must not leak into a message)."""
    if not loc:
        return ""
    data = loc
    if isinstance(loc, str):
        s = loc.strip()
        if not s.startswith("{"):
            return s
        import json as _json
        try:
            data = _json.loads(s)
        except (ValueError, TypeError):
            return s
    if isinstance(data, dict):
        return str(data.get("name") or data.get("address") or "").strip()
    return str(loc)


def _format_event_date(event_date_str: str) -> str:
    """'יום שלישי, ה־3.12.25' in ISRAEL time - the shared formatter the message
    templates use (formatting the UTC value said 17:30 for a 19:30 event)."""
    from shared.domain.messaging.resolver import format_event_date
    return format_event_date(event_date_str) if event_date_str else ""


def _format_event_time(event_date_str: str) -> str:
    """HH:MM in Israel time (see _format_event_date)."""
    from shared.domain.messaging.resolver import format_event_time
    return format_event_time(event_date_str) if event_date_str else ""


def _host_display(event_data: Dict[str, Any]) -> str:
    from shared.domain.messaging.resolver import VariableResolver
    subjects = event_data.get("subjects") or {}
    if isinstance(subjects, str):
        try:
            subjects = json.loads(subjects)
        except ValueError:
            subjects = {}
    try:
        vals = VariableResolver({"subjects": subjects}, media_base="", public_base="")._resolve_subjects()
    except Exception:
        return ""
    return vals.get("host_display_name", "")


def _format_inviters(inviters: List[Dict[str, str]]) -> str:
    """Format inviters list as 'fn ln ו fn ln' (Hebrew format)."""
    if not inviters:
        return " "  # Return space instead of empty string for WhatsApp API compatibility
    
    formatted_names = [f"{inviter.get('fn', '')} {inviter.get('ln', '')}" for inviter in inviters]
    return " ו ".join(formatted_names)


_DEFAULT_CFG = _fc.default_flow()


async def load_flow_config(event_id: Any) -> _fc.FlowConfig:
    """Resolve the admin flow settings for an event. Cached 60s; on a miss it
    reads on its OWN short-lived connection (a failed read is rolled back there,
    never on the handler's session, whose ORM objects must stay loaded).
    Never raises - any problem means today's defaults."""
    hit = _fc.cached_flow_for_event(event_id)
    if hit is not None:
        return hit
    try:
        from db.session import engine
        async with engine.connect() as conn:
            return await _fc.aresolve_flow_for_event(conn, event_id)
    except Exception as exc:
        _logger.warning("flow settings unavailable (%s) - using defaults", exc)
        return _DEFAULT_CFG


class BaseState:
    id: str = "base"
    next_states: Dict[str, str] = {}
    # Optional semantic routing: {RsvpAction -> next_state_id}. When the incoming
    # message carries a resolved semantic action, this is consulted BEFORE the
    # text map, so routing never depends on the displayed button label.
    semantic_next: Dict[Any, str] = {}
    # Admin flow settings (shared/domain/flow_config.py): the button group this
    # state SENDS, and where each button key leads. Routing by key is
    # label-independent: button_id `{state}__BTN_{n}` first, then the configured
    # label, then the default label (messages sent before a label was edited).
    button_path: Optional[str] = None
    button_next: Dict[str, str] = {}

    def __init__(self, flow: "FlowManager"):
        self.flow = flow
        self._cfg: Optional[_fc.FlowConfig] = None

    # ---- admin flow settings ----

    @property
    def cfg(self) -> _fc.FlowConfig:
        """Effective flow for this conversation (defaults until loaded)."""
        return self._cfg if self._cfg is not None else _DEFAULT_CFG

    def set_cfg(self, cfg: Optional[_fc.FlowConfig]) -> None:
        self._cfg = cfg

    async def get_cfg(self, session: AsyncSession, conversation: Any) -> _fc.FlowConfig:
        if self._cfg is None:
            self._cfg = await load_flow_config(getattr(conversation, "event_id", None))
        return self._cfg

    def shown_button_keys(self, cfg: Optional[_fc.FlowConfig] = None) -> List[str]:
        """Keys of the buttons this state shows, in order (index n-1 = BTN_n)."""
        if not self.button_path:
            return []
        return list(_fc.SCHEMA[self.button_path]["keys"])

    def tapped_key(self, message: Dict[str, Any]) -> Optional[str]:
        if not self.button_path:
            return None
        keys = self.shown_button_keys(self.cfg)
        bid = str(message.get("button_id") or "")
        prefix = f"{self.id}__btn_"
        if bid.lower().startswith(prefix):
            try:
                n = int(bid[len(prefix):])
            except ValueError:
                n = 0
            if 1 <= n <= len(keys):
                return keys[n - 1]
        text_value = (message.get("text") or "").strip()
        if not text_value:
            return None
        for key in keys:
            if text_value == self.cfg.button(self.button_path, key):
                return key
        for key in keys:
            if text_value == _DEFAULT_CFG.button(self.button_path, key):
                return key
        return None

    async def cfg_text(self, session: AsyncSession, conversation: Any, path: str) -> str:
        cfg = await self.get_cfg(session, conversation)
        return cfg.legacy_text(path)

    async def cfg_buttons(self, session: AsyncSession, conversation: Any) -> List[str]:
        cfg = await self.get_cfg(session, conversation)
        return [cfg.button(self.button_path, k) for k in self.shown_button_keys(cfg)] if self.button_path else []

    async def on_enter(self, session: AsyncSession, conversation: Any) -> None:
        return None

    async def on_exit(self, session: AsyncSession, conversation: Any) -> None:
        return None

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        """Base behaviour: stamp guests.last_response. Child states call super()."""
        try:
            await self.update_guest(session, conversation, {"last_response": datetime.now()})
        except Exception as e:
            _logger.warning("Failed to update last_response: %s", e)
            await session.rollback()

    # ---- guest-row helpers (one place for the guest_id -> phone+event fallback) ----

    async def update_guest(self, session: AsyncSession, conversation: Any, values: Dict[str, Any],
                           *, extra_where: str = "") -> int:
        """UPDATE the conversation's guest row with `values` and commit.

        Targets the guest by `conversation.guest_id` when known, else by
        (canonical phone, event_id). Phones are compared as canonical
        international digits on both sides - guests.phone is stored as
        +972..., 0..., or digits, while conversations store WhatsApp digits.
        Returns the number of rows updated. Raises on DB error (the caller's
        message is then retried) - never silently loses the RSVP.
        """
        if not values:
            return 0
        sets = ", ".join(f"{col} = :v_{col}" for col in values)
        params = {f"v_{col}": val for col, val in values.items()}
        guest_id = getattr(conversation, "guest_id", None)
        rows = 0
        if guest_id:
            res = await session.execute(
                text(f"UPDATE guests SET {sets} WHERE id = CAST(:guest_id AS uuid) {extra_where}"),
                {**params, "guest_id": str(guest_id)},
            )
            rows = res.rowcount or 0
        if not rows:
            phone = canonical_phone_digits(normalize_phone(getattr(conversation, "guest_phone", None)))
            event_id = str(getattr(conversation, "event_id", "") or "")
            if phone and event_id:
                res = await session.execute(
                    text(
                        f"UPDATE guests SET {sets} "
                        f"WHERE CAST(event_id AS text) = :event_id "
                        f"AND {canonical_phone_sql('phone')} = :phone {extra_where}"
                    ),
                    {**params, "phone": phone, "event_id": event_id},
                )
                rows = res.rowcount or 0
        await session.commit()
        return rows

    async def set_guest_status(self, session: AsyncSession, conversation: Any, status: str) -> int:
        rows = await self.update_guest(session, conversation, {"status": status})
        _logger.info("Guest status -> %s (state=%s, rows=%d)", status, self.id, rows)
        return rows

    def get_next_state(self, message: Dict[str, Any]) -> str:
        # 0) A tap on one of THIS state's configured buttons (by id or label).
        key = self.tapped_key(message)
        if key and key in self.button_next:
            return self.button_next[key]
        # 1) Semantic action first (label-independent). Only maps recognized
        #    actions; UNKNOWN/None is not in the map, so it falls through.
        action = message.get("action")
        if action is not None and self.semantic_next:
            mapped = self.semantic_next.get(action)
            if mapped:
                return mapped
        # 2) Legacy text matching (last-resort fallback).
        text = (message.get("text") or "").strip()
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
                    text("SELECT id, name, event_date, location, inviters, subjects FROM events WHERE id = :event_id"),
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
                    
                    replacements['event.location'] = _location_name(event_data.get('location')) or 'המיקום'
                    
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
                    if not replacements['event.inviters'].strip():
                        # No inviters typed: the hosts named in the event details
                        # (couple / company), as the message templates do.
                        replacements['event.inviters'] = _host_display(event_data) or ' ' 
            
            # Fetch guest data
            if is_uuid:
                if getattr(conversation, "guest_id", None):
                    result = await session.execute(
                        text("SELECT id, name FROM guests WHERE id = CAST(:gid AS uuid) LIMIT 1"),
                        {"gid": str(conversation.guest_id)},
                    )
                else:
                    result = await session.execute(
                        text(
                            "SELECT id, name FROM guests WHERE CAST(event_id AS text) = :event_id "
                            f"AND {canonical_phone_sql('phone')} = :phone LIMIT 1"
                        ),
                        {"phone": canonical_phone_digits(normalize_phone(conversation.guest_phone)),
                         "event_id": event_id},
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


