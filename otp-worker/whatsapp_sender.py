"""
WhatsApp sender for OTP codes.

Sends the approved Hebrew WhatsApp authentication template named "otp" via the
Meta Cloud API. WhatsApp is the single, canonical channel for delivering
verification codes — there is no other delivery channel or fallback.
"""

import logging
import os
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)

GRAPH_API_VERSION = os.getenv("WA_API_VERSION", "v22.0")


class WhatsAppOTPSender:
    """Sends OTP codes via the WhatsApp authentication template."""

    def __init__(self):
        self.token = (os.getenv("WA_API_B") or "").strip()
        self.phone_id = (os.getenv("WA_PHONE_ID") or "").strip()
        # Approved authentication template — Hebrew, named "otp".
        self.template_name = os.getenv("WA_OTP_TEMPLATE_NAME", "otp")
        self.language_code = os.getenv("WA_OTP_LANG", "he")
        # Authentication templates carry the code in the body AND in a one-tap /
        # copy-code button. Set WA_OTP_WITH_BUTTON=false only if the approved
        # template has no button (body-only), to avoid a #132000 parameter error.
        self.with_button = (os.getenv("WA_OTP_WITH_BUTTON", "true").lower() != "false")
        self.base_url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{self.phone_id}/messages"

        if not self.token or not self.phone_id:
            logger.warning(
                "WA_API_B / WA_PHONE_ID not set — WhatsApp OTP sending is disabled"
            )

    def _build_payload(self, recipient: str, code: str) -> Dict[str, Any]:
        components: list = [
            {"type": "body", "parameters": [{"type": "text", "text": code}]},
        ]
        if self.with_button:
            # One-tap autofill / copy-code button — its parameter is the code too.
            components.append(
                {
                    "type": "button",
                    "sub_type": "url",
                    "index": "0",
                    "parameters": [{"type": "text", "text": code}],
                }
            )
        return {
            "messaging_product": "whatsapp",
            "to": recipient,
            "type": "template",
            "template": {
                "name": self.template_name,
                "language": {"code": self.language_code},
                "components": components,
            },
        }

    def send(self, recipient: str, code: str) -> str:
        """
        Send the OTP and report the outcome so the caller can decide whether to
        retry. Returns one of:
          "sent"       — accepted by the WhatsApp Cloud API.
          "permanent"  — will never succeed as-is (bad/expired token, bad
                         template params, bad recipient). Do NOT requeue.
          "transient"  — temporary (network, rate limit, 5xx). Safe to retry.
        """
        if not self.token or not self.phone_id:
            # Misconfiguration — retrying won't help until the config changes.
            logger.error("WhatsApp credentials not configured; cannot send OTP")
            return "permanent"

        # Meta expects the MSISDN without a leading "+".
        to = (recipient or "").strip().lstrip("+").replace(" ", "")
        if not to:
            logger.error("Empty recipient; cannot send OTP")
            return "permanent"

        try:
            response = requests.post(
                self.base_url,
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json",
                },
                json=self._build_payload(to, code),
                timeout=15,
            )
            response.raise_for_status()
            logger.info(
                "OTP sent via WhatsApp template '%s' (lang=%s) to %s",
                self.template_name,
                self.language_code,
                to,
            )
            return "sent"
        except requests.exceptions.HTTPError as e:
            resp = e.response
            status = resp.status_code if resp is not None else None
            body = ""
            if resp is not None:
                try:
                    body = resp.text
                except Exception:
                    body = ""
            # 4xx (except 429 rate-limit) means the request itself is bad —
            # expired token (401/190), bad params, bad number. Retrying the
            # identical request just hot-loops, so treat it as permanent.
            permanent = status is not None and 400 <= status < 500 and status != 429
            outcome = "permanent" if permanent else "transient"
            logger.error("Failed to send WhatsApp OTP (%s, %s): %s", status, outcome, body)
            return outcome
        except requests.exceptions.RequestException as e:
            # Network error / timeout — temporary, worth retrying.
            logger.error("WhatsApp OTP request failed (transient): %s", e)
            return "transient"


# Global instance
_sender: Optional[WhatsAppOTPSender] = None


def get_whatsapp_sender() -> WhatsAppOTPSender:
    """Get or create the WhatsApp OTP sender instance."""
    global _sender
    if _sender is None:
        _sender = WhatsAppOTPSender()
    return _sender


def send_otp_via_whatsapp(phone: str, code: str) -> str:
    """
    Send an OTP code over WhatsApp using the approved "otp" template.

    Args:
        phone: Recipient phone number in international format (e.g. +972501234567).
        code: The verification code.

    Returns:
        "sent" | "permanent" | "transient" — see WhatsAppOTPSender.send.
    """
    return get_whatsapp_sender().send(phone, code)
