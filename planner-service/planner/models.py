"""Planner data model - pure value objects passed in and out of the engine.

Dates are plain `datetime.date` (calendar days). Volume is an integer count of
messages (recipients). Everything here is provider/channel-agnostic.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from enum import Enum
from typing import Dict, List, Optional, Set


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

    `deadline` (>= latest) is the last day volume that did not fit inside the
    preferred window may be CARRIED FORWARD to (e.g. event_date - 1 for an
    invitation). None = no carry-forward (deadline == latest). A window whose
    earliest is after its deadline is empty: nothing can be placed.
    """
    earliest: date
    target: date
    latest: date
    deadline: Optional[date] = None

    @property
    def hard_latest(self) -> date:
        return self.deadline if self.deadline is not None else self.latest

    @property
    def is_empty(self) -> bool:
        return self.earliest > self.hard_latest

    def clamp(self) -> "DeliveryWindow":
        e, t, l, d = self.earliest, self.target, self.latest, self.deadline
        hard = d if d is not None else l
        if l < e:
            # Preferred window already over: fall back to the carry-forward
            # range when one exists, never past the deadline.
            l = e if (d is None or e <= hard) else hard
        if d is not None and l > d:
            l = d
        t = min(max(t, e), l) if e <= l else t
        if d is not None and d < l:
            d = l
        return DeliveryWindow(e, t, l, d)

    def contains(self, day: date) -> bool:
        """Inside the preferred (type-flexibility) window."""
        return self.earliest <= day <= self.latest

    def allows(self, day: date) -> bool:
        """Inside the hard bounds (preferred window + carry-forward)."""
        return self.earliest <= day <= self.hard_latest


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
    # Tie-breaks inside one priority: sooner event first, then the campaign
    # created first (previously the random UUID decided).
    event_date: Optional[date] = None
    created_at: Optional[datetime] = None


@dataclass
class PlanContext:
    """Facts about the world the strategy must respect besides the requests.

    prefill:     per (channel, day) volume ALREADY used/committed (released
                 today, sent in the rolling 24h, in-flight). The planner packs on
                 top of it - without this every replan started each day at 0 and
                 re-filled capacity that had already been spent.
    closed_days: days nothing can be released on (send window closed for the
                 whole day, or today after the window's last close).
    """
    prefill: Dict[str, Dict[date, int]] = field(default_factory=dict)
    closed_days: Set[date] = field(default_factory=set)


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
    # per (channel, date) -> volume that was already used before this plan
    # (included in day_load; NOT part of any allocation).
    prefill: Dict[str, Dict[date, int]] = field(default_factory=dict)

    # ---- derived monitoring metrics ----------------------------------------
    def total_planned(self) -> int:
        """Volume placed by THIS plan (excludes prefill)."""
        return sum(a.placed for a in self.allocations)

    def planned_load(self, channel: str) -> Dict[date, int]:
        """Per-day volume placed by this plan only (day_load minus prefill)."""
        out: Dict[date, int] = {}
        for a in self.allocations:
            if a.channel != channel:
                continue
            for d, v in a.by_day.items():
                out[d] = out.get(d, 0) + v
        return out

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
