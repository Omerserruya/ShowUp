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

def _has_phone(guest: Dict[str, Any]) -> bool:
    return bool(guest.get("phone"))


def select_all_guests(conn, event_id: str, event_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return every guest that has a phone number (previous default behavior)."""
    guests = fetch_guests_for_event(conn, event_id)
    return [g for g in guests if _has_phone(g)]


def select_pending_guests(conn, event_id: str, event_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Guests who haven't responded yet (status == 'invited').
    Mirrors the existing RSVP flow definition of "pending".
    """
    guests = fetch_guests_for_event(conn, event_id)
    return [g for g in guests if _has_phone(g) and (g.get("status") == "invited")]


def select_attending_guests(conn, event_id: str, event_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Guests who confirmed attendance (status == 'attending')."""
    guests = fetch_guests_for_event(conn, event_id)
    return [g for g in guests if _has_phone(g) and (g.get("status") == "attending")]


def select_attending_missing_count(conn, event_id: str, event_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Attending guests that still don't have a guest_count (NULL)."""
    guests = fetch_guests_for_event(conn, event_id)
    return [
        g
        for g in guests
        if _has_phone(g) and (g.get("status") == "attending") and g.get("guest_count") is None
    ]


def select_attending_guests_with_table(conn, event_id: str, event_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Attending guests who already have a table assignment."""
    guests = fetch_guests_for_event(conn, event_id)
    return [
        g
        for g in guests
        if _has_phone(g) and (g.get("status") == "attending") and g.get("table_number") is not None
    ]


# Backwards-compatible alias for existing registry usage
def select_rsvp_pending_guests(conn, event_id: str, event_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    return select_pending_guests(conn, event_id, event_data)


# ---------------------------------------------------------------------------
# Parameter builders (same values/order as the previous build_params logic)
# ---------------------------------------------------------------------------

def params_simple_name(event_data: Dict[str, Any], guest: Dict[str, Any]) -> Dict[str, Any]:
    """Fallback parameters used for templates like save_the_date."""
    return {"name": guest.get("name", "")}

# rsvp template
def params_event_no_pic(event_data: Dict[str, Any], guest: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "1": _format_event_date(_serialize_datetime(event_data.get("event_date", ""))),
        "2": _format_event_time(_serialize_datetime(event_data.get("event_date", ""))),
        "3": event_data.get("location", ""),
        "4": _format_inviters(event_data.get("inviters", [])),
    }

# rsvp template (with optional image header)
def params_general_rsvp(event_data: Dict[str, Any], guest: Dict[str, Any]) -> Dict[str, Any]:
    """
    Structured parameters:
    - header: optional image for template header (header_image_url)
    - body:   same placeholders as before (1..6)
    """
    return {
        "header": {
            "type": "image",
            "media_url": "https://joywedding.co.il/wp-content/uploads/2021/07/%D7%A2%D7%95%D7%AA%D7%A7-%D7%A9%D7%9C-%D7%94%D7%9B%D7%9C-23-scaled.jpg",
        },
        "body": {
            "1": event_data.get("name", ""),
            "2": _format_inviters(event_data.get("inviters", [])),
            "3": _format_event_date(_serialize_datetime(event_data.get("event_date", ""))),
            "4": _format_event_time(_serialize_datetime(event_data.get("event_date", ""))),
            "5": event_data.get("location", ""),
            "6": guest.get("name", "testname"),
        },
    }

# reminder template - for who hasn't responded yet
def params_reminder(event_data: Dict[str, Any], guest: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "guest_name": guest.get("name", ""),
        "event_name": event_data.get("name", ""),
        "inviters": _format_inviters(event_data.get("inviters", [])),
    }
# event reminder template - for all guests (with optional Waze URL button)
def params_event_remind(event_data: Dict[str, Any], guest: Dict[str, Any]) -> Dict[str, Any]:
    """
    Structured parameters:
    - body:    time/location/inviters (1..4)
    - buttons: optional URL button for Waze (index 0)
    """
    return {
        "body": {
            "1": _format_event_time(_serialize_datetime(event_data.get("event_date", ""))),
            "2": event_data.get("location", ""),
            "3": event_data.get("location", ""),  # TBD - add address
            "4": _format_inviters(event_data.get("inviters", [])),
        },
        "buttons": [
            {
                "type": "url",
                "index": 0,
                "url": event_data.get("waze_url", "https://www.waze.com/ul?q=%D7%A0%D7%95%D7%A2%D7%94+%D7%94%D7%91%D7%99%D7%AA+%D7%9C%D7%90%D7%99%D7%A8%D7%95%D7%A2%D7%99%D7%9D&navigate=yes"),
            }
        ],
    }
# table info template - for attending guests who already have a table assignment
def params_table_info(event_data: Dict[str, Any], guest: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "1": guest.get("name", ""),
        "2": event_data.get("name", ""),
        "3": _format_inviters(event_data.get("inviters", [])),
        "4": guest.get("table_number", ""),
    }

# thank you template - for attending guests who already have a table assignment
def params_thank_you(event_data: Dict[str, Any], guest: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "1": event_data.get("name", ""),
        "2": _format_inviters(event_data.get("inviters", [])),
    }