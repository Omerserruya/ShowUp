"""Semantic RSVP resolution (Phase 7).

The business meaning of a guest's reply MUST come from a stable semantic signal
(quick-reply button payload / id), never from the displayed text. Display labels
('Coming', 'Absolutely', 'See you there') are cosmetic and may change freely.

A transitional text map is kept for templates that still send only a title, so
existing Meta templates keep working - but it is centralized here (one place),
not scattered across state classes, and every confirm/decline/maybe variant maps
to the SAME action (fixing the V1 bug where title variants changed state but not
guest status).
"""
from __future__ import annotations

from typing import Optional

from shared.domain.enums import RsvpAction

# The semantic action tokens the Messaging Catalog puts on quick-reply buttons.
# The button LABEL is presentation; THIS token is the business signal. It becomes
# the Meta button payload, so the engine resolves it regardless of the label,
# language or emoji. One vocabulary, owned here.
CATALOG_BUTTON_ACTIONS = {
    "rsvp_accepted": RsvpAction.CONFIRMED,
    "rsvp_declined": RsvpAction.DECLINED,
    "rsvp_maybe": RsvpAction.MAYBE,
}

# Canonical semantic button payloads/ids. Going forward, Meta quick-reply buttons
# carry one of these as their payload regardless of the visible label.
_BUTTON_ACTIONS = {
    **CATALOG_BUTTON_ACTIONS,
    # legacy/alternate payload tokens (kept working)
    "rsvp_confirm": RsvpAction.CONFIRMED,
    "rsvp_decline": RsvpAction.DECLINED,
    # positional aliases historically emitted by build_interactive
    "rsvp_invite__btn_1": RsvpAction.CONFIRMED,
    "rsvp_invite__btn_2": RsvpAction.DECLINED,
    "rsvp_invite__btn_3": RsvpAction.MAYBE,
}


def normalize_button_action(action) -> Optional[str]:
    """Canonicalize a catalog quick-reply action token (e.g. 'RSVP_ACCEPTED') to
    its lowercase form if it is a recognized semantic action, else None. Used by
    the catalog to validate `buttons[].action`."""
    if not action:
        return None
    key = str(action).strip().lower()
    return key if key in CATALOG_BUTTON_ACTIONS else None

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

# Catalog-derived label map, built lazily on first resolution. Live Meta templates
# that were created WITHOUT semantic payloads echo the button LABEL as the payload,
# so every catalog quick-reply label must resolve to its semantic action too.
# Guarded import: services that vendor shared/ without the catalog's deps (PyYAML)
# simply skip this layer instead of crashing.
_CATALOG_LABEL_ACTIONS: Optional[dict] = None


def _catalog_label_actions() -> dict:
    global _CATALOG_LABEL_ACTIONS
    if _CATALOG_LABEL_ACTIONS is None:
        labels: dict = {}
        try:
            from shared.domain.messaging.catalog import ALL_TEMPLATE_LIST
            for tpl in ALL_TEMPLATE_LIST:
                for btn in getattr(tpl, "quick_replies", ()) or ():
                    action = CATALOG_BUTTON_ACTIONS.get(str(btn.action).strip().lower())
                    if action and btn.label:
                        labels[str(btn.label).strip()] = action
        except Exception:
            labels = {}
        _CATALOG_LABEL_ACTIONS = labels
    return _CATALOG_LABEL_ACTIONS


# Conservative free-text understanding for typed replies ("אגיע בשמחה", "לא נגיע",
# "אולי"). Order matters: maybe -> negation/decline -> confirm, so "אולי אגיע" is
# MAYBE and "לא אגיע" is DECLINED even though both contain a confirm keyword.
_MAYBE_HINTS = ("אולי", "מתלבט", "מתלבטת", "לא בטוח", "לא בטוחה", "עוד לא יודע", "עוד לא יודעת")
_DECLINE_HINTS = ("לא אגיע", "לא נגיע", "לא מגיע", "לא מגיעה", "לא מגיעים", "לא אוכל", "לא נוכל", "לא אהיה", "לא נהיה", "מצטער", "מצטערת")
_CONFIRM_HINTS = ("אגיע", "נגיע", "מגיע", "מגיעה", "מגיעים", "בשמחה", "אהיה שם", "נהיה שם", "אשמח להגיע", "נשמח להגיע", "בא", "באים", "באה")


def _heuristic_text_action(t: str) -> RsvpAction:
    if len(t) > 60:  # long messages are conversation, not an RSVP answer
        return RsvpAction.UNKNOWN
    if any(h in t for h in _MAYBE_HINTS):
        return RsvpAction.MAYBE
    if any(h in t for h in _DECLINE_HINTS) or t == "לא":
        return RsvpAction.DECLINED
    if any(h in t for h in _CONFIRM_HINTS) or t == "כן":
        return RsvpAction.CONFIRMED
    return RsvpAction.UNKNOWN


def resolve_rsvp_action(
    *,
    button_id: Optional[str] = None,
    button_payload: Optional[str] = None,
    text: Optional[str] = None,
) -> RsvpAction:
    """Resolve an incoming reply to a semantic RsvpAction.

    Priority: explicit semantic payload/id, then exact label match (static
    transitional map + catalog quick-reply labels) on the payload/id/text, then
    a conservative free-text heuristic. Returns RsvpAction.UNKNOWN otherwise.
    """
    for candidate in (button_payload, button_id):
        if candidate:
            key = str(candidate).strip().lower()
            if key in _BUTTON_ACTIONS:
                return _BUTTON_ACTIONS[key]
    labels = {**_TEXT_ACTIONS, **_catalog_label_actions()}
    for candidate in (button_payload, button_id, text):
        if candidate:
            t = str(candidate).strip()
            if t in labels:
                return labels[t]
    if text:
        return _heuristic_text_action(str(text).strip())
    return RsvpAction.UNKNOWN
