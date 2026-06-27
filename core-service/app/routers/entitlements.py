"""Public entitlements API — exposes the plan→feature matrix from the shared
SSOT (`shared.domain.entitlements`) so the frontend can gate UI consistently
with backend enforcement.

Public (no auth): the matrix is static, non-sensitive product metadata, mirroring
the public `/plans` endpoint. The frontend uses it to hide features a plan does
not include; the backend independently enforces the same matrix on every write.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from shared.domain.entitlements import entitlement_matrix, feature_keys_for, Feature

router = APIRouter(prefix="/entitlements", tags=["entitlements"])


@router.get("")
def get_entitlements():
    """Full {plan_id: [feature_key, ...]} matrix plus the list of all feature keys."""
    return {
        "features": sorted(f.value for f in Feature),
        "plans": entitlement_matrix(),
    }


@router.get("/{plan_id}")
def get_plan_entitlements(plan_id: str):
    """Feature keys unlocked by a single plan. Unknown plan ids resolve to the
    legacy 'fully entitled' set (matches backend behavior)."""
    if not plan_id:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"plan_id": plan_id, "features": feature_keys_for(plan_id)}
