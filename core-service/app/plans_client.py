"""Lookup of plan config from aub-service (the plans.json owner).

Plans differ only by guest capacity and campaign rounds; the price of an EXTRA
round is likewise plan-specific (`extra_round_prices` in aub's plans.json). This
client is the SINGLE place core resolves plan config, so the guest-capacity gate
and the extra-round quote can never disagree or drift apart.

Availability policy differs by what is being resolved, deliberately:

* Extra-round PRICE bands fail open to the global defaults - a pricing blip
  should not block a purchase, and the fallback price is a real price.
* Guest `count_limit` fails CLOSED, via `PlanLookupUnavailable`. It used to
  return None ("no limit") on any error, which meant a 2-second aub timeout
  silently disabled guest caps across the whole platform - an availability
  problem escalating into a billing one. Successful lookups are retained as
  last-known-good well past the refresh TTL, so a brief aub outage keeps serving
  the correct limit and only a cold cache can actually deny.
"""
from __future__ import annotations

import logging
import os
import time
from typing import List, Optional, Tuple

import httpx

from shared.domain.rounds import UNMETERED_PLAN_IDS, parse_bands

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 60
# How long a previously-successful lookup stays usable when aub is unreachable.
# Plans are near-static config, so serving a stale limit is far safer than
# serving no limit at all.
_STALE_OK_SECONDS = 24 * 60 * 60
_cache: dict[str, tuple[float, Optional[List[Tuple[Optional[int], float]]]]] = {}
_limit_cache: dict[str, tuple[float, Optional[int]]] = {}


class PlanLookupUnavailable(RuntimeError):
    """Plan config could not be resolved and no last-known-good value exists."""


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


def plan_count_limit(plan_id: Optional[str]) -> Optional[int]:
    """The plan's guest capacity, or None when the plan is genuinely unmetered.

    Raises `PlanLookupUnavailable` when the limit cannot be determined, so the
    caller denies rather than silently granting unlimited guests. Callers that
    legitimately have no plan (already-unmetered events) should not reach here.
    """
    if not plan_id:
        # An event with no plan at all. Historically this meant "unmetered"; the
        # provisioning migration backfills such rows to the explicit `legacy`
        # plan, so reaching here means a code path built an event without going
        # through app.provisioning. Treat as unmetered for compatibility, but say so.
        logger.warning("plan_count_limit called with no plan_id; treating as unmetered")
        return None

    key = str(plan_id).strip().lower()
    if key in UNMETERED_PLAN_IDS:
        return None

    now = time.time()
    hit = _limit_cache.get(key)
    if hit and now - hit[0] < _CACHE_TTL_SECONDS:
        return hit[1]

    aub_service_url = os.getenv("AUB_SERVICE_URL", "http://aub-service:8000")
    try:
        with httpx.Client(timeout=2.0) as client:
            # aub exposes /plans/{id} (the /api prefix is an nginx-only rewrite and
            # is NOT present on the service address, so /api/plans/... 404s here).
            response = client.get(f"{aub_service_url}/plans/{key}")
            if response.status_code == 200:
                limit = response.json().get("countLimit")
                limit = int(limit) if limit is not None else None
                _limit_cache[key] = (now, limit)
                return limit
            if response.status_code == 404:
                # An unknown plan id is a configuration error, not a licence to
                # ignore capacity. Fail closed.
                raise PlanLookupUnavailable(f"unknown plan '{key}'")
            logger.warning(
                "plan count_limit lookup failed: aub returned %s for plan '%s'",
                response.status_code, key,
            )
    except PlanLookupUnavailable:
        raise
    except Exception as exc:
        logger.warning("plan count_limit lookup errored for '%s': %s", key, exc)

    if hit and now - hit[0] < _STALE_OK_SECONDS:
        logger.warning("serving stale count_limit for '%s' (aub unreachable)", key)
        return hit[1]
    raise PlanLookupUnavailable(f"could not resolve count_limit for plan '{key}'")
