"""Guest phone canonicalization for sending (E.164).

Same rules as aub-service `_canonical_phone` (routers/auth.py): strip non-digits,
drop a leading international "00", map Israeli local numbers (0XXXXXXXXX, or a
bare 9-digit national number) to +972. Manually-entered guests were stored as
"050-1234567" and handed to Meta verbatim, which Meta rejects (review 2.11).
"""
from __future__ import annotations

from typing import Optional


def canonical_phone(phone) -> Optional[str]:
    """'+972501234567' style E.164, or None when the value cannot be a phone."""
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0"):          # local Israeli 0XXXXXXXXX
        digits = "972" + digits[1:]
    elif len(digits) == 9:              # bare 9-digit national number
        digits = "972" + digits
    # E.164 allows up to 15 digits; anything under 10 cannot be a full number.
    if not 10 <= len(digits) <= 15:
        return None
    return "+" + digits


def mask_phone(phone) -> str:
    """Log-safe: last 4 digits only."""
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    return ("***" + digits[-4:]) if digits else ""
