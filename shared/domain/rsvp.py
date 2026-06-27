"""Semantic RSVP resolution (Phase 7).

The business meaning of a guest's reply MUST come from a stable semantic signal
(quick-reply button payload / id), never from the displayed text. Display labels
('Coming', 'Absolutely', 'See you there') are cosmetic and may change freely.

A transitional text map is kept for templates that still send only a title, so
existing Meta templates keep working — but it is centralized here (one place),
not scattered across state classes, and every confirm/decline/maybe variant maps
to the SAME action (fixing the V1 bug where title variants changed state but not
guest status).
"""
from __future__ import annotations

from typing import Optional

from shared.domain.enums import RsvpAction

# Canonical semantic button payloads/ids. Going forward, Meta quick-reply buttons
# carry one of these as their payload regardless of the visible label.
_BUTTON_ACTIONS = {
    "rsvp_confirm": RsvpAction.CONFIRMED,
    "rsvp_decline": RsvpAction.DECLINED,
    "rsvp_maybe": RsvpAction.MAYBE,
    # positional aliases historically emitted by build_interactive
    "rsvp_invite__btn_1": RsvpAction.CONFIRMED,
    "rsvp_invite__btn_2": RsvpAction.DECLINED,
    "rsvp_invite__btn_3": RsvpAction.MAYBE,
}

# Transitional: legacy Hebrew display titles -> action. Remove once all live
# templates carry semantic payloads.
_TEXT_ACTIONS = {
    "ברור שאני בא!": RsvpAction.CONFIRMED,
    "ברור שנגיע !": RsvpAction.CONFIRMED,
    "ברור שאגיע!": RsvpAction.CONFIRMED,
    "לצערי לא אוכל להגיע ):": RsvpAction.DECLINED,
    "לצערי לא אוכל": RsvpAction.DECLINED,
    "לצערי לא אוכל להגיע": RsvpAction.DECLINED,
    "עוד מתלבט, תחזרו אלי?": RsvpAction.MAYBE,
    "עוד מתלבט/ת, תחזרו אלי?": RsvpAction.MAYBE,
}


def resolve_rsvp_action(
    *,
    button_id: Optional[str] = None,
    button_payload: Optional[str] = None,
    text: Optional[str] = None,
) -> RsvpAction:
    """Resolve an incoming reply to a semantic RsvpAction.

    Priority: explicit semantic payload/id first, then the transitional text map.
    Returns RsvpAction.UNKNOWN when nothing matches.
    """
    for candidate in (button_payload, button_id):
        if candidate:
            key = str(candidate).strip().lower()
            if key in _BUTTON_ACTIONS:
                return _BUTTON_ACTIONS[key]
    if text:
        t = str(text).strip()
        if t in _TEXT_ACTIONS:
            return _TEXT_ACTIONS[t]
    return RsvpAction.UNKNOWN
