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

import re as _re
import unicodedata as _ud
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
# "אולי"). Matching is on WHOLE TOKENS (and token sequences), never substrings:
# substring matching made "בא" fire inside "הבא"/"הבאה", so "נעדכן בשבוע הבא"
# was recorded as a confirmation, and "לא באים" (missing from the decline list)
# matched the confirm word "באים". Order matters: maybe -> decline -> confirm, so
# "אולי אגיע" is MAYBE and "לא אגיע" is DECLINED although both contain a confirm
# word.

# Hebrew points/cantillation (niqqud, U+0591-U+05C7) carry no meaning here.
_NIQQUD_RE = _re.compile(r"[\u0591-\u05C7]")
# Anything that is not a letter/digit (emoji, punctuation, maqaf) separates tokens.
_SPLIT_RE = _re.compile(r"[^\w]+", _re.UNICODE)

# Verbs that, preceded by a negation, mean "not coming".
_COMING_VERBS = (
    "אגיע", "נגיע", "מגיע", "מגיעה", "מגיעים", "מגיעות", "להגיע",
    "בא", "באה", "באים", "באות", "נבוא", "אבוא", "לבוא",
    "אוכל", "נוכל", "יכול", "יכולה", "יכולים",
    "אהיה", "נהיה", "אצליח", "נצליח", "מצליח", "מצליחה", "מצליחים",
)
_NEGATIONS = ("לא", "לצערי לא", "כנראה שלא", "כנראה לא")

_MAYBE_PHRASES = (
    ("אולי",), ("מתלבט",), ("מתלבטת",), ("מתלבטים",),
    ("לא", "בטוח"), ("לא", "בטוחה"), ("לא", "בטוחים"),
    ("לא", "יודע"), ("לא", "יודעת"), ("לא", "יודעים"),
    ("עדיין", "לא", "יודע"), ("נשתדל",), ("אשתדל",),
    ("maybe",), ("not", "sure"), ("perhaps",),
)
_DECLINE_PHRASES = tuple(
    tuple(neg.split()) + (verb,) for neg in _NEGATIONS for verb in _COMING_VERBS
) + (
    ("לצערי",), ("מצטער",), ("מצטערת",), ("מצטערים",),
    # In an RSVP conversation "cancel" means "we're not coming" - it is NOT an
    # opt-out request (see shared/domain/optout.py).
    ("ביטול",), ("מבטל",), ("מבטלת",), ("מבטלים",), ("נבצר",),
    ("לא", "רלוונטי"), ("לא", "נראה", "לי"),
    ("no",), ("nope",), ("not", "coming"), ("cant", "make", "it"), ("cancel",),
)
_CONFIRM_PHRASES = tuple((v,) for v in (
    "אגיע", "נגיע", "מגיע", "מגיעה", "מגיעים", "מגיעות",
    "בא", "באה", "באים", "באות", "נבוא", "אבוא",
    "בשמחה", "כן", "בטח", "ברור", "מאשר", "מאשרת", "מאשרים",
    "yes", "yep", "yeah", "coming", "attending",
)) + (
    ("אהיה", "שם"), ("נהיה", "שם"), ("אשמח", "להגיע"), ("נשמח", "להגיע"),
)

# A reply this long is conversation, not an RSVP answer.
_MAX_HEURISTIC_CHARS = 60
_MAX_HEURISTIC_TOKENS = 8


def tokenize_reply(text: Optional[str]) -> list:
    """Lowercased word tokens of a reply, without niqqud, emoji or punctuation."""
    if not text:
        return []
    t = _ud.normalize("NFC", str(text))
    t = _NIQQUD_RE.sub("", t)
    # Geresh/apostrophes/quotes join a word ("can't" -> "cant") rather than split it.
    t = _re.sub(r"[\'\u2019\u05F3\u05F4\"]", "", t)
    return [tok for tok in _SPLIT_RE.split(t.lower()) if tok and tok != "_"]


def _has_phrase(tokens: list, phrases) -> bool:
    n = len(tokens)
    for ph in phrases:
        k = len(ph)
        if k > n:
            continue
        for i in range(n - k + 1):
            if tuple(tokens[i:i + k]) == ph:
                return True
    return False


def _heuristic_text_action(t: str) -> RsvpAction:
    if len(t) > _MAX_HEURISTIC_CHARS:
        return RsvpAction.UNKNOWN
    tokens = tokenize_reply(t)
    if not tokens or len(tokens) > _MAX_HEURISTIC_TOKENS:
        return RsvpAction.UNKNOWN
    if _has_phrase(tokens, _MAYBE_PHRASES):
        return RsvpAction.MAYBE
    if _has_phrase(tokens, _DECLINE_PHRASES):
        return RsvpAction.DECLINED
    # A bare "לא" ("לא", "לא תודה", "לא לא") is a decline.
    if tokens[0] == "לא" and len(tokens) <= 2:
        return RsvpAction.DECLINED
    if _has_phrase(tokens, _CONFIRM_PHRASES):
        return RsvpAction.CONFIRMED
    return RsvpAction.UNKNOWN


# --- party size ("כמה תהיו?") -----------------------------------------------

GUEST_COUNT_MIN = 1
GUEST_COUNT_MAX = 50

_COUNT_WORDS = {
    "אחד": 1, "אחת": 1, "לבד": 1, "רק אני": 1, "אני": 1,
    "שניים": 2, "שתיים": 2, "שנים": 2, "שתים": 2, "שנינו": 2, "זוג": 2, "שתינו": 2,
    "שלושה": 3, "שלוש": 3, "שלושתנו": 3,
    "ארבעה": 4, "ארבע": 4, "ארבעתנו": 4,
    "חמישה": 5, "חמש": 5, "שישה": 6, "שש": 6, "שבעה": 7, "שבע": 7,
    "שמונה": 8, "תשעה": 9, "תשע": 9, "עשרה": 10, "עשר": 10,
}


def parse_guest_count(text: Optional[str]) -> Optional[int]:
    """Read a party size out of a short reply: "3", "3 אנשים", "אנחנו 4", "שניים".

    Returns the number (which may be out of range - the caller validates against
    GUEST_COUNT_MIN..GUEST_COUNT_MAX so it can re-ask kindly), or None when the
    reply carries no single clear number.
    """
    if not text:
        return None
    raw = str(text).strip()
    if _re.fullmatch(r"\d{1,12}", raw):
        return int(raw)
    if _re.fullmatch(r"[-\u2212\u2013]\s*\d+", raw):
        return None   # "-1": tokenizing drops the minus and would read it as 1
    tokens = tokenize_reply(raw)
    if not tokens or len(tokens) > 4:
        return None
    numbers = [tok for tok in tokens if tok.isdigit()]
    if len(numbers) == 1:
        return int(numbers[0])
    if numbers:
        return None
    joined = " ".join(tokens)
    if joined in _COUNT_WORDS:
        return _COUNT_WORDS[joined]
    found = {_COUNT_WORDS[tok] for tok in tokens if tok in _COUNT_WORDS and tok != "אני"}
    if len(found) == 1:
        return found.pop()
    return None


def is_valid_guest_count(n: Optional[int], max_count: int = GUEST_COUNT_MAX,
                         min_count: int = GUEST_COUNT_MIN) -> bool:
    return n is not None and min_count <= n <= max_count


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
