"""Admin-editable overrides layered on top of the static plans config.

`plans.json` (see `plans_data.py`) is the immutable catalogue baked into the
image - it defines every plan/edition, its pricing, guest `count_limit`, and
marketing copy. This module adds the ONE thing an operator needs to change at
runtime without a deploy: whether a plan is currently purchasable (enable /
disable).

Kept in Postgres (not written back to the JSON file) because the JSON lives
inside the container image and any file write would be lost on the next rebuild.
The table is the override layer; the JSON stays the source of truth for
everything else. This is intentionally the minimal V1 surface - adding richer
per-plan editing later is a matter of widening this table, not redesigning the
console.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

import psycopg2


def _connect(env: Dict[str, Any]):
    return psycopg2.connect(
        host=env["DB_HOST"],
        port=env["DB_PORT"],
        user=env["DB_USER"],
        password=env["DB_PASSWORD"],
        dbname=env["DB_NAME"],
    )


def ensure_plan_overrides_table(env: Dict[str, Any]) -> None:
    """Idempotent DDL. Safe to call on every request (mirrors ensure_orders_table)."""
    ddl = (
        "CREATE TABLE IF NOT EXISTS plan_overrides ("
        "plan_id TEXT PRIMARY KEY,"
        "is_active BOOLEAN,"
        "updated_by TEXT,"
        "updated_at TIMESTAMP NOT NULL DEFAULT NOW()"
        ")"
    )
    with _connect(env) as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(ddl)


def get_overrides(env: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Return {plan_id: {"is_active": bool, "updated_by": str|None,
    "updated_at": iso|None}} for every plan that has an override row.

    Best-effort: on any DB error returns {} so the plans listing/pricing never
    breaks just because the override layer is unavailable.
    """
    try:
        ensure_plan_overrides_table(env)
        with _connect(env) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT plan_id, is_active, updated_by, updated_at FROM plan_overrides"
                )
                rows = cur.fetchall()
        out: Dict[str, Dict[str, Any]] = {}
        for plan_id, is_active, updated_by, updated_at in rows:
            out[plan_id] = {
                "is_active": is_active,
                "updated_by": str(updated_by) if updated_by else None,
                "updated_at": updated_at.isoformat() if updated_at else None,
            }
        return out
    except Exception as exc:  # pragma: no cover - override layer is non-critical
        print(f"[PLAN_OVERRIDES] read failed (ignoring): {exc}")
        return {}


def set_active_override(env: Dict[str, Any], plan_id: str, is_active: bool, admin_id: str) -> Dict[str, Any]:
    """Upsert the is_active override for a plan. Returns the stored row."""
    ensure_plan_overrides_table(env)
    with _connect(env) as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO plan_overrides (plan_id, is_active, updated_by, updated_at) "
                "VALUES (%s, %s, %s, NOW()) "
                "ON CONFLICT (plan_id) DO UPDATE SET "
                "is_active = EXCLUDED.is_active, updated_by = EXCLUDED.updated_by, updated_at = NOW() "
                "RETURNING plan_id, is_active, updated_by, updated_at",
                (plan_id, is_active, str(admin_id)),
            )
            plan_id, is_active, updated_by, updated_at = cur.fetchone()
    return {
        "plan_id": plan_id,
        "is_active": is_active,
        "updated_by": str(updated_by) if updated_by else None,
        "updated_at": updated_at.isoformat() if updated_at else None,
    }


def effective_is_active(plan: Dict[str, Any], overrides: Dict[str, Dict[str, Any]]) -> bool:
    """Resolve a plan's live purchasable state: the admin override wins when set,
    otherwise the JSON default (`is_active`, defaulting to True)."""
    ov = overrides.get(plan.get("id"))
    if ov is not None and ov.get("is_active") is not None:
        return bool(ov["is_active"])
    return bool(plan.get("is_active", True))
