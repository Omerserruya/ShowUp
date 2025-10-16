import re
from typing import Tuple

phone_regex = re.compile(r"^[+]?\d{7,15}$")


def validate_phone(phone: str) -> bool:
    return bool(phone_regex.match(phone))


def paginate_params(page: int | None, page_size: int | None) -> Tuple[int, int]:
    p = page or 1
    ps = page_size or 20
    if p < 1:
        p = 1
    if ps < 1:
        ps = 1
    if ps > 200:
        ps = 200
    return p, ps


def normalize_phone(phone: str) -> str:
    """Normalize phone to E.164-like: keep leading + and digits only."""
    phone = phone.strip()
    if phone.startswith('+'):
        digits = re.sub(r"\D", "", phone[1:])
        return f"+{digits}"
    return re.sub(r"\D", "", phone)


