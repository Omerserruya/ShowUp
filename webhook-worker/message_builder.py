import re
from typing import Any, Dict, Optional
from urllib.parse import urlparse


class MessageBuilder:
    """Builds WhatsApp messages (template or plain text) from YAML-like configuration.

    The configuration is a dictionary where each top-level key is a message_id and the
    value is a definition containing type, content and optional buttons/parameters.
    """

    _PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*(guest|event)\.([a-zA-Z0-9_]+)\s*\}\}")

    def __init__(self, config: Dict[str, Any]):
        if not isinstance(config, dict):
            raise ValueError("messages config must be a dict")
        self.config = config

    def _render_placeholders(self, text: str, event: Optional[dict], guest: Optional[dict]) -> str:
        """Render {{guest.field}} and {{event.field}} placeholders in a string.

        Missing objects/fields are ignored gracefully (left as-is).
        """
        if not isinstance(text, str):
            return text

        def replacer(match: re.Match) -> str:
            scope = match.group(1)
            key = match.group(2)
            source = guest if scope == "guest" else event
            try:
                if isinstance(source, dict) and key in source and source[key] is not None:
                    return str(source[key])
            except Exception:
                pass
            # If not found, return the original token
            return match.group(0)

        return self._PLACEHOLDER_PATTERN.sub(replacer, text)

    def _render_buttons(self, buttons: Optional[list], event: Optional[dict], guest: Optional[dict]) -> Optional[list]:
        if not buttons:
            return None
        rendered = []
        for btn in buttons:
            if not isinstance(btn, dict):
                continue
            # Support both {type, text} and {title, payload} shapes
            btn_type = btn.get("type") or "quick_reply"
            text_raw = btn.get("text") or btn.get("title") or ""
            text = self._render_placeholders(text_raw, event, guest)
            button_obj = {"type": btn_type, "text": text}
            if "payload" in btn:
                button_obj["payload"] = btn.get("payload")
            rendered.append(button_obj)
        return rendered or None

    def _build_template(self, definition: Dict[str, Any], event: Optional[dict], guest: Optional[dict]) -> Dict[str, Any]:
        template_name = definition.get("template_name") or definition.get("template")
        if not template_name:
            raise ValueError("template message missing 'template_name'")

        language = definition.get("language") or "he"
        params_cfg = definition.get("parameters", {}) or {}

        # Parameters may be a list or a dict. Convert to 1-based numeric keys as strings.
        rendered_params: Dict[str, str] = {}
        if isinstance(params_cfg, list):
            for idx, v in enumerate(params_cfg, start=1):
                rendered_params[str(idx)] = self._render_placeholders(str(v), event, guest)
        elif isinstance(params_cfg, dict):
            for k, v in params_cfg.items():
                key_str = str(k)
                value_str = self._render_placeholders(str(v), event, guest)
                rendered_params[key_str] = value_str
        else:
            # Unsupported parameters format; ignore
            rendered_params = {}

        message: Dict[str, Any] = {
            "platform": "WA",
            "template": template_name,
            "language": language,
            "parameters": rendered_params,
        }

        buttons = self._render_buttons(definition.get("buttons"), event, guest)
        if buttons:
            message["buttons"] = buttons

        # recipient is inferred from guest.phone when available
        if isinstance(guest, dict) and guest.get("phone"):
            message["recipient"] = guest["phone"]

        return message

    def _build_text(self, definition: Dict[str, Any], event: Optional[dict], guest: Optional[dict]) -> Dict[str, Any]:
        raw_text = definition.get("message") or definition.get("text") or ""
        rendered_text = self._render_placeholders(raw_text, event, guest)

        message: Dict[str, Any] = {
            "platform": "WA",
            "type": "text",
            "text": rendered_text,
        }

        buttons = self._render_buttons(definition.get("buttons"), event, guest)
        if buttons:
            message["buttons"] = buttons

        if isinstance(guest, dict) and guest.get("phone"):
            message["recipient"] = guest["phone"]

        return message

    def _validate_interactive(self, definition: Dict[str, Any]) -> None:
        """Validate interactive message definition."""
        buttons = definition.get("buttons") or definition.get("links") or []
        if not buttons or len(buttons) == 0:
            raise ValueError("Interactive messages must have at least one button")
        
        # WhatsApp allows max 3 buttons
        if len(buttons) > 3:
            raise ValueError("Interactive messages support maximum 3 buttons")
        
        for idx, btn in enumerate(buttons, start=1):
            if not isinstance(btn, dict):
                raise ValueError(f"Button {idx} must be a dictionary")
            
            btn_type = btn.get("type")
            if btn_type == "reply":
                if not btn.get("title"):
                    raise ValueError(f"Reply button {idx} must have 'title'")
                if not btn.get("payload"):
                    raise ValueError(f"Reply button {idx} must have 'payload'")
            elif btn_type == "url":
                if not btn.get("title"):
                    raise ValueError(f"URL button {idx} must have 'title'")
                url = btn.get("url")
                if not url:
                    raise ValueError(f"URL button {idx} must have 'url'")
                # Basic URL validation
                try:
                    parsed = urlparse(str(url))
                    if not parsed.scheme or not parsed.netloc:
                        raise ValueError(f"URL button {idx} has invalid URL format: {url}")
                except Exception as e:
                    raise ValueError(f"URL button {idx} has invalid URL: {str(e)}")
            else:
                raise ValueError(f"Button {idx} has invalid type '{btn_type}'. Must be 'reply' or 'url'")

    def _build_interactive(self, definition: Dict[str, Any], event: Optional[dict], guest: Optional[dict]) -> Dict[str, Any]:
        """Build WhatsApp interactive message payload."""
        # Validate first
        self._validate_interactive(definition)
        
        # Get text body
        raw_text = definition.get("text") or definition.get("message") or ""
        rendered_text = self._render_placeholders(raw_text, event, guest)
        
        if not rendered_text:
            raise ValueError("Interactive messages must have a text body")
        
        # Process buttons
        buttons_cfg = definition.get("buttons") or []
        action_buttons = []
        
        for idx, btn_cfg in enumerate(buttons_cfg, start=1):
            btn_type = btn_cfg.get("type")
            title = self._render_placeholders(btn_cfg.get("title", ""), event, guest)
            
            if btn_type == "reply":
                payload = btn_cfg.get("payload", title)
                action_buttons.append({
                    "type": "reply",
                    "reply": {
                        "id": f"BTN_{idx}",
                        "title": title
                    }
                })
            elif btn_type == "url":
                url = self._render_placeholders(str(btn_cfg.get("url", "")), event, guest)
                action_buttons.append({
                    "type": "url",
                    "url": url,
                    "title": title
                })
        
        # Build WhatsApp API payload structure
        interactive_payload = {
            "type": "interactive",
            "interactive": {
                "type": "button",
                "body": {
                    "text": rendered_text
                },
                "action": {
                    "buttons": action_buttons
                }
            }
        }
        
        # Wrap in our standard message format
        message: Dict[str, Any] = {
            "platform": "WA",
            "recipient": guest.get("phone") if isinstance(guest, dict) else None,
            "interactive": interactive_payload["interactive"]
        }
        
        return message

    def build(self, message_id: str, event: Optional[dict] = None, guest: Optional[dict] = None) -> Dict[str, Any]:
        """Return a fully rendered message dict ready for the Outpost Service.

        Supports two types:
          - type: "template" (uses template_name, language, parameters)
          - type: "message"  (plain text)
        """
        if not message_id:
            raise ValueError("message_id is required")

        definition = self.config.get(message_id)
        if not isinstance(definition, dict):
            raise ValueError(f"message_id '{message_id}' not found in configuration")

        msg_type = definition.get("type")
        if msg_type == "template":
            return self._build_template(definition, event, guest)
        if msg_type == "message" or msg_type == "text":
            return self._build_text(definition, event, guest)
        if msg_type == "interactive":
            return self._build_interactive(definition, event, guest)

        raise ValueError(f"Invalid message type for '{message_id}': {msg_type}. Must be 'template', 'message'/'text', or 'interactive'")


