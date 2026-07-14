"""Canonical event-type registry - one place, replacing the three duplicate
label maps in the frontend (EVENT_TYPES / EVENT_TYPE_LABELS / eventTypeMap) and
the loosely-typed string on the backend.

Each entry carries everything any layer needs: the key, Hebrew + English display
names, an emoji, the scheduling key it maps to, and which subject-variable set it
uses. The frontend consumes this via the /catalog API (mirroring the entitlements
pattern) so there is a single definition.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional


class EventType(str, Enum):
    WEDDING = "wedding"
    BRIT = "brit"
    BRITA = "brita"
    BAR = "bar"
    BAT = "bat"
    CORPORATE = "corporate"
    BIRTHDAY = "birthday"
    OTHER = "other"


@dataclass(frozen=True)
class EventTypeMeta:
    key: EventType
    name_he: str
    name_en: str
    emoji: str
    schedule_key: str          # which SCHEDULES entry drives the timeline
    subject_vars: List[str] = field(default_factory=list)  # canonical variable names


# Single canonical registry. schedule_key mirrors the existing
# scheduleKeyForEventType() mapping so timeline behavior is unchanged.
EVENT_TYPES = {
    EventType.WEDDING:   EventTypeMeta(EventType.WEDDING,   "חתונה",     "Wedding",       "💍", "wedding",  ["bride_name", "groom_name", "couple_names"]),
    EventType.BRIT:      EventTypeMeta(EventType.BRIT,      "ברית",      "Brit",          "👶", "brit",     ["baby_name", "mother_name", "father_name", "parents_names"]),
    EventType.BRITA:     EventTypeMeta(EventType.BRITA,     "בריתה",     "Brita",         "🍼", "brit",     ["baby_name", "mother_name", "father_name", "parents_names"]),
    EventType.BAR:       EventTypeMeta(EventType.BAR,       "בר מצווה",  "Bar Mitzvah",   "🎉", "mitzvah",  ["celebrant_name", "parents_names"]),
    EventType.BAT:       EventTypeMeta(EventType.BAT,       "בת מצווה",  "Bat Mitzvah",   "🎀", "mitzvah",  ["celebrant_name", "parents_names"]),
    EventType.CORPORATE: EventTypeMeta(EventType.CORPORATE, "אירוע עסקי", "Corporate",    "🏢", "business", ["company_name"]),
    EventType.BIRTHDAY:  EventTypeMeta(EventType.BIRTHDAY,  "יום הולדת", "Birthday",      "🎂", "social",   ["celebrant_name"]),
    EventType.OTHER:     EventTypeMeta(EventType.OTHER,     "אירוע",     "Event",         "🎊", "wedding",  []),
}


def event_type_of(value) -> Optional[EventType]:
    """Coerce a stored/loose value to an EventType (None if unknown)."""
    if value is None:
        return None
    if isinstance(value, EventType):
        return value
    try:
        return EventType(str(value).strip().lower())
    except ValueError:
        return None


def event_type_meta(value) -> Optional[EventTypeMeta]:
    et = event_type_of(value)
    return EVENT_TYPES.get(et) if et else None
