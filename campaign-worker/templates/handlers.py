"""
Template handlers for different campaign types.

Each handler function:
1. Takes (conn, event_id, campaign_data) as parameters
2. Returns a list of guests who should receive the message
3. Defines build_params function for parameter construction
"""

from typing import List, Dict, Any
from db import fetch_guests_for_event


def save_the_date(conn, event_id: str, campaign_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Send to all guests with phone numbers."""
    guests = fetch_guests_for_event(conn, event_id)
    return [g for g in guests if g.get("phone")]


def reminder(conn, event_id: str, campaign_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Send only to guests without RSVP status."""
    guests = fetch_guests_for_event(conn, event_id)
    return [g for g in guests if g.get("phone") and not g.get("rsvp_status")]


def rsvp_reminder(conn, event_id: str, campaign_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Send to guests who haven't responded to RSVP."""
    guests = fetch_guests_for_event(conn, event_id)
    return [g for g in guests if g.get("phone") and g.get("status") == "invited"]


def build_params(template_name: str, guest: Dict[str, Any], campaign_data: Dict[str, Any]) -> Dict[str, Any]:
    """Build template parameters based on template name and guest data."""
    base_params = {"name": guest.get("name", "")}
    
    if template_name == "save_the_date":
        return {
            **base_params,
            "date": campaign_data.get("event_date", ""),
            "event_name": campaign_data.get("name", ""),
            "location": campaign_data.get("location", ""),
        }
    elif template_name == "reminder":
        return {
            **base_params,
            "event_name": campaign_data.get("name", ""),
            "date": campaign_data.get("event_date", ""),
        }
    elif template_name == "rsvp_reminder":
        return {
            **base_params,
            "event_name": campaign_data.get("name", ""),
            "date": campaign_data.get("event_date", ""),
            "rsvp_deadline": campaign_data.get("rsvp_deadline", ""),
        }
    else:
        # Default fallback
        return base_params
