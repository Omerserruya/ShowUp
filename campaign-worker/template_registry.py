"""
Template registry mapping template names to handler functions.
"""

from templates.handlers import save_the_date, reminder, rsvp_reminder, build_params

# Registry of template handlers
TEMPLATE_HANDLERS = {
    "save_the_date": save_the_date,
    "reminder": reminder,
    "rsvp_reminder": rsvp_reminder,
}

# Default handler for unknown templates
def default_handler(conn, event_id: str, event_data: dict) -> list:
    """Default handler that sends to all guests with phone numbers."""
    from db import fetch_guests_for_event
    guests = fetch_guests_for_event(conn, event_id)
    return [g for g in guests if g.get("phone")]


def get_template_handler(template_name: str):
    """Get template handler function by name."""
    return TEMPLATE_HANDLERS.get(template_name, default_handler)
