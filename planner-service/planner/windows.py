"""Scheduling flexibility: turn a campaign's *type* + *target day* into the
concrete day range the planner is allowed to move it within.

Two independent levers decide how a campaign may move (per the product spec):
  • Priority            - WHICH campaigns get their day first / are moved last.
  • Scheduling flexibility - HOW FAR each campaign MAY move, by type.

The flexibility table below is the default; any entry can be overridden from
config (PLANNER_FLEXIBILITY_JSON) without code changes. Offsets are in days
relative to the target day (negative = earlier, positive = later).

    Save the Date   ±7 days
    Invitation      -5 .. +2 days
    Reminder        -1 .. 0 days
    Last Reminder    0 only
    Thank You        0 .. +2 days
    (generic)       -MAX_EARLY_SEND_DAYS .. +MAX_LATE_SEND_DAYS
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Dict, Optional, Tuple

from .config import PlannerConfig
from .models import CampaignType, DeliveryWindow


# Default per-type flexibility, as (earliest_offset, latest_offset) in days.
DEFAULT_FLEXIBILITY: Dict[CampaignType, Tuple[int, int]] = {
    CampaignType.SAVE_THE_DATE: (-7, 7),
    CampaignType.INVITATION: (-5, 2),
    CampaignType.REMINDER: (-1, 0),
    CampaignType.LAST_REMINDER: (0, 0),
    CampaignType.THANK_YOU: (0, 2),
}

# Default importance per type (higher = claims target-day capacity first, moved
# last). Time-critical types outrank early-notice ones. Overridable per campaign
# by a stored `priority` column; this is only the fallback.
DEFAULT_PRIORITY: Dict[CampaignType, int] = {
    CampaignType.LAST_REMINDER: 100,
    CampaignType.REMINDER: 80,
    CampaignType.INVITATION: 60,
    CampaignType.GENERIC: 50,
    CampaignType.SAVE_THE_DATE: 40,
    CampaignType.THANK_YOU: 20,
}


# Flow-stage ids (campaigns.stage_id / campaign_type, shared FlowStage values)
# that are not literally a CampaignType value.
_STAGE_TYPES: Dict[str, CampaignType] = {
    "final_reminder": CampaignType.LAST_REMINDER,
    "last_reminder": CampaignType.LAST_REMINDER,
    "rsvp": CampaignType.INVITATION,
    "rsvp_reminder": CampaignType.REMINDER,
    "nudge_reminder": CampaignType.REMINDER,
    "event_remind": CampaignType.REMINDER,
    "table_assignment": CampaignType.GENERIC,
}


def default_priority(campaign_type: CampaignType) -> int:
    return DEFAULT_PRIORITY.get(campaign_type, 50)


def classify(name: str, template: str = "", explicit: Optional[str] = None) -> CampaignType:
    """Best-effort classification of a campaign into a canonical type.

    Prefers an explicit stored type; otherwise infers from the campaign
    name/template label (the labels the wizard/plans use: RSVP, rsvp_reminder,
    nudge_reminder, event_remind, thank_you, save_the_date, …)."""
    if explicit:
        key = explicit.strip().lower()
        if key in _STAGE_TYPES:
            return _STAGE_TYPES[key]
        try:
            return CampaignType(key)
        except ValueError:
            pass
    text = f"{name or ''} {template or ''}".lower()
    # order matters: check the more specific labels first
    if "save" in text or "std" in text:
        return CampaignType.SAVE_THE_DATE
    if "thank" in text:
        return CampaignType.THANK_YOU
    if "last" in text or "final" in text:
        return CampaignType.LAST_REMINDER
    if "remind" in text or "nudge" in text or "event_remind" in text:
        return CampaignType.REMINDER
    if "rsvp" in text or "invit" in text:
        return CampaignType.INVITATION
    return CampaignType.GENERIC


def flexibility_offsets(campaign_type: CampaignType, config: PlannerConfig) -> Tuple[int, int]:
    """The (earliest, latest) day offsets for a type, honoring config overrides.

    GENERIC (and any type without a specific rule) uses the config-level default
    window (-MAX_EARLY_SEND_DAYS .. +MAX_LATE_SEND_DAYS)."""
    override = config.flexibility_overrides.get(campaign_type.value)
    if override and isinstance(override, (list, tuple)) and len(override) == 2:
        try:
            return int(override[0]), int(override[1])
        except (TypeError, ValueError):
            pass
    if campaign_type in DEFAULT_FLEXIBILITY:
        return DEFAULT_FLEXIBILITY[campaign_type]
    return (-abs(config.max_early_send_days), abs(config.max_late_send_days))


def resolve_window(
    target: date,
    campaign_type: CampaignType,
    config: PlannerConfig,
    now: date,
    event_date: Optional[date] = None,
    original_target: Optional[date] = None,
) -> DeliveryWindow:
    """Concrete, past-safe delivery window for a campaign.

    The type flexibility gives the raw (preferred) range around the target; we
    then clamp the earliest bound so the planner never schedules in the past (a
    campaign whose window has already started can still send today, just not
    yesterday).

    Event-date rules (when the event date is known):
      * pre-event stages (save-the-date, invitation, reminder, generic) never go
        out on/after the event day: hard cap = event_date - 1;
      * the last/final reminder may use the event day itself (morning release -
        see runtime.release_instant): hard cap = event_date;
      * an owner who explicitly targeted the event day keeps that day (the cap
        is never below min(original target, event day));
      * nothing but the thank-you is ever planned after the event day.
    Volume that does not fit in the preferred window is CARRIED FORWARD up to
    that cap (`deadline`). Without an event date the carry-forward is
    PLANNER_CARRY_FORWARD_DAYS past the preferred window (default 0).

    `original_target` is the owner's day before an overdue target was
    collapsed to today - it decides the event-day exception, so an invitation
    that missed event_date-1 is not pushed onto the event day.
    """
    early_off, late_off = flexibility_offsets(campaign_type, config)
    earliest = target + timedelta(days=early_off)
    latest = target + timedelta(days=late_off)
    if earliest < now:
        earliest = now

    carry = max(0, int(getattr(config, "carry_forward_days", 0) or 0))
    deadline = latest + timedelta(days=carry)
    if event_date is not None and campaign_type != CampaignType.THANK_YOU:
        cap = event_date if campaign_type == CampaignType.LAST_REMINDER else event_date - timedelta(days=1)
        owner_day = min(original_target or target, event_date)
        cap = max(cap, owner_day)
        latest = min(latest, cap)
        deadline = cap
    return DeliveryWindow(earliest=earliest, target=target, latest=latest, deadline=deadline).clamp()
