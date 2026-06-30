"""Template engine SSOT (Phase 8): allowed variables + lifecycle state machine.

Templates may ONLY use approved variables - never arbitrary placeholders. The
base allow-list is fixed; per-event custom fields flagged applies_to_template
extend it. The lifecycle is an explicit state machine; only APPROVED/ACTIVE
templates may be used to send.
"""
from __future__ import annotations

import re
from typing import Iterable, Set

from shared.domain.enums import TemplateState

# Fixed, approved base variables available to every template.
ALLOWED_TEMPLATE_VARS: Set[str] = {
    "guest_name",
    "event_name",
    "event_date",
    "venue",
    "host_name",
}

_VAR_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


def extract_vars(body: str) -> Set[str]:
    """Return the set of {{variable}} names used in a template body."""
    return set(_VAR_RE.findall(body or ""))


def validate_template_body(body: str, extra_allowed: Iterable[str] | None = None) -> Set[str]:
    """Ensure every variable used is in the allow-list. Raises ValueError otherwise.

    extra_allowed lets per-event custom fields (applies_to_template) be referenced.
    Returns the set of variables actually used.
    """
    allowed = set(ALLOWED_TEMPLATE_VARS) | set(extra_allowed or [])
    used = extract_vars(body)
    unknown = used - allowed
    if unknown:
        raise ValueError(
            f"unknown template variables: {sorted(unknown)}; allowed: {sorted(allowed)}"
        )
    return used


# Allowed lifecycle transitions. Rejection from Meta returns to DRAFT (with a
# rejection_reason); there is no separate 'rejected' state.
TEMPLATE_TRANSITIONS = {
    TemplateState.DRAFT: {TemplateState.VALIDATED, TemplateState.DELETED},
    TemplateState.VALIDATED: {TemplateState.META_PENDING, TemplateState.DRAFT, TemplateState.DELETED},
    TemplateState.META_PENDING: {TemplateState.APPROVED, TemplateState.DRAFT, TemplateState.DELETED},
    TemplateState.APPROVED: {TemplateState.ACTIVE, TemplateState.ARCHIVED, TemplateState.DELETED},
    TemplateState.ACTIVE: {TemplateState.ARCHIVED, TemplateState.DELETED},
    TemplateState.ARCHIVED: {TemplateState.DELETED},
    TemplateState.DELETED: set(),
}

USABLE_STATES = {TemplateState.APPROVED, TemplateState.ACTIVE}


def _as_state(value) -> TemplateState:
    return value if isinstance(value, TemplateState) else TemplateState(value)


def can_transition(frm, to) -> bool:
    try:
        return _as_state(to) in TEMPLATE_TRANSITIONS.get(_as_state(frm), set())
    except ValueError:
        return False


def is_usable(state) -> bool:
    """Whether a template in this state may be used to send."""
    try:
        return _as_state(state) in USABLE_STATES
    except ValueError:
        return False
