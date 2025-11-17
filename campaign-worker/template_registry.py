"""
Template registry that maps campaign template keys to TemplateSpec objects.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List

from templates.handlers import (
    select_all_guests,
    select_pending_guests,
    select_attending_guests,
    select_attending_missing_count,
    select_attending_guests_with_table,
    select_rsvp_pending_guests,
    params_simple_name,
    params_event_no_pic,
    params_general_rsvp,
    params_reminder,
    params_rsvp_reminder,
)

AudienceSelector = Callable[[Any, str, Dict[str, Any]], List[Dict[str, Any]]]
ParamsBuilder = Callable[[Dict[str, Any], Dict[str, Any]], Dict[str, Any]]


@dataclass(frozen=True)
class TemplateSpec:
    wa_template: str
    audience_selector: AudienceSelector
    params_builder: ParamsBuilder


TEMPLATE_SPECS: Dict[str, TemplateSpec] = {
    # Legacy templates explicitly wired in the previous registry
    "save_the_date": TemplateSpec(
        wa_template="save_the_date",
        audience_selector=select_all_guests,
        params_builder=params_simple_name,
    ),
    "event_no_pic": TemplateSpec(
        wa_template="event_no_pic",
        audience_selector=select_all_guests,
        params_builder=params_event_no_pic,
    ),
    "rsvp_reminder": TemplateSpec(
        wa_template="rsvp_reminder",
        audience_selector=select_pending_guests,
        params_builder=params_rsvp_reminder,
    ),
    # Templates that previously relied on the default handler but had custom parameters
    "general_rsvp": TemplateSpec(
        wa_template="general_rsvp",
        audience_selector=select_all_guests,
        params_builder=params_general_rsvp,
    ),
    "reminder": TemplateSpec(
        wa_template="reminder",
        audience_selector=select_pending_guests,
        params_builder=params_reminder,
    ),
}


def _default_spec(template_name: str) -> TemplateSpec:
    """Return the legacy default behavior for unknown templates."""
    return TemplateSpec(
        wa_template=template_name,
        audience_selector=select_all_guests,
        params_builder=params_simple_name,
    )


def get_template_spec(template_name: str) -> TemplateSpec:
    """Resolve the TemplateSpec for a campaign template key."""
    return TEMPLATE_SPECS.get(template_name, _default_spec(template_name))
