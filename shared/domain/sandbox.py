"""Sandbox phone numbers: never messaged, never called.

Used by the App Store review account and its demo event, so a reviewer pressing
"send" can't reach a real person. Covered:
  - 050-00000XX (Israeli +972 50 00000 XX): the demo guests;
  - REVIEW_LOGIN_PHONE, the reviewer's own sign-in number (owner notifications).
outpost-service fakes a successful WhatsApp send for them; voice-service cancels
the call instead of dialing.
"""
import os

_SANDBOX_PREFIX = "9725000000"  # 050-00000XX


def _digits(phone) -> str:
    d = "".join(c for c in str(phone or "") if c.isdigit())
    if d.startswith("00"):
        d = d[2:]
    if d.startswith("0"):
        d = "972" + d[1:]
    return d


def is_sandbox_phone(phone) -> bool:
    d = _digits(phone)
    if not d:
        return False
    if d.startswith(_SANDBOX_PREFIX) and len(d) == 12:
        return True
    review = _digits(os.getenv("REVIEW_LOGIN_PHONE"))
    return bool(review) and d == review
