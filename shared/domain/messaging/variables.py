"""Canonical variable registry - one logical variable system for the whole
platform, replacing the two disjoint ones (Hebrew wizard tokens vs. Meta slot
numbers).

Templates and copy reference variables by LOGICAL name (guest_name, event_name,
…). The worker never sees slot numbers - those live only in the Meta adapter,
which maps these logical names to Meta components. The legacy Hebrew wizard
tokens ({{שם}}, {{תאריך}}…) are aliased here so old copy keeps resolving and the
wizard preview can migrate without a parallel system.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional


class VarScope(str, Enum):
    GUEST = "guest"      # resolved per recipient
    EVENT = "event"      # resolved once per event
    LINK = "link"        # generated link (per-guest or per-event)
    SUBJECT = "subject"  # event-type specific (bride/baby/…)


@dataclass(frozen=True)
class Variable:
    name: str                    # canonical logical name
    scope: VarScope
    label_he: str
    sample: str                  # sample value for previews
    send_available: bool = True  # resolvable at WhatsApp send time from event+guest
    legacy_tokens: tuple = ()    # Hebrew wizard tokens that mean this variable


# The canonical variable set. `send_available=False` variables exist for the
# wizard/preview but have no send-time source yet (documented gap, not a silent
# hole) - e.g. rsvp_link is generated per guest by a service that the worker does
# not currently call.
_VARS: List[Variable] = [
    # guest
    Variable("guest_name",       VarScope.GUEST, "שם האורח",     "דוד כהן",  True,  ("שם",)),
    Variable("guest_first_name", VarScope.GUEST, "שם פרטי",      "דוד",      True,  ()),
    Variable("guest_last_name",  VarScope.GUEST, "שם משפחה",     "כהן",      True,  ()),
    Variable("party_size",       VarScope.GUEST, "כמות מוזמנים",  "2",        True,  ("כמות_אורחים",)),
    Variable("table_number",     VarScope.GUEST, "מספר שולחן",   "12",       True,  ()),
    # event
    Variable("event_name",    VarScope.EVENT, "שם האירוע",      "החתונה שלנו", True, ("שם_אירוע",)),
    Variable("event_date",    VarScope.EVENT, "תאריך",          "יום שלישי, ה־3.12.25", True, ("תאריך",)),
    Variable("event_time",    VarScope.EVENT, "שעה",            "19:30",    True,  ("שעה",)),
    Variable("venue_name",    VarScope.EVENT, "שם המקום",       "אולמי הגן", True,  ("מיקום",)),
    Variable("venue_address", VarScope.EVENT, "כתובת המקום",    "רחוב הגן 5, תל אביב", True, ()),
    # Canonical host label templates should use - the resolver builds it per event
    # type (couple / family / company); the template never needs to know how.
    Variable("host_display_name", VarScope.EVENT, "המארחים",    "אור ודן",  True,  ()),
    Variable("host_name",     VarScope.EVENT, "שם המזמין",      "משפחת כהן", True,  ("שם_מזמין",)),
    Variable("event_type_name", VarScope.EVENT, "סוג האירוע",   "חתונה",    True,  ("סוג_אירוע",)),
    # links (resolved at send from the event's public invitation slug)
    Variable("rsvp_link",         VarScope.LINK, "קישור לאישור", "https://showup.co.il/r/ab12", True, ("קישור_אישור",)),
    Variable("invitation_link",   VarScope.LINK, "דף ההזמנה",    "https://showup.co.il/i/ab12", True, ("דף_הזמנה",)),
    Variable("nav_link",          VarScope.LINK, "ניווט (Waze)", "https://waze.com/ul?...",     True,  ("ניווט",)),
    # header image asset - resolved at send from the event media (implicit, not a
    # copy token). Declared here so it's a known canonical variable, not a hole.
    Variable("header_image_url",  VarScope.LINK, "תמונת כותרת",  "https://cdn.showup.co.il/header.jpg", True, ()),
    # cover_image - the event's cover/header image; an alias of header_image_url
    # used by save-the-date copy. Resolves to the same media at send time.
    Variable("cover_image",       VarScope.LINK, "תמונת רקע",    "https://cdn.showup.co.il/cover.jpg",  True, ()),
    # subject (event-type specific) - now resolvable at delivery from event.subjects
    Variable("bride_name",     VarScope.SUBJECT, "שם הכלה",     "נועה",     True, ("כלה",)),
    Variable("groom_name",     VarScope.SUBJECT, "שם החתן",     "יונתן",    True, ("חתן",)),
    Variable("couple_names",   VarScope.SUBJECT, "בני הזוג",    "נועה ויונתן", True, ("בני_הזוג",)),
    Variable("baby_name",      VarScope.SUBJECT, "שם הרך הנולד", "אברהם",   True, ("רך_נולד",)),
    Variable("mother_name",    VarScope.SUBJECT, "שם האמא",     "שרה",      True, ("אמא",)),
    Variable("father_name",    VarScope.SUBJECT, "שם האבא",     "יעקב",     True, ("אבא",)),
    Variable("parents_names",  VarScope.SUBJECT, "ההורים",      "שרה ויעקב", True, ("הורים",)),
    Variable("celebrant_name", VarScope.SUBJECT, "שם החוגג/ת",  "מיכל",     True, ("חוגג",)),
    Variable("company_name",   VarScope.SUBJECT, "שם החברה",    "אקמה",     True, ("חברה",)),
]

VARIABLES: Dict[str, Variable] = {v.name: v for v in _VARS}

# Legacy Hebrew token -> canonical variable name (for migrating old copy/preview).
LEGACY_TOKEN_TO_VAR: Dict[str, str] = {
    tok: v.name for v in _VARS for tok in v.legacy_tokens
}


def variable_meta(name: str) -> Optional[Variable]:
    return VARIABLES.get(name)


def canonical_var_name(token: str) -> Optional[str]:
    """Map a legacy Hebrew token OR a canonical name to a canonical variable name."""
    if not token:
        return None
    t = str(token).strip()
    if t in VARIABLES:
        return t
    return LEGACY_TOKEN_TO_VAR.get(t)
