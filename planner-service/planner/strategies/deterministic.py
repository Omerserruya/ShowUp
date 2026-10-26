"""Strategy #1 - a simple, deterministic, capacity-respecting greedy planner.

This is intentionally the *simplest thing that is correct*. It does not try to
smooth load or look ahead; smarter strategies (load balancing, predictive,
adaptive shifting) plug in later behind the same `PlannerStrategy` contract.

Algorithm (per channel):
  1. Sort campaigns by the priority rules, highest priority first. Higher-priority
     campaigns claim their target-day capacity before lower-priority ones, which
     is exactly rule #3 ("prefer moving lower-priority campaigns").
  2. For each campaign, distribute its volume across the days of its delivery
     window, filling each day only up to the usable (post-margin) capacity:
       a. target day first                       (rule #1: keep on requested day)
       b. then a BIDIRECTIONAL expanding ring - nearest earlier day, nearest later
          day, then the next ring outward, until the window is exhausted. The
          planner always takes the CLOSEST available capacity regardless of
          direction (earlier preferred only to break a same-distance tie).
                                                  (rule #2 minimize movement,
                                                   rule #4 earlier before later)
     Never place on a day outside the window     (rule #5: never violate windows).
  3. Any volume that still does not fit stays `unplaced` (reported as delayed /
     at-risk). The planner never exceeds capacity to force a fit - the reserved
     safety margin is deliberately left untouched.

  4. Carry-forward: volume that still does not fit inside the preferred window
     moves to the next feasible day after it, ascending, up to the window's
     `deadline` (event-date based, see windows.resolve_window). Only what fits
     nowhere before the deadline is `unplaced`.

Capacity is packed ON TOP of `PlanContext.prefill` (volume already released
today / in the rolling 24h) - every replan used to start each day at 0 and
re-spend capacity that had already been used. Days in `PlanContext.closed_days`
(send window closed) are never used.

Because the whole plan is recomputed from the full campaign set every run, adding
or changing a campaign naturally rebalances all affected days (continuous
rebalancing) with no special-casing.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional

from ..config import PlannerConfig
from ..models import Allocation, CampaignRequest, PlanContext, PlanResult
from ..strategy import PlannerStrategy, register_strategy

_FAR_DATE = date.max
_FAR_TS = float("inf")


def _created_ts(value: Optional[datetime]) -> float:
    if value is None:
        return _FAR_TS
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.timestamp()


def _priority_sort_key(req: CampaignRequest):
    # Highest priority first (-priority for ascending sort); within a priority
    # the SOONER EVENT first, then the campaign CREATED first (first come, first
    # served), then the one that wants to send earliest, then smaller volume;
    # the id only as a last resort for full determinism (it used to be the
    # deciding tie-break - effectively random).
    return (-req.priority, req.event_date or _FAR_DATE, _created_ts(req.created_at),
            req.window.target, req.volume, req.campaign_id)


def _candidate_days(req: CampaignRequest) -> List[date]:
    """Placement order for a campaign: a BIDIRECTIONAL expanding ring around the
    target, so the planner always fills the CLOSEST available capacity regardless
    of direction - not an earlier-only overflow.

        target, T-1, T+1, T-2, T+2, … outward until the window is exhausted.

    At equal distance the earlier day is offered first (prefer sending before the
    target when there is a tie). Because days are consumed in this order, capacity
    before the target is used first; once the earlier days saturate, placement
    continues onto the nearest later days - minimizing distance from the target
    date while maximizing utilization. Days outside [earliest, latest] are never
    emitted (windows are hard bounds)."""
    w = req.window
    days = [w.target]
    max_span = max((w.target - w.earliest).days, (w.latest - w.target).days)
    for dist in range(1, max_span + 1):
        earlier = w.target - timedelta(days=dist)
        later = w.target + timedelta(days=dist)
        if earlier >= w.earliest:          # nearest earlier day first (tie-break)
            days.append(earlier)
        if later <= w.latest:              # then nearest later day at this distance
            days.append(later)
    return days


def _carry_forward_days(req: CampaignRequest) -> List[date]:
    """Days after the preferred window up to the deadline, ascending."""
    w = req.window
    out = []
    d = w.latest + timedelta(days=1)
    while d <= w.hard_latest:
        out.append(d)
        d += timedelta(days=1)
    return out


@register_strategy
class GreedyDeterministicStrategy(PlannerStrategy):
    name = "deterministic"

    def plan(self, requests: List[CampaignRequest], config: PlannerConfig, now: date,
             context: Optional[PlanContext] = None) -> PlanResult:
        ctx = context or PlanContext()
        result = PlanResult(strategy=self.name)
        closed = ctx.closed_days or set()

        # Group by channel - each channel has independent capacity.
        by_channel: Dict[str, List[CampaignRequest]] = {}
        for req in requests:
            by_channel.setdefault(req.channel, []).append(req)

        for channel in set(by_channel) | set(ctx.prefill or {}):
            reqs = by_channel.get(channel, [])
            capacity = config.planner_daily_capacity(channel)
            result.capacity[channel] = capacity
            result.reserved[channel] = config.reserved_daily_capacity(channel)
            pre = {d: int(v) for d, v in (ctx.prefill or {}).get(channel, {}).items() if v}
            result.prefill[channel] = dict(pre)
            # day_load starts from what was ALREADY used, not 0.
            day_load: Dict[date, int] = result.day_load.setdefault(channel, dict(pre))

            # Unknown channel (no configured limits) => capacity 0 => everything
            # is reported as unplaced rather than silently sent.
            for req in sorted(reqs, key=_priority_sort_key):
                alloc = Allocation(
                    campaign_id=req.campaign_id,
                    event_id=req.event_id,
                    channel=channel,
                    target=req.window.target,
                )
                remaining = req.volume
                if capacity > 0 and not req.window.is_empty:
                    for day in _candidate_days(req) + _carry_forward_days(req):
                        if remaining <= 0:
                            break
                        if day in closed or not req.window.allows(day):
                            continue
                        used = day_load.get(day, 0)
                        free = capacity - used
                        if free <= 0:
                            continue
                        take = min(free, remaining)
                        if take > 0:
                            alloc.by_day[day] = alloc.by_day.get(day, 0) + take
                            day_load[day] = used + take
                            remaining -= take
                alloc.unplaced = remaining
                result.allocations.append(alloc)

        return result
