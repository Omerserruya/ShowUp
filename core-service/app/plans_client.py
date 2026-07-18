"""Lookup of plan pricing config from aub-service (the plans.json owner).

Plans differ only by guest capacity and campaign rounds; the price of an EXTRA
round is likewise plan-specific (`extra_round_prices` in aub's plans.json).
This client resolves those bands for core's quote/gate paths, with a short
in-process cache (plans are near-static config) and a fail-open fallback to the
global default bands in `shared/domain/rounds.py` - mirroring the fail-open
behavior of the guest `count_limit` lookup.
"""
from __future__ import annotations

import logging
import os
import time
from typing import List, Optional, Tuple

import httpx

from shared.domain.rounds import parse_bands

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 60
_cache: dict[str, tuple[float, Optional[List[Tuple[Optional[int], float]]]]] = {}


def plan_extra_round_bands(plan_id: Optional[str]) -> Optional[List[Tuple[Optional[int], float]]]:
    """The plan's extra-round price bands, or None (=> global defaults apply)."""
    if not plan_id:
        return None
    key = str(plan_id).strip().lower()
    hit = _cache.get(key)
    now = time.time()
    if hit and now - hit[0] < _CACHE_TTL_SECONDS:
        return hit[1]

    bands = None
    aub_service_url = os.getenv("AUB_SERVICE_URL", "http://aub-service:8000")
    try:
        with httpx.Client(timeout=2.0) as client:
            r = client.get(f"{aub_service_url}/plans/{key}")
            if r.status_code == 200:
                bands = parse_bands(r.json().get("extraRoundPrices"))
            else:
                logger.warning("plan bands lookup: aub returned %s for '%s'", r.status_code, key)
    except Exception as exc:
        logger.warning("plan bands lookup errored for '%s': %s", key, exc)

    _cache[key] = (now, bands)
    return bands
