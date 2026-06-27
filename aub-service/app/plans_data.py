"""Plans config source.

Plans are static product config (~4 documents): tier id, marketing copy, price,
guest `count_limit`, and default campaign schedule. They live in `data/plans.json`
and are read here. (Previously stored in MongoDB; that dependency was removed —
the file IS the source of truth, edited via deploy.)

Feature/tier *entitlements* are a separate SSOT in `shared/domain/entitlements.py`.
"""
from __future__ import annotations

import json
import os
from typing import List, Dict, Any, Optional

_PLANS_PATH = os.path.join(os.path.dirname(__file__), "data", "plans.json")


def load_plans() -> List[Dict[str, Any]]:
    """Read all plans from the JSON config. Re-read each call so edits to the
    config file take effect without a process restart (the file is tiny)."""
    try:
        with open(_PLANS_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def active_plans() -> List[Dict[str, Any]]:
    return [p for p in load_plans() if p.get("is_active", True)]


def get_plan(plan_id: str) -> Optional[Dict[str, Any]]:
    for p in load_plans():
        if p.get("id") == plan_id and p.get("is_active", True):
            return p
    return None
