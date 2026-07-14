"""Global Delivery Planning Engine (pure core).

The planner is the single source of truth for *when* platform messages are sent.
It plans delivery across ALL events at once so that channel provider limits
(e.g. Meta/WhatsApp) are never exceeded, while keeping each campaign as close to
its requested day as possible.

Separation of concerns (see the service layer, not this package):
    planner  -> owns scheduling decisions (this package, pure compute, no I/O)
    queues   -> transport work
    workers  -> execute the batches the planner releases

This package is intentionally dependency-free (stdlib only) so it can be unit /
stress tested without a database or broker, and imported by any service.

Extensibility: planning logic lives behind `PlannerStrategy`. Swapping in a
smarter algorithm (load balancing, predictive, adaptive shifting) is a new
strategy class + registry entry - the config, models, windows, engine, service
loop and monitoring API do not change.
"""
from .config import PlannerConfig, ChannelLimits
from .models import (
    CampaignRequest,
    DeliveryWindow,
    Allocation,
    PlanResult,
    CampaignType,
)
from .engine import Planner
from .strategy import PlannerStrategy, get_strategy, register_strategy, available_strategies

__all__ = [
    "PlannerConfig",
    "ChannelLimits",
    "CampaignRequest",
    "DeliveryWindow",
    "Allocation",
    "PlanResult",
    "CampaignType",
    "Planner",
    "PlannerStrategy",
    "get_strategy",
    "register_strategy",
    "available_strategies",
]
