"""Message-round entitlement + extra-round pricing (SSOT for aub + core).

A plan includes a fixed number of message rounds (campaigns) - the ones created
automatically when the event is provisioned. Anything BEYOND that must be paid
for, priced by how many recipients the round targets (tiered bands).

`INCLUDED_ROUNDS` mirrors the `campaigns` list length in aub's plans.json; both
services read THIS module so the gate and the price agree.
"""
from __future__ import annotations

import json
import math
import os
from typing import Dict, List, Optional, Tuple

# Rounds included with each plan (== len(plan.campaigns) in plans.json). Plans not
# listed (or None) fall back to a large number == effectively unmetered, so a
# missing/unknown plan never wrongly blocks a send.
INCLUDED_ROUNDS: Dict[str, int] = {
    "free": 0,
    "starter": 0,
    "venue": 0,
    "basic": 2,
    "plus": 4,
    "pro": 4,
}

_UNMETERED = 9999


def included_rounds(plan_id: Optional[str]) -> int:
    if plan_id is None:
        return _UNMETERED
    return INCLUDED_ROUNDS.get(str(plan_id).strip().lower(), _UNMETERED)


# Tiered extra-round price by recipient count. Each band is (max_recipients,
# price_gross_ILS); the last band's max is null/None = "and above". VAT-inclusive
# (same convention as plan prices). Overridable via EXTRA_ROUND_PRICES_JSON, e.g.
# [[100,49],[300,89],[null,129]].
_DEFAULT_BANDS: List[Tuple[Optional[int], float]] = [
    (100, 49.0),
    (300, 89.0),
    (None, 129.0),
]


def _bands() -> List[Tuple[Optional[int], float]]:
    raw = os.getenv("EXTRA_ROUND_PRICES_JSON")
    if not raw:
        return _DEFAULT_BANDS
    try:
        parsed = json.loads(raw)
        bands: List[Tuple[Optional[int], float]] = []
        for cap, price in parsed:
            bands.append((None if cap is None else int(cap), float(price)))
        # Sort so unbounded (None) band is last.
        bands.sort(key=lambda b: (b[0] is None, b[0] if b[0] is not None else math.inf))
        return bands or _DEFAULT_BANDS
    except Exception:
        return _DEFAULT_BANDS


def parse_bands(raw) -> Optional[List[Tuple[Optional[int], float]]]:
    """Parse a plan's `extra_round_prices` value ([[cap|null, price], ...]) into
    band tuples, or None when missing/invalid (callers fall back to defaults)."""
    if not raw:
        return None
    try:
        bands: List[Tuple[Optional[int], float]] = []
        for cap, price in raw:
            bands.append((None if cap is None else int(cap), float(price)))
        bands.sort(key=lambda b: (b[0] is None, b[0] if b[0] is not None else math.inf))
        return bands or None
    except Exception:
        return None


def extra_round_price(recipients: int, bands: Optional[List[Tuple[Optional[int], float]]] = None) -> Dict[str, object]:
    """Resolve the extra-round price for a recipient count.

    `bands` are the PLAN's price bands (from the plan doc's `extra_round_prices`);
    when None, the global defaults / env override apply. Returns
    {price_gross, band_max, band_label}. `recipients` is clamped to >= 0.
    """
    n = max(0, int(recipients or 0))
    bands = bands or _bands()
    for cap, price in bands:
        if cap is None or n <= cap:
            label = f"עד {cap} נמענים" if cap is not None else (f"מעל {bands[-2][0]} נמענים" if len(bands) >= 2 and bands[-2][0] is not None else "כל כמות נמענים")
            return {"price_gross": float(price), "band_max": cap, "band_label": label}
    # Shouldn't reach here (last band is unbounded), but be safe.
    cap, price = bands[-1]
    return {"price_gross": float(price), "band_max": cap, "band_label": "כל כמות נמענים"}


def all_bands(bands: Optional[List[Tuple[Optional[int], float]]] = None) -> List[Dict[str, object]]:
    """The full price table, for display before purchase (plan bands or defaults)."""
    out: List[Dict[str, object]] = []
    for cap, price in (bands or _bands()):
        out.append({"band_max": cap, "price_gross": float(price)})
    return out
