"""Signed per-guest invitation tokens.

The public invitation used to identify a guest by PHONE NUMBER alone: anyone
could POST a phone to `/rsvp/lookup` and read that guest's name, RSVP status,
party size and free-text notes, then POST `/rsvp` to overwrite it. With slugs
derived from the event name, both the target and the key were guessable, which
made the endpoint a bulk enumeration oracle over Israeli mobile numbers.

A token replaces the phone as the credential. It is an HMAC over
(version, event_id, guest_id) keyed by a server secret, so it:

* cannot be forged or transferred to another guest - the MAC covers both ids;
* reveals nothing by itself - guest ids are random UUIDs, not phone numbers;
* needs no server-side storage or expiry - invitations stay valid until the
  event, and revoking one guest is a matter of deleting the guest.

Tokens go in the invite link the guest receives over WhatsApp
(`/i/{slug}?g={token}`), so possession of the link is possession of the
credential - the same trust model as a password-reset link.

The public page still works WITHOUT a token: an untokened visitor can submit a
new RSVP (walk-ins, forwarded invitations) but can never READ an existing one.
That preserves the open-invitation UX while closing the lookup oracle.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
from typing import Optional, Tuple

# Bumped only if the token payload format changes; lets old links keep working
# while a new format is rolled out.
_VERSION = "1"
_SEPARATOR = "."
# Truncated to 160 bits: ample against forgery, and keeps the link short enough
# to sit comfortably in a WhatsApp message.
_MAC_BYTES = 20


class InviteTokenSecretMissing(RuntimeError):
    """No signing secret configured - tokens cannot be issued or verified."""


def _secret() -> bytes:
    """The signing key. Falls back to JWT_SECRET so deployments need no new env.

    Raises rather than defaulting to a constant: a hardcoded fallback would make
    every deployment's tokens forgeable by anyone reading this file.
    """
    raw = os.getenv("INVITE_TOKEN_SECRET") or os.getenv("JWT_SECRET")
    if not raw:
        raise InviteTokenSecretMissing(
            "INVITE_TOKEN_SECRET (or JWT_SECRET) must be set to sign invitation tokens"
        )
    return raw.encode("utf-8")


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _sign(event_id: str, guest_id: str) -> str:
    payload = f"{_VERSION}:{event_id}:{guest_id}".encode("utf-8")
    mac = hmac.new(_secret(), payload, hashlib.sha256).digest()[:_MAC_BYTES]
    return _b64(mac)


def make_guest_token(event_id, guest_id) -> str:
    """Issue the invitation token for one guest of one event."""
    e, g = str(event_id), str(guest_id)
    return _SEPARATOR.join((_VERSION, _b64(g.encode("utf-8")), _sign(e, g)))


def verify_guest_token(token: Optional[str], event_id) -> Optional[str]:
    """Return the guest id this token authorises for `event_id`, else None.

    Binding the check to the event is what stops a token issued for one event
    being replayed against another.
    """
    if not token:
        return None
    parts = str(token).split(_SEPARATOR)
    if len(parts) != 3:
        return None
    version, guest_b64, mac = parts
    if version != _VERSION:
        return None
    try:
        padding = "=" * (-len(guest_b64) % 4)
        guest_id = base64.urlsafe_b64decode(guest_b64 + padding).decode("utf-8")
    except Exception:
        return None
    try:
        expected = _sign(str(event_id), guest_id)
    except InviteTokenSecretMissing:
        return None
    # Constant-time: a naive == leaks the MAC one byte at a time under timing.
    if not hmac.compare_digest(mac, expected):
        return None
    return guest_id
