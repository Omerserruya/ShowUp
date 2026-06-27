"""Event lifecycle state machine SSOT (Phase 13).

draft -> active -> completed -> archived, with cancel available from draft/active.
archived and cancelled are terminal.
"""
from __future__ import annotations

from shared.domain.enums import EventState

EVENT_TRANSITIONS = {
    EventState.DRAFT: {EventState.ACTIVE, EventState.CANCELLED},
    EventState.ACTIVE: {EventState.COMPLETED, EventState.CANCELLED},
    EventState.COMPLETED: {EventState.ARCHIVED},
    EventState.ARCHIVED: set(),
    EventState.CANCELLED: set(),
}

# States in which an event is "live" (the legacy `active` boolean is True).
LIVE_STATES = {EventState.DRAFT, EventState.ACTIVE}


def _as_state(value) -> EventState:
    return value if isinstance(value, EventState) else EventState(value)


def can_transition_event(frm, to) -> bool:
    try:
        return _as_state(to) in EVENT_TRANSITIONS.get(_as_state(frm), set())
    except ValueError:
        return False


def is_live(state) -> bool:
    try:
        return _as_state(state) in LIVE_STATES
    except ValueError:
        return False
