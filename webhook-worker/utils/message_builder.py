import os
import yaml
from typing import Any, Dict, Optional


class MessageBuilder:
    def __init__(self, config_path: Optional[str] = None):
        self.path = config_path or os.path.join(os.path.dirname(__file__), "..", "messages.yaml")
        self.messages: Dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        if os.path.exists(self.path):
            with open(self.path, "r", encoding="utf-8") as f:
                self.messages = yaml.safe_load(f) or {}

    def _render(self, text: str, event: Optional[Dict[str, Any]], guest: Optional[Dict[str, Any]]) -> str:
        def repl(value: str) -> str:
            if not isinstance(value, str):
                return value
            out = value
            if event:
                for k, v in event.items():
                    out = out.replace(f"{{{{event.{k}}}}}", str(v))
            if guest:
                for k, v in guest.items():
                    out = out.replace(f"{{{{guest.{k}}}}}", str(v))
            return out
        return repl(text)

    def build(self, state_id: str, *, event: Optional[Dict[str, Any]] = None, guest: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        spec = self.messages.get(state_id) or {}
        msg_type = spec.get("type")
        if msg_type == "template":
            params = spec.get("parameters") or []
            rendered_params: Dict[str, str] = {}
            for idx, val in enumerate(params, start=1):
                rendered_params[str(idx)] = self._render(str(val), event, guest)
            return {
                "platform": "WA",
                "message_type": "template",
                "template": spec.get("template_name"),
                "language": spec.get("language", "he"),
                "parameters": rendered_params,
            }
        if msg_type == "text":
            return {
                "platform": "WA",
                "message_type": "text",
                "text": self._render(spec.get("text", ""), event, guest),
            }
        if msg_type == "interactive":
            # Build interactive structure per WhatsApp spec supported by outpost
            buttons = spec.get("buttons") or []
            action_buttons = []
            for idx, btn in enumerate(buttons[:3], start=1):
                if btn.get("type") == "reply":
                    action_buttons.append({
                        "type": "reply",
                        "reply": {"id": f"{state_id}__BTN_{idx}", "title": self._render(btn.get("title", ""), event, guest)}
                    })
                elif btn.get("type") == "url":
                    # We can't send URL buttons in interactive via Cloud API reply buttons; skip or convert to text link
                    # We'll append the URL as plain text
                    pass
            interactive = {
                "type": "button",
                "body": {"text": self._render(spec.get("text", ""), event, guest)},
                "action": {"buttons": action_buttons}
            }
            return {
                "platform": "WA",
                "message_type": "interactive",
                "interactive": interactive,
            }
        # Fallback
        return {
            "platform": "WA",
            "message_type": "text",
            "text": "",
        }


