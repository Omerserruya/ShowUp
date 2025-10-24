"""
Template handlers for different campaign types.

Each handler function:
1. Takes (conn, event_id, campaign_data) as parameters
2. Returns a list of guests who should receive the message
3. Defines build_params function for parameter construction
"""

from typing import List, Dict, Any
from datetime import datetime
from db import fetch_guests_for_event
from datetime import datetime
import locale

# הגדר את הלוקל לעברית (בלינוקס צריך לוודא שה-locale קיים)
try:
    locale.setlocale(locale.LC_TIME, "he_IL.UTF-8")
except locale.Error:
    # fallback אם לא קיים locale עברי
    pass

def _format_event_date(event_date_str: str) -> str:
    """Format date string (ISO format) to 'יום שלישי, ה־3.12.25' style."""
    if not event_date_str:
        return ""
    dt = datetime.fromisoformat(event_date_str)
    weekday = dt.strftime("%A")  # e.g. 'יום שלישי'
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


def save_the_date(conn, event_id: str, event_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Send to all guests with phone numbers."""
    guests = fetch_guests_for_event(conn, event_id)
    return [g for g in guests if g.get("phone")]



def rsvp_reminder(conn, event_id: str, event_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Send to guests who haven't responded to RSVP."""
    guests = fetch_guests_for_event(conn, event_id)
    return [g for g in guests if g.get("phone") and g.get("status") == "invited"]


def build_params(template_name: str, guest: Dict[str, Any], event_data: Dict[str, Any]) -> Dict[str, Any]:
    """Build template parameters based on template name and guest data."""
    base_params = {"name": guest.get("name", "")}
  
    if template_name == "event_no_pic":
        return {
            "1": _format_event_date(_serialize_datetime(event_data.get("event_date", ""))),
            "2": _format_event_time(_serialize_datetime(event_data.get("event_date", ""))),
            "3":  event_data.get("location", ""),
            "4":"inviters"
        }
    elif template_name == "reminder":
        return {
            **base_params,
            "event_name": event_data.get("name", ""),
            "date": _serialize_datetime(event_data.get("event_date", "")),
        }
    elif template_name == "rsvp_reminder":
        return {
            **base_params,
            "event_name": event_data.get("name", ""),
            "date": _serialize_datetime(event_data.get("event_date", "")),
            "rsvp_deadline": _serialize_datetime(event_data.get("rsvp_deadline", "")),
        }
    else:
        # Default fallback
        return base_params
