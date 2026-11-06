"""Gift details for an event: where guests send the hosts a money gift.

The hosts open a group in Bit or PayBox themselves and paste its invite link
(or give a phone number for a plain Bit transfer). Guests reach it through our
page `/g/{code}`, so ONE approved WhatsApp template (button base `/g/`) serves
every event, and a host can swap the link without a new Meta approval. The money
goes straight from guest to host - ShowUp never touches it and takes no fee.

Stored as `events.gift` JSON: {"url", "bit_phone", "code"}. `code` is random and
kept for the event's lifetime, so links already sent keep working after the host
edits (or even clears) the details.
"""
from __future__ import annotations

import re
import secrets
from typing import Any, Dict, Optional
from urllib.parse import urlparse

URL_MAX = 500

# Provider label for the guest page button. Any https link is accepted (hosts
# may use another app), these just get a named button.
_PROVIDERS = (
    ("paybox", ("payboxapp.com", "payboxapp.page.link", "paybox.co.il")),
    ("bit", ("bitpay.co.il", "bit.co.il", "bit.page.link")),
)

_IL_MOBILE = re.compile(r"^05\d{8}$")


def provider_of(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    for name, domains in _PROVIDERS:
        if any(host == d or host.endswith("." + d) for d in domains):
            return name
    return "other"


def clean_url(raw: Any) -> str:
    """'' for empty; ValueError for anything that is not a plain https link."""
    url = str(raw or "").strip()
    if not url:
        return ""
    if len(url) > URL_MAX or any(c.isspace() for c in url):
        raise ValueError("gift_url_invalid")
    p = urlparse(url)
    if p.scheme != "https" or not p.hostname or "." not in p.hostname:
        raise ValueError("gift_url_invalid")
    return url


def clean_bit_phone(raw: Any) -> str:
    """An Israeli mobile as 05XXXXXXXX ('' for empty; ValueError otherwise)."""
    digits = re.sub(r"\D", "", str(raw or ""))
    if not digits:
        return ""
    if digits.startswith("972"):
        digits = "0" + digits[3:]
    if not _IL_MOBILE.match(digits):
        raise ValueError("gift_phone_invalid")
    return digits


def merge_gift(current: Optional[Dict[str, Any]], patch: Dict[str, Any]) -> Dict[str, Any]:
    """Apply an owner edit. Only `url` and `bit_phone` are writable; the page
    code is minted once and never changes."""
    out = dict(current or {})
    if "url" in patch:
        out["url"] = clean_url(patch.get("url"))
    if "bit_phone" in patch:
        out["bit_phone"] = clean_bit_phone(patch.get("bit_phone"))
    if not out.get("code"):
        out["code"] = secrets.token_urlsafe(8)
    return {"url": out.get("url") or "", "bit_phone": out.get("bit_phone") or "", "code": out["code"]}


def gift_ready(gift: Optional[Dict[str, Any]]) -> bool:
    g = gift or {}
    return bool(g.get("code") and (g.get("url") or g.get("bit_phone")))


def gift_page_code(gift: Optional[Dict[str, Any]]) -> str:
    """The `/g/{code}` segment. Kept even after the hosts clear the details, so a
    round scheduled earlier still sends (its page then says the gift is closed)
    instead of failing on an empty button; new rounds are gated on gift_ready."""
    return str((gift or {}).get("code") or "")


def format_phone(phone: str) -> str:
    return f"{phone[:3]}-{phone[3:6]}-{phone[6:]}" if len(phone) == 10 else phone
