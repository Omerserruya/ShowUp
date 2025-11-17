"""
Template-related helpers for campaign selection and WhatsApp parameter building.

Audience selectors:
    select_* functions decide which guests receive a campaign.

Parameter builders:
    params_* functions produce the WhatsApp template body parameters
    in exactly the same order/value set used before this refactor.
"""

from typing import List, Dict, Any
from datetime import datetime
import locale
import logging

from db import fetch_guests_for_event

# הגדר את הלוקל לעברית (בלינוקס צריך לוודא שה-locale קיים)
try:
    locale.setlocale(locale.LC_TIME, "he_IL.UTF-8")
except locale.Error:
    # fallback אם לא קיים locale עברי
    pass

# מיפוי של שמות הימים באנגלית לעברית
WEEKDAY_HEBREW = {
    0: "יום שני",
    1: "יום שלישי",
    2: "יום רביעי",
    3: "יום חמישי",
    4: "יום שישי",
    5: "יום שבת",
    6: "יום ראשון"
}

def _format_event_date(event_date_str: str) -> str:
    """Format date string (ISO format) to 'יום שלישי, ה־3.12.25' style."""
    if not event_date_str:
        return ""
    dt = datetime.fromisoformat(event_date_str)
    weekday = WEEKDAY_HEBREW.get(dt.weekday(), "יום")  # weekday() returns 0=Monday, 6=Sunday
    day = dt.day
    month = dt.month
    year = str(dt.year)[-2:]
    return f"{weekday}, ה־{day}.{month}.{year}"

def _format_event_time(event_date_str: str) -> str:
    """Extract just the time (HH:MM) from an ISO datetime string."""
    if not event_date_str:
        return ""
    dt = datetime.fromisoformat(event_date_str)
    return dt.strftime("%H:%M")


def _serialize_datetime(obj):
    """Convert datetime objects to ISO format strings for JSON serialization."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    return obj


def _format_inviters(inviters: List[Dict[str, str]]) -> str:
    """Format inviters list as 'fn ln ו fn ln' (Hebrew format)."""
    logger = logging.getLogger("handlers")
    logger.info(f"Formatting inviters - input: {inviters}")
    
    if not inviters:
        logger.info("No inviters found, returning space")
        return " "  # Return space instead of empty string for WhatsApp API compatibility
    
    formatted_names = [f"{inviter.get('fn', '')} {inviter.get('ln', '')}" for inviter in inviters]
    result = " ו ".join(formatted_names)
    logger.info(f"Formatted inviters result: '{result}'")
    return result


# ---------------------------------------------------------------------------
# Audience selectors
# ---------------------------------------------------------------------------

def select_all_guests(conn, event_id: str, event_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return every guest that has a phone number (previous default behavior)."""
    guests = fetch_guests_for_event(conn, event_id)
    return [g for g in guests if g.get("phone")]


def select_rsvp_pending_guests(conn, event_id: str, event_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Return guests who were previously considered "pending" for RSVP reminders.

    NOTE: This intentionally mirrors the legacy implementation, including the fact
    that only guests with phone numbers and status == 'invited' are returned.
    """
    guests = fetch_guests_for_event(conn, event_id)
    return [g for g in guests if g.get("phone") and g.get("status") == "invited"]


# ---------------------------------------------------------------------------
# Parameter builders (same values/order as the previous build_params logic)
# ---------------------------------------------------------------------------

def params_simple_name(event_data: Dict[str, Any], guest: Dict[str, Any]) -> Dict[str, Any]:
    """Fallback parameters used for templates like save_the_date."""
    return {"name": guest.get("name", "")}


def params_event_no_pic(event_data: Dict[str, Any], guest: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "1": _format_event_date(_serialize_datetime(event_data.get("event_date", ""))),
        "2": _format_event_time(_serialize_datetime(event_data.get("event_date", ""))),
        "3": event_data.get("location", ""),
        "4": _format_inviters(event_data.get("inviters", [])),
    }


def params_general_rsvp(event_data: Dict[str, Any], guest: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "1": "event type",
        "2": _format_inviters(event_data.get("inviters", [])),
        "3": _format_event_date(_serialize_datetime(event_data.get("event_date", ""))),
        "4": _format_event_time(_serialize_datetime(event_data.get("event_date", ""))),
        "5": event_data.get("location", ""),
        "6": guest.get("name", "testname"),
    }


def params_reminder(event_data: Dict[str, Any], guest: Dict[str, Any]) -> Dict[str, Any]:
    return {
        **params_simple_name(event_data, guest),
        "event_name": event_data.get("name", ""),
        "date": _serialize_datetime(event_data.get("event_date", "")),
    }


def params_rsvp_reminder(event_data: Dict[str, Any], guest: Dict[str, Any]) -> Dict[str, Any]:
    return {
        **params_simple_name(event_data, guest),
        "event_name": event_data.get("name", ""),
        "date": _serialize_datetime(event_data.get("event_date", "")),
        "rsvp_deadline": _serialize_datetime(event_data.get("rsvp_deadline", "")),
    }
