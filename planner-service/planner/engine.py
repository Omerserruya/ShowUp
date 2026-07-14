"""The planner engine: the stable entry point the service calls.

It owns the pipeline (pick strategy -> plan -> validate invariants) but NOT the
algorithm (that is the pluggable strategy). Callers hand it `CampaignRequest`s
(already windowed) and get back a validated `PlanResult`.
"""
from __future__ import annotations

from datetime import date
from typing import List, Optional

from .config import PlannerConfig, load_config
from .models import CampaignRequest, PlanResult
from .strategy import get_strategy


class PlanInvariantError(AssertionError):
    """Raised when a strategy returns a plan that violates a hard guarantee
    (over-capacity or out-of-window). Signals a bug in the strategy - the engine
    fails loudly rather than releasing an unsafe plan."""


class Planner:
    def __init__(self, config: Optional[PlannerConfig] = None):
        self.config = config or load_config()

    def plan(self, requests: List[CampaignRequest], now: date, strategy: Optional[str] = None) -> PlanResult:
        strat = get_strategy(strategy or self.config.strategy)
        result = self.plan_with(strat.name, requests, now)
        return result

    def plan_with(self, strategy_name: str, requests: List[CampaignRequest], now: date) -> PlanResult:
        strat = get_strategy(strategy_name)
        result = strat.plan(requests, self.config, now)
        self._validate(result, requests)
        return result

    # ------------------------------------------------------------------ checks
    def _validate(self, result: PlanResult, requests: List[CampaignRequest]) -> None:
        """Enforce the two hard guarantees on any strategy's output. These are the
        promises the whole system depends on, so we verify them every run instead
        of trusting the strategy."""
        # 1. No channel/day exceeds usable capacity.
        for channel, days in result.day_load.items():
            cap = self.config.planner_daily_capacity(channel)
            for day, used in days.items():
                if used > cap:
                    raise PlanInvariantError(
                        f"capacity exceeded on {channel} {day}: {used} > {cap}"
                    )
                if used < 0:
                    raise PlanInvariantError(f"negative load on {channel} {day}: {used}")

        # 2. Every placement is inside the campaign's window, and no campaign is
        #    over-allocated beyond its own volume.
        by_id = {r.campaign_id: r for r in requests}
        for alloc in result.allocations:
            req = by_id.get(alloc.campaign_id)
            if req is None:
                raise PlanInvariantError(f"plan references unknown campaign {alloc.campaign_id}")
            if alloc.placed + alloc.unplaced != req.volume:
                raise PlanInvariantError(
                    f"volume not conserved for {alloc.campaign_id}: "
                    f"placed={alloc.placed} unplaced={alloc.unplaced} volume={req.volume}"
                )
            for day in alloc.by_day:
                if not req.window.contains(day):
                    raise PlanInvariantError(
                        f"{alloc.campaign_id} placed on {day} outside window "
                        f"[{req.window.earliest}..{req.window.latest}]"
                    )
