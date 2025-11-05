from __future__ import annotations

from typing import Any, Dict, Optional, Tuple, List

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
            "message_type": "text",
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

    def build_text(self, conversation: Any, text: str) -> Dict[str, Any]:
        return {
            "platform": "WA",
            "recipient": conversation.guest_phone,
            "message_type": "text",
            "text": text,
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


