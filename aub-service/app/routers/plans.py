"""
Plans API endpoints
"""
from fastapi import APIRouter, HTTPException
from typing import List
from app.mongodb import get_mongodb_db
from app.models.plans import PlanResponse, CampaignSchedule
from bson import ObjectId


router = APIRouter(prefix="/plans", tags=["plans"])


@router.get("", response_model=List[PlanResponse])
def get_plans():
    """
    Get all active plans, sorted by price (ascending)
    """
    db = get_mongodb_db()
    plans_collection = db.plans
    
    # Find all active plans and sort by price (extract numeric value)
    def extract_price(plan):
        """Extract numeric price for sorting"""
        price_str = plan.get("price", "₪0")
        try:
            # Remove currency symbols and extract number
            price_num = float("".join(filter(str.isdigit, price_str.replace(",", ""))))
            return price_num
        except (ValueError, AttributeError):
            return 0
    
    plans = list(plans_collection.find({"is_active": True}))
    plans.sort(key=extract_price)
    
    # Ensure there is exactly one popular plan in DB (fallback for legacy data)
    has_popular = any(bool(p.get("is_popular")) for p in plans)
    if not has_popular:
        # Prefer plan with id 'plus' as default popular (to match old behavior)
        update_result = plans_collection.update_one(
            {"id": "plus"},
            {"$set": {"is_popular": True}}
        )
        # Also update local list so response is correct on this request
        for p in plans:
            if p.get("id") == "plus":
                p["is_popular"] = True
    
    # Convert to response format
    result = []
    for plan in plans:
        plan_id = str(plan.get("_id", ""))
        # Normalize campaigns: convert offset_days to offsetDays
        campaigns_raw = plan.get("campaigns", [])
        campaigns_normalized = []
        for c in campaigns_raw:
            if isinstance(c, dict):
                offset = c.get("offset_days") if "offset_days" in c else c.get("offsetDays", 0)
                campaigns_normalized.append({
                    "enabled": c.get("enabled", True),
                    "label": c.get("label", ""),
                    "offsetDays": offset,
                    "time": c.get("time", "12:00")
                })
            else:
                campaigns_normalized.append(c)
        
        result.append(PlanResponse(
            id=plan.get("id", plan_id),  # Use 'id' field if exists, otherwise _id
            title=plan.get("title", ""),
            subtitle=plan.get("subtitle", ""),
            price=plan.get("price", ""),
            description=plan.get("description", ""),
            features=plan.get("features", []),
            color=plan.get("color", ""),
            # Map DB field `is_popular` -> API field `isPopular`
            isPopular=plan.get("is_popular", False),
            campaigns=campaigns_normalized
        ))
    
    return result


@router.get("/{plan_id}", response_model=PlanResponse)
def get_plan(plan_id: str):
    """
    Get a single plan by ID
    """
    db = get_mongodb_db()
    plans_collection = db.plans
    
    # Try to find by 'id' field first, then by _id
    plan = plans_collection.find_one({"id": plan_id, "is_active": True})
    if not plan:
        # Try by _id if plan_id is a valid ObjectId
        try:
            plan = plans_collection.find_one({"_id": ObjectId(plan_id), "is_active": True})
        except Exception:
            pass
    
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    plan_id_str = str(plan.get("_id", ""))
    # Normalize campaigns: convert offset_days to offsetDays
    campaigns_raw = plan.get("campaigns", [])
    campaigns_normalized = []
    for c in campaigns_raw:
        if isinstance(c, dict):
            offset = c.get("offset_days") if "offset_days" in c else c.get("offsetDays", 0)
            campaigns_normalized.append({
                "enabled": c.get("enabled", True),
                "label": c.get("label", ""),
                "offsetDays": offset,
                "time": c.get("time", "12:00")
            })
        else:
            campaigns_normalized.append(c)
    
    return PlanResponse(
        id=plan.get("id", plan_id_str),
        title=plan.get("title", ""),
        subtitle=plan.get("subtitle", ""),
        price=plan.get("price", ""),
        description=plan.get("description", ""),
        features=plan.get("features", []),
        color=plan.get("color", ""),
        # Map DB field `is_popular` -> API field `isPopular`
        isPopular=plan.get("is_popular", False),
        campaigns=campaigns_normalized
    )


@router.get("/{plan_id}/campaigns", response_model=List[CampaignSchedule])
def get_plan_campaigns(plan_id: str):
    """
    Get campaigns for a specific plan
    """
    db = get_mongodb_db()
    plans_collection = db.plans
    
    # Try to find by 'id' field first, then by _id
    plan = plans_collection.find_one({"id": plan_id, "is_active": True})
    if not plan:
        try:
            plan = plans_collection.find_one({"_id": ObjectId(plan_id), "is_active": True})
        except Exception:
            pass
    
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    campaigns = plan.get("campaigns", [])
    # Sort by offsetDays descending (30, 7, 1, -1)
    campaigns_sorted = sorted(
        campaigns, 
        key=lambda x: x.get("offset_days", x.get("offsetDays", 0)) if isinstance(x, dict) else getattr(x, "offset_days", getattr(x, "offsetDays", 0)), 
        reverse=True
    )
    
    # Convert to CampaignSchedule objects
    result = []
    for c in campaigns_sorted:
        if isinstance(c, dict):
            # Normalize offset_days/offsetDays
            offset = c.get("offset_days") if "offset_days" in c else c.get("offsetDays", 0)
            result.append(CampaignSchedule(
                enabled=c.get("enabled", True),
                label=c.get("label", ""),
                offsetDays=offset,
                time=c.get("time", "12:00")
            ))
        else:
            result.append(c)
    
    return result
