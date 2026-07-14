"""Canonical flow-stage vocabulary - the ONE stage naming used everywhere.

Before this, three subsystems named stages differently (design layer:
invitation/reminder/final_reminder/thank_you; plans.json: RSVP/rsvp_reminder/
nudge_reminder/event_remind/thank_you; worker: event_no_pic/general_rsvp/...).
This module is the single vocabulary; `canonical_stage()` maps every legacy
alias onto it so old data keeps resolving. No subsystem should define its own
stage names again.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional


class FlowStage(str, Enum):
    # Official V1 stages.
    SAVE_THE_DATE = "save_the_date"
    INVITATION = "invitation"
    REMINDER = "reminder"                # repeatable - any number of instances
    FINAL_REMINDER = "final_reminder"
    TABLE_ASSIGNMENT = "table_assignment"  # independent stage (own schedule/audience)
    THANK_YOU = "thank_you"


# Ordered for scheduling/priority use (earlier in the lifecycle first).
STAGE_ORDER = [
    FlowStage.SAVE_THE_DATE,
    FlowStage.INVITATION,
    FlowStage.REMINDER,
    FlowStage.FINAL_REMINDER,
    FlowStage.TABLE_ASSIGNMENT,
    FlowStage.THANK_YOU,
]


# Every legacy identifier that ever meant a stage → its canonical FlowStage.
# Keys are lower-cased. This is what preserves backward compatibility for
# campaigns/plans/labels created before the refactor.
STAGE_ALIASES = {
    # canonical (identity)
    "save_the_date": FlowStage.SAVE_THE_DATE,
    "invitation": FlowStage.INVITATION,
    "reminder": FlowStage.REMINDER,
    "final_reminder": FlowStage.FINAL_REMINDER,
    "table_assignment": FlowStage.TABLE_ASSIGNMENT,
    "thank_you": FlowStage.THANK_YOU,
    # legacy design-layer labels (Hebrew) + campaignLabel values
    "save the date": FlowStage.SAVE_THE_DATE,
    "תזכורת שבוע לפני": FlowStage.REMINDER,
    "תזכורת יום לפני": FlowStage.FINAL_REMINDER,
    "תודה אחרי האירוע": FlowStage.THANK_YOU,
    # legacy plans.json labels
    "rsvp": FlowStage.INVITATION,
    "rsvp_reminder": FlowStage.REMINDER,
    "nudge_reminder": FlowStage.REMINDER,
    "event_remind": FlowStage.FINAL_REMINDER,
    # legacy worker meta-template names
    "event_no_pic": FlowStage.INVITATION,
    "general_rsvp": FlowStage.INVITATION,
    "table_info": FlowStage.TABLE_ASSIGNMENT,
}


def canonical_stage(value) -> Optional[FlowStage]:
    """Map any legacy/alias/canonical stage identifier to a FlowStage, or None."""
    if value is None:
        return None
    if isinstance(value, FlowStage):
        return value
    key = str(value).strip().lower()
    if key in STAGE_ALIASES:
        return STAGE_ALIASES[key]
    try:
        return FlowStage(key)
    except ValueError:
        return None
