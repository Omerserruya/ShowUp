"""
Phone number normalization utilities.

This module provides functions to normalize phone numbers to a canonical format
that matches WhatsApp's format (digits only, no +, no 00 prefix).
"""


def normalize_phone(phone: str | None) -> str | None:
    """
    Normalize a phone number to canonical digits-only format.
    
    Rules:
    - Remove all non-digit characters
    - If it starts with "00", strip those two zeros (international prefix)
    - Do not keep the "+" prefix
    - Result matches WhatsApp's format (e.g., "972525401686")
    
    Examples:
        "+972525401686" -> "972525401686"
        "972525401686" -> "972525401686"
        "00972525401686" -> "972525401686"
        "+1-555-123-4567" -> "15551234567"
        None -> None
        "" -> None
    
    Args:
        phone: Phone number string (may contain +, -, spaces, etc.) or None
    
    Returns:
        Normalized phone number (digits only) or None if input is None/empty
    """
    if not phone:
        return None
    
    # Remove all non-digit characters
    digits = "".join(ch for ch in phone if ch.isdigit())
    
    # If empty after removing non-digits, return None
    if not digits:
        return None
    
    # If it starts with "00", strip those two zeros (international prefix)
    if digits.startswith("00"):
        digits = digits[2:]
    
    return digits

