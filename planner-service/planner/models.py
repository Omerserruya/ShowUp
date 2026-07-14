"""Planner data model - pure value objects passed in and out of the engine.

Dates are plain `datetime.date` (calendar days). Volume is an integer count of
messages (recipients). Everything here is provider/channel-agnostic.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Dict, List, Optional


class CampaignType(str, Enum):
    """Canonical campaign kinds. Each maps to a default scheduling-flexibility
    window (see windows.py). Unknown campaigns fall back to GENERIC."""
    SAVE_THE_DATE = "save_the_date"
    INVITATION = "invitation"
    REMINDER = "reminder"
    LAST_REMINDER = "last_reminder"
    THANK_YOU = "thank_you"
    GENERIC = "generic"


@dataclass(frozen=True)
class DeliveryWindow:
    """The inclusive range of days a campaign may be sent on, plus its ideal day.

    earliest <= target <= latest are all real calendar dates already resolved
    against "now" (never in the past) - the engine treats them as hard bounds.
    """
    earliest: date
    target: date
    latest: date

    def clamp(self) -> "DeliveryWindow":
        e, t, l = self.earliest, self.target, self.latest
        if l < e:
            l = e
        t = min(max(t, e), l)
        return DeliveryWindow(e, t, l)

    def contains(self, day: date) -> bool:
        return self.earliest <= day <= self.latest


@dataclass(frozen=True)
class CampaignRequest:
    """One schedulable unit handed to the planner.

    priority: higher number = more important (claims target-day capacity first,
    and is moved last). volume: number of recipients/messages.
    """
    campaign_id: str
    event_id: str
    channel: str
    campaign_type: CampaignType
    priority: int
    volume: int
    window: DeliveryWindow
    plan: str = ""
    # Free-form label kept for monitoring/debugging (original campaign name).
    label: str = ""


@dataclass
class Allocation:
    """Planner output for a single campaign: how its volume is distributed across
    days. `by_day` maps date -> count; sum(by_day) <= volume. `unplaced` is volume
    that could not fit anywhere in the window without exceeding capacity."""
    campaign_id: str
    event_id: str
    channel: str
    target: date
    by_day: Dict[date, int] = field(default_factory=dict)
    unplaced: int = 0

    @property
    def placed(self) -> int:
        return sum(self.by_day.values())

    @property
    def moved(self) -> int:
        """Volume placed on any day other than the target day."""
        return sum(v for d, v in self.by_day.items() if d != self.target)

    @property
    def is_delayed(self) -> bool:
        """True if any volume was moved off target or could not be placed."""
        return self.moved > 0 or self.unplaced > 0

    @property
    def first_send(self) -> Optional[date]:
        return min(self.by_day) if self.by_day else None

    @property
    def last_send(self) -> Optional[date]:
        return max(self.by_day) if self.by_day else None


@dataclass
class PlanResult:
    """The full platform plan for one run. Everything the monitoring API needs."""
    allocations: List[Allocation] = field(default_factory=list)
    # per (channel, date) -> planned volume
    day_load: Dict[str, Dict[date, int]] = field(default_factory=dict)
    # per channel -> usable capacity/day (post safety margin)
    capacity: Dict[str, int] = field(default_factory=dict)
    reserved: Dict[str, int] = field(default_factory=dict)
    strategy: str = ""

    # ---- derived monitoring metrics ----------------------------------------
    def total_planned(self) -> int:
        return sum(sum(days.values()) for days in self.day_load.values())

    def total_moved(self) -> int:
        return sum(a.moved for a in self.allocations)

    def total_unplaced(self) -> int:
        return sum(a.unplaced for a in self.allocations)

    def delayed_campaigns(self) -> List[Allocation]:
        return [a for a in self.allocations if a.is_delayed]

    def estimated_completion(self) -> Optional[date]:
        """Latest day any message is planned to go out - the platform-wide ETA."""
        last_days = [a.last_send for a in self.allocations if a.last_send]
        return max(last_days) if last_days else None

    def heatmap(self, channel: str) -> Dict[date, Dict[str, int]]:
        """Per-day capacity utilisation for a channel, for the monitoring UI."""
        cap = self.capacity.get(channel, 0)
        out: Dict[date, Dict[str, int]] = {}
        for day, used in sorted(self.day_load.get(channel, {}).items()):
            out[day] = {
                "planned": used,
                "capacity": cap,
                "utilization_percent": round((used / cap) * 100, 1) if cap else 0.0,
            }
        return out
