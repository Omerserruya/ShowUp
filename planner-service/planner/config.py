"""Planner configuration - everything is read from the environment. No limit is
ever hardcoded in the algorithm; the engine only ever reads numbers from here.

Channel-agnostic by construction: provider limits are held per channel in
`ChannelLimits`, keyed by channel name ("whatsapp" today; "sms"/"email"/… later).
Adding a channel = adding a `ChannelLimits` entry (and its env keys), nothing in
the planning algorithm changes.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Dict, Optional


def _int(env: str, default: int) -> int:
    raw = os.getenv(env)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return default


def _float(env: str, default: float) -> float:
    raw = os.getenv(env)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


def _str(env: str, default: str) -> str:
    raw = os.getenv(env)
    return raw if raw not in (None, "") else default


@dataclass(frozen=True)
class ChannelLimits:
    """Provider capacity for one delivery channel.

    `raw_daily_capacity` is the number of messages the provider will accept in a
    24h window BEFORE the planner's safety margin is applied. For WhatsApp the
    binding constraint is new business-initiated conversations per 24h; the
    per-second rate is a throughput ceiling used as an upper bound.
    """
    channel: str
    messages_per_second: float
    new_conversations_per_24h: int
    tier: str = ""
    quality_rating: str = ""

    @property
    def raw_daily_capacity(self) -> int:
        """Binding per-day message ceiling from the provider limits (pre-margin).

        min(new-conversations/24h, messages/sec * seconds/day). For WhatsApp the
        conversation cap is almost always the binding one; the throughput bound
        guards against a mis-set conversation cap.
        """
        per_second_daily = int(self.messages_per_second * 86400)
        candidates = [c for c in (self.new_conversations_per_24h, per_second_daily) if c and c > 0]
        return min(candidates) if candidates else 0


@dataclass(frozen=True)
class PlannerConfig:
    """All planner knobs, resolved from env once per run."""
    safety_margin_percent: float          # PLANNER_SAFETY_MARGIN_PERCENT
    max_early_send_days: int              # MAX_EARLY_SEND_DAYS (generic/default window floor)
    max_late_send_days: int               # MAX_LATE_SEND_DAYS (generic/default window ceiling)
    interval_seconds: int                 # PLANNER_INTERVAL_SECONDS (service loop cadence)
    strategy: str                         # PLANNER_STRATEGY (which algorithm to use)
    horizon_days: int                     # PLANNER_HORIZON_DAYS (how far ahead to plan)
    channels: Dict[str, ChannelLimits] = field(default_factory=dict)
    # Optional per-campaign-type window override, as {type: [earliest_offset, latest_offset]}.
    flexibility_overrides: Dict[str, list] = field(default_factory=dict)

    # ---- capacity helpers --------------------------------------------------
    def channel_limits(self, channel: str) -> Optional[ChannelLimits]:
        return self.channels.get((channel or "").strip().lower())

    def planner_daily_capacity(self, channel: str) -> int:
        """Usable per-day capacity for a channel = raw provider ceiling minus the
        reserved safety margin. This is the number the planner packs against; it
        NEVER plans above it, leaving the margin free for retries / manual sends /
        last-minute load."""
        limits = self.channel_limits(channel)
        if not limits:
            return 0
        raw = limits.raw_daily_capacity
        margin = max(0.0, min(100.0, self.safety_margin_percent)) / 100.0
        return int(raw * (1.0 - margin))

    def reserved_daily_capacity(self, channel: str) -> int:
        limits = self.channel_limits(channel)
        if not limits:
            return 0
        return limits.raw_daily_capacity - self.planner_daily_capacity(channel)


def _load_channels() -> Dict[str, ChannelLimits]:
    """WhatsApp is configured today from the META_* env keys. Additional channels
    can be added here (SMS_*, EMAIL_* …) without touching the algorithm."""
    channels: Dict[str, ChannelLimits] = {}
    channels["whatsapp"] = ChannelLimits(
        channel="whatsapp",
        messages_per_second=_float("META_MESSAGES_PER_SECOND", 80.0),
        new_conversations_per_24h=_int("META_NEW_CONVERSATIONS_PER_24H", 1000),
        tier=_str("META_TIER", ""),
        quality_rating=_str("META_QUALITY_RATING", ""),
    )
    return channels


def _load_flexibility_overrides() -> Dict[str, list]:
    raw = os.getenv("PLANNER_FLEXIBILITY_JSON")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def load_config() -> PlannerConfig:
    return PlannerConfig(
        safety_margin_percent=_float("PLANNER_SAFETY_MARGIN_PERCENT", 15.0),
        max_early_send_days=_int("MAX_EARLY_SEND_DAYS", 5),
        max_late_send_days=_int("MAX_LATE_SEND_DAYS", 2),
        interval_seconds=_int("PLANNER_INTERVAL_SECONDS", 60),
        strategy=_str("PLANNER_STRATEGY", "deterministic"),
        horizon_days=_int("PLANNER_HORIZON_DAYS", 60),
        channels=_load_channels(),
        flexibility_overrides=_load_flexibility_overrides(),
    )
