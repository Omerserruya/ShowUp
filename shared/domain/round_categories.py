"""Round categories: every message round belongs to one, and the category alone
decides WHO receives it.

    round -> category -> audience key -> (campaign audience, filter) -> SQL

A category is admin-managed data (core-service table `round_categories`): a name,
a description, the base STAGE it behaves as (which templates fit it, whether it
collects RSVPs) and one AUDIENCE from the fixed dictionary below. Owners only
pick a category for a round; they never set the audience.

The audience dictionary is the single translation from a human choice ("not
answered + maybe") to the (audience, audience_filter) pair that all three guest
resolvers already execute as SQL - core-service/app/audience.py (counts),
campaign-worker/audience.py (the send) and planner-service/audience_sql.py
(release sizing). A filter key used here must be understood by all three.

Each round stores the pair it got from its category; core re-applies it to every
not-yet-sent round whenever an admin changes the category, so what the category
says is what goes out.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from shared.domain.enums import CampaignAudience, GuestStatus

_CONFIRMED = sorted(GuestStatus.confirmed_values())
_PENDING = sorted(GuestStatus.pending_values())
_MAYBE = sorted(GuestStatus.maybe_values())


@dataclass(frozen=True)
class Audience:
    key: str
    label_he: str
    hint_he: str
    audience: str                       # CampaignAudience value
    filter: Optional[dict] = None
    param: Optional[str] = None         # 'tag' | 'group': the category supplies a name

    def pair(self, param: Optional[str] = None) -> Tuple[str, Optional[dict]]:
        f = dict(self.filter) if self.filter else None
        if self.param == "tag":
            f = {**(f or {}), "tag_name": (param or "").strip()}
        elif self.param == "group":
            f = {**(f or {}), "group": (param or "").strip()}
        return self.audience, f


_E, _C, _D, _N, _X = (CampaignAudience.EVERYONE.value, CampaignAudience.CONFIRMED.value,
                      CampaignAudience.DECLINED.value, CampaignAudience.NO_RESPONSE.value,
                      CampaignAudience.CUSTOM.value)

AUDIENCES: Dict[str, Audience] = {a.key: a for a in (
    Audience("everyone", "כולם", "כל המוזמנים, כולל מי שסירב", _E),
    Audience("no_response", "לא ענו", "מי שעוד לא ענה בכלל", _N),
    Audience("undecided", "לא ענו + ענו ״אולי״", "מי שעוד לא סגר סופית", _X,
             {"status": _PENDING + _MAYBE, "skip_no_reminders": True}),
    Audience("maybe", "ענו ״אולי״", "רק מי שענה שהוא לא בטוח", _X, {"status": _MAYBE}),
    Audience("confirmed", "אישרו הגעה", "רק מי שאישר", _C),
    Audience("confirmed_or_maybe", "אישרו + ״אולי״", "מי שאישר או שעוד מתלבט", _X,
             {"status": _CONFIRMED + _MAYBE}),
    Audience("not_declined", "כל מי שלא סירב", "אישרו, ״אולי״ ומי שלא ענה", _X,
             {"status": _CONFIRMED + _PENDING + _MAYBE}),
    Audience("declined", "סירבו", "רק מי שאמר שלא יגיע", _D),
    Audience("confirmed_with_table", "אישרו ויש להם שולחן", "להודעת שולחן", _X,
             {"status": _CONFIRMED, "table": "any"}),
    Audience("confirmed_without_table", "אישרו ואין להם שולחן", "מי שעוד לא שובץ", _X,
             {"status": _CONFIRMED, "table": "none"}),
    Audience("tag", "לפי תגית", "אורחים עם תגית מסוימת (לפי שם התגית)", _X, None, "tag"),
    Audience("group", "לפי קבוצה", "אורחים מקבוצה מסוימת (לפי שם הקבוצה)", _X, None, "group"),
)}

# Filter keys the audience dictionary may produce - every resolver must support them.
FILTER_KEYS = frozenset({"status", "group", "tag_id", "tag_name", "table", "skip_no_reminders"})

STAGES = ("save_the_date", "invitation", "reminder", "final_reminder", "table_assignment", "thank_you")
STAGE_KIND_HE = {
    "save_the_date": "שמירת תאריך",
    "invitation": "אישור הגעה",
    "reminder": "אישור הגעה",
    "final_reminder": "תזכורת לאירוע",
    "table_assignment": "שולחן",
    "thank_you": "תודה",
}

# The built-in categories: one per stage, id == stage. Seeded once; after that
# the admin owns their name / description / audience (they cannot be deleted).
BUILTIN: Tuple[Tuple[str, str], ...] = (
    ("save_the_date", "everyone"),
    ("invitation", "everyone"),
    ("reminder", "no_response"),
    ("final_reminder", "confirmed"),
    ("table_assignment", "confirmed_with_table"),
    ("thank_you", "confirmed"),
)


def builtin_rows() -> List[dict]:
    from shared.domain.messaging.catalog import STAGE_COPY
    rows = []
    for i, (stage, aud) in enumerate(BUILTIN):
        copy = STAGE_COPY.get(stage, {})
        rows.append({"id": stage, "base_stage": stage, "title": copy.get("title") or stage,
                     "description": copy.get("description") or "", "audience": aud,
                     "audience_param": None, "sort_order": (i + 1) * 10, "builtin": True})
    return rows


def audience_pair(audience_key: Optional[str], param: Optional[str] = None) -> Tuple[str, Optional[dict]]:
    """(campaign audience, filter) for a category's audience. Unknown -> everyone
    is never returned: an unknown key raises, so a typo cannot widen a send."""
    a = AUDIENCES.get(audience_key or "")
    if a is None:
        raise ValueError(f"unknown audience '{audience_key}'")
    return a.pair(param)


def validate(audience_key: str, param: Optional[str], base_stage: str) -> Optional[str]:
    """Hebrew error, or None when the category definition is valid."""
    a = AUDIENCES.get(audience_key or "")
    if a is None:
        return "קהל לא מוכר"
    if a.param and not (param or "").strip():
        return "צריך לכתוב את שם התגית או הקבוצה"
    if base_stage not in STAGES:
        return "סוג לא מוכר"
    return None


def describe(audience_key: Optional[str], param: Optional[str] = None) -> str:
    a = AUDIENCES.get(audience_key or "")
    if a is None:
        return ""
    if a.param:
        return f"{a.label_he}: {param}" if param else a.label_he
    return a.label_he
