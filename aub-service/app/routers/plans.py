"""
Plans API endpoints

Backed by the static JSON config (app/data/plans.json) via app.plans_data - no
database. Output shape is unchanged from the previous Mongo-backed version.
"""
from fastapi import APIRouter, HTTPException
from typing import List
from app.plans_data import active_plans, load_plans, get_plan as get_plan_doc
from app.models.plans import PlanResponse, CampaignSchedule


router = APIRouter(prefix="/plans", tags=["plans"])


def _extract_price(plan):
    """Extract numeric price for sorting."""
    price_str = plan.get("price", "₪0")
    try:
        return float("".join(filter(str.isdigit, price_str.replace(",", ""))))
    except (ValueError, AttributeError):
        return 0


def _normalize_campaigns(campaigns_raw):
    result = []
    for c in campaigns_raw or []:
        if isinstance(c, dict):
            offset = c.get("offset_days") if "offset_days" in c else c.get("offsetDays", 0)
            result.append({
                "enabled": c.get("enabled", True),
                "label": c.get("label", ""),
                "offsetDays": offset,
                "time": c.get("time", "12:00"),
            })
        else:
            result.append(c)
    return result


def _to_response(plan: dict) -> PlanResponse:
    return PlanResponse(
        id=plan.get("id", ""),
        title=plan.get("title", ""),
        subtitle=plan.get("subtitle", ""),
        price=plan.get("price", ""),
        description=plan.get("description", ""),
        features=plan.get("features", []),
        color=plan.get("color", ""),
        isPopular=plan.get("is_popular", False),
        campaigns=_normalize_campaigns(plan.get("campaigns", [])),
        countLimit=plan.get("count_limit"),
        extraRoundPrices=plan.get("extra_round_prices"),
    )


def _effective_active_plans():
    """Active plans from the JSON catalogue, with admin enable/disable overrides
    applied. A plan an operator disabled in the console is hidden here even if
    its JSON default is active (and vice-versa)."""
    import os
    from app import plan_overrides as po
    env = {
        "DB_HOST": os.getenv("DB_HOST"),
        "DB_PORT": int(os.getenv("DB_PORT", 5432)),
        "DB_USER": os.getenv("DB_USER"),
        "DB_PASSWORD": os.getenv("DB_PASSWORD"),
        "DB_NAME": os.getenv("DB_NAME"),
    }
    overrides = po.get_overrides(env)  # best-effort; {} if unavailable
    return [p for p in load_plans() if po.effective_is_active(p, overrides)]


@router.get("", response_model=List[PlanResponse])
def get_plans():
    """Get all active plans, sorted by price (ascending)."""
    plans = sorted(_effective_active_plans(), key=_extract_price)

    # Fallback: guarantee exactly one "popular" plan for legacy UI expectations.
    if plans and not any(p.get("is_popular") for p in plans):
        for p in plans:
            if p.get("id") == "plus":
                p["is_popular"] = True

    return [_to_response(p) for p in plans]


@router.get("/{plan_id}", response_model=PlanResponse)
def get_plan(plan_id: str):
    """Get a single plan by ID."""
    plan = get_plan_doc(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return _to_response(plan)


@router.get("/{plan_id}/campaigns", response_model=List[CampaignSchedule])
def get_plan_campaigns(plan_id: str):
    """Get campaigns for a specific plan, sorted by offsetDays descending."""
    plan = get_plan_doc(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    campaigns = _normalize_campaigns(plan.get("campaigns", []))
    campaigns.sort(key=lambda x: x.get("offsetDays", 0), reverse=True)
    return [
        CampaignSchedule(
            enabled=c.get("enabled", True),
            label=c.get("label", ""),
            offsetDays=c.get("offsetDays", 0),
            time=c.get("time", "12:00"),
        )
        for c in campaigns
    ]
