"""Pluggable planning strategy.

A strategy is the ONLY place the actual scheduling algorithm lives. Everything
else (config, models, windows, engine, service loop, monitoring API) is stable
infrastructure. To introduce a smarter planner (load balancing across days,
predictive scheduling, adaptive campaign shifting) you add a new PlannerStrategy
subclass and register it - no other file changes, and it is selected at runtime
via PLANNER_STRATEGY.

Contract: given the campaign requests + config + the reference day, return a
PlanResult whose per-day load never exceeds `config.planner_daily_capacity` for
any channel/day, and where every campaign's placed volume stays inside its
delivery window. The engine validates these invariants after every run.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import date
from typing import Callable, Dict, List, Type

from .config import PlannerConfig
from .models import CampaignRequest, PlanResult


class PlannerStrategy(ABC):
    name: str = "base"

    @abstractmethod
    def plan(self, requests: List[CampaignRequest], config: PlannerConfig, now: date) -> PlanResult:
        """Produce a full platform delivery plan. Must respect capacity + windows."""
        raise NotImplementedError


_REGISTRY: Dict[str, Type[PlannerStrategy]] = {}


def register_strategy(cls: Type[PlannerStrategy]) -> Type[PlannerStrategy]:
    """Class decorator / function to register a strategy under its `name`."""
    if not getattr(cls, "name", None):
        raise ValueError("strategy must define a non-empty `name`")
    _REGISTRY[cls.name] = cls
    return cls


def get_strategy(name: str) -> PlannerStrategy:
    """Instantiate a registered strategy by name, falling back to 'deterministic'."""
    key = (name or "").strip().lower()
    cls = _REGISTRY.get(key) or _REGISTRY.get("deterministic")
    if cls is None:
        raise KeyError(f"no strategy registered for '{name}' and no deterministic default")
    return cls()


def available_strategies() -> List[str]:
    return sorted(_REGISTRY.keys())


# Import built-in strategies so they self-register on package import.
# (kept at the bottom to avoid a circular import at module load)
from .strategies import deterministic as _deterministic  # noqa: E402,F401
