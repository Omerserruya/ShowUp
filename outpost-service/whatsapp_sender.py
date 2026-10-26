"""
WhatsApp Business Cloud API Sender

Handles sending messages via WhatsApp Business Cloud API using Facebook Graph API.
"""

import os
import logging
import json
from typing import Dict, Any, List
from datetime import datetime

import httpx

import meta_errors
from utils.phone import mask_phone


class WhatsAppSender:
    """Handles WhatsApp message sending via Business Cloud API."""
    
    def __init__(self):
        self.logger = logging.getLogger("whatsapp_sender")
        # Clean the API token to ensure it's ASCII-safe
        raw_token = os.getenv("WA_API_B")
        self.api_token = raw_token.encode('utf-8').decode('ascii', errors='ignore') if raw_token else None
        # Per-handler phone numbers (mission: OTP / AI assistant / campaigns & RSVP
        # each on its own number). Every message carries an optional "sender" key
        # ("campaign" is the default, "assistant" for owner-facing messages); each
        # falls back to the shared WA_PHONE_ID when no dedicated number is set.
        default_phone_id = os.getenv("WA_PHONE_ID")
        self.phone_ids = {
            "campaign": os.getenv("CAMPAIGN_WA_PHONE_ID") or default_phone_id,
            "assistant": os.getenv("ASSISTANT_WA_PHONE_ID") or default_phone_id,
        }
        self.phone_id = self.phone_ids["campaign"]
        self.base_url = self._url_for(None)

        if not self.api_token or not self.phone_id:
            raise ValueError("WA_API_B and WA_PHONE_ID environment variables are required")

        # ONE keep-alive client for the whole process. A new AsyncClient per
        # message meant a fresh TCP+TLS handshake to graph.facebook.com every
        # send (~100-300ms), which capped throughput at a few msgs/sec.
        max_conns = int(os.getenv("OUTPOST_HTTP_MAX_CONNECTIONS", "64"))
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(float(os.getenv("OUTPOST_HTTP_TIMEOUT", "20")), connect=5.0),
            limits=httpx.Limits(max_connections=max_conns, max_keepalive_connections=max_conns,
                                keepalive_expiry=60.0),
            headers={"Authorization": f"Bearer {self.api_token}",
                     "Content-Type": "application/json"},
            http2=False,
        )

    def phone_id_for(self, sender: str = None) -> str:
        """The phone_number_id a message will be sent from (token-bucket key)."""
        return self.phone_ids.get(sender or "campaign") or self.phone_id

    def _url_for(self, sender: str = None) -> str:
        phone_id = self.phone_ids.get(sender or "campaign") or self.phone_id
        return f"https://graph.facebook.com/v22.0/{phone_id}/messages"

    def _build_template_payload(self, recipient: str, template_name: str, parameters: Dict[str, Any], language: str = None) -> Dict[str, Any]:
        """Build WhatsApp template message payload.

        Supports two styles:
        1. Legacy flat dict: {"1": "...", "2": "..."} -> mapped to body parameters only.
        2. Structured dict with components:
           {
             "header": {"type": "text" | "image", "text": "...", "media_url": "..."},
             "body": {"1": "...", "2": "..."},
             "buttons": [
               {"type": "url", "index": 0, "url": "..."}
             ]
           }
        """

        def _build_text_params_from_dict(d: Dict[Any, Any]) -> List[Dict[str, str]]:
            """Convert a dict of values into an ordered list of text parameters."""
            if not d:
                return []

            # Helper function to extract numeric key for sorting
            def get_sort_key(item):
                key = item[0]
                try:
                    if isinstance(key, str) and key.isdigit():
                        return int(key)
                    elif isinstance(key, int):
                        return key
                    return float("inf")
                except (ValueError, TypeError):
                    return float("inf")

            try:
                sorted_items = sorted(d.items(), key=get_sort_key)
            except Exception:
                sorted_items = list(d.items())

            result: List[Dict[str, str]] = []
            for _key, value in sorted_items:
                if value is None:
                    text_value = " "
                elif isinstance(value, str) and not value.strip():
                    text_value = " "
                else:
                    text_value = str(value)
                result.append({"type": "text", "text": text_value})
            return result

        # Decide if we're in structured mode (header/body/buttons) or legacy flat dict
        is_structured = any(k in parameters for k in ("header", "body", "buttons"))

        components: List[Dict[str, Any]] = []

        if is_structured:
            header_conf = parameters.get("header") or {}
            body_conf = parameters.get("body") or {}
            buttons_conf = parameters.get("buttons") or []

            # Header component (optional)
            header_type = header_conf.get("type")
            if header_type == "text":
                text_value = header_conf.get("text") or " "
                components.append(
                    {
                        "type": "header",
                        "parameters": [
                            {
                                "type": "text",
                                "text": text_value,
                            }
                        ],
                    }
                )
            elif header_type == "image":
                media_url = header_conf.get("media_url")
                # Only add header component if media_url is provided and not empty
                if media_url and media_url.strip():
                    components.append(
                        {
                            "type": "header",
                            "parameters": [
                                {
                                    "type": "image",
                                    "image": {"link": media_url},
                                }
                            ],
                        }
                    )

            # Body component (required for template)
            body_params = _build_text_params_from_dict(body_conf)
            if body_params:  # Only add body if there are parameters
                components.append({"type": "body", "parameters": body_params})

            # Buttons (optional) – currently only URL buttons with a single text parameter
            if isinstance(buttons_conf, list):
                for btn in buttons_conf:
                    if not isinstance(btn, dict):
                        continue
                    if btn.get("type") != "url":
                        # For now we only support URL buttons
                        continue
                    index = btn.get("index", 0)
                    url_value = btn.get("url")
                    # Only add button if URL is provided and not empty
                    if url_value and url_value.strip():
                        components.append(
                            {
                                "type": "button",
                                "sub_type": "url",
                                "index": int(index),  # WhatsApp API expects integer, not string
                                "parameters": [
                                    {
                                        "type": "text",
                                        "text": url_value,
                                    }
                                ],
                            }
                        )
        else:
            # Legacy behavior: all parameters are body text params
            body_params = _build_text_params_from_dict(parameters)
            components.append({"type": "body", "parameters": body_params})
        
        # Set language code: "reminder" template uses English, all others use Hebrew
        # Language is data-driven: use the value the catalog resolved (passed in the
        # message). Fall back to the legacy per-name rule only for old messages that
        # carry no language, so nothing regresses during rollout.
        language_code = language or ("en" if template_name == "reminder" else "he")
        
        payload = {
            "messaging_product": "whatsapp",
            "to": recipient,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": language_code},
                "components": components,
            },
        }
        
        return payload
    
    def _build_text_payload(self, recipient: str, text: str) -> Dict[str, Any]:
        """Build WhatsApp text message payload."""
        
        payload = {
            "messaging_product": "whatsapp",
            "to": recipient,
            "type": "text",
            "text": {
                "body": text
            }
        }
        
        return payload
    
    def _build_interactive_payload(self, recipient: str, interactive: Dict[str, Any]) -> Dict[str, Any]:
        """Build WhatsApp interactive message payload."""
        
        payload = {
            "messaging_product": "whatsapp",
            "to": recipient,
            "type": "interactive",
            "interactive": interactive
        }
        
        return payload
    
    async def _post(self, payload: Dict[str, Any], sender: str = None) -> Dict[str, Any]:
        """POST one message on the shared keep-alive client.

        Raises MetaSendError (classified) on any non-2xx or transport failure.
        No retry here: retries go through the consumer's delayed retry queues so
        a slow/failing message never pins a concurrency slot while sleeping.
        Never logs the payload (guest PII) - only status + Meta's error code.
        """
        try:
            response = await self.client.post(self._url_for(sender), json=payload)
        except httpx.HTTPError as exc:  # timeouts, connection resets, DNS...
            raise meta_errors.from_transport(exc) from exc

        if response.status_code >= 400:
            try:
                body = response.json()
            except Exception:
                body = None
            err = meta_errors.from_response(response.status_code, body, response.text[:500])
            self.logger.warning(
                "WhatsApp API rejected message",
                extra={
                    "status_code": response.status_code,
                    "error_code": err.error_code,
                    "error_kind": err.kind,
                    "detail": err.detail[:300],
                    "recipient": mask_phone(payload.get("to")),
                    "sender": sender or "campaign",
                },
            )
            raise err

        try:
            return response.json()
        except Exception:
            return {}

    async def send_template_message(self, recipient: str, template_name: str, parameters: Dict[str, Any],
                                    language: str = None, sender: str = None) -> Dict[str, Any]:
        """Send a WhatsApp template message. Raises MetaSendError."""
        payload = self._build_template_payload(recipient, template_name, parameters, language)
        return await self._post(payload, sender)

    async def send_text_message(self, recipient: str, text: str, sender: str = None) -> Dict[str, Any]:
        """Send a WhatsApp free-text message. Raises MetaSendError."""
        return await self._post(self._build_text_payload(recipient, text), sender)

    async def send_interactive_message(self, recipient: str, interactive: Dict[str, Any],
                                       sender: str = None) -> Dict[str, Any]:
        """Send a WhatsApp interactive message. Raises MetaSendError."""
        return await self._post(self._build_interactive_payload(recipient, interactive), sender)

    async def aclose(self) -> None:
        try:
            await self.client.aclose()
        except Exception:
            pass
