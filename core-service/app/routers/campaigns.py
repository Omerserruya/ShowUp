from __future__ import annotations

import uuid
from typing import Optional, List, Union, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import campaign as campaign_crud, event as event_crud
from app.schemas.schemas import CampaignCreate, CampaignOut, CampaignUpdate
from app.utils import paginate_params
from shared.auth.deps import get_current_user_id
from shared.domain.roles import Action
from shared.domain.entitlements import Feature
from app.authz import require_event_permission, require_feature


router = APIRouter(prefix="/campaigns", tags=["campaigns"])


@router.get("", response_model=list[CampaignOut])
def list_campaigns(
    event_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    search: Optional[str] = Query(None),
    order_by: Optional[str] = Query(None, regex="^(schedule_time|created_at)$"),
):
    event = event_crud.get_event(db, event_id)
    require_event_permission(db, event, user_id, Action.CAMPAIGN_READ)
    page, page_size = paginate_params(page, page_size)
    items, _ = campaign_crud.list_campaigns(db, event_id=event_id, page=page, page_size=page_size, search=search, order_by=order_by)
    # For unsent campaigns show the per-campaign audience size; for sent, use the
    # recorded recipient_count.
    from app.audience import count_audience
    result = []
    for c in items:
        out = CampaignOut.model_validate(c)
        if c.status != "sent":
            out = out.model_copy(update={"recipient_count": count_audience(db, event_id, c.audience, c.audience_filter)})
        result.append(out)
    return result


@router.get("/{campaign_id}", response_model=CampaignOut)
def get_campaign(campaign_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    campaign = campaign_crud.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    require_event_permission(db, event_crud.get_event(db, campaign.event_id), user_id, Action.CAMPAIGN_READ)
    out = CampaignOut.model_validate(campaign)
    if campaign.status != "sent":
        from app.audience import count_audience
        out = out.model_copy(update={"recipient_count": count_audience(db, campaign.event_id, campaign.audience, campaign.audience_filter)})
    return out


@router.post("", response_model=Union[CampaignOut, List[CampaignOut]], status_code=201)
def create_campaigns(
    event_id: Optional[uuid.UUID] = Query(None),
    payload: Any = Body(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    # Normalize incoming payload to a list of dicts
    items_raw: List[dict] = []
    if isinstance(payload, list):
        items_raw = payload
    elif isinstance(payload, dict) and "items" in payload and isinstance(payload["items"], list):
        items_raw = payload["items"]
    elif isinstance(payload, dict):
        items_raw = [payload]
    else:
        raise HTTPException(status_code=400, detail="Body must be an object or array of objects")

    # Determine event for bulk/normalize
    normalized_event_id: Optional[uuid.UUID] = event_id
    if normalized_event_id is None:
        maybe_id = (items_raw[0] or {}).get("event_id") if items_raw else None
        if maybe_id:
            try:
                normalized_event_id = uuid.UUID(str(maybe_id))
            except Exception:
                pass

    # Validate ownership and event existence
    if normalized_event_id is None:
        # For single item without query, require event_id in body
        if len(items_raw) == 1 and items_raw[0].get("event_id"):
            try:
                normalized_event_id = uuid.UUID(str(items_raw[0]["event_id"]))
            except Exception:
                raise HTTPException(status_code=422, detail="Invalid event_id format")
        else:
            raise HTTPException(status_code=400, detail="event_id is required (query or in each item)")

    event = event_crud.get_event(db, normalized_event_id)
    require_event_permission(db, event, user_id, Action.CAMPAIGN_WRITE)
    # Tier gate: WhatsApp campaigns are excluded from the Free plan.
    require_feature(event, Feature.WHATSAPP_CAMPAIGNS)

    # Build CampaignCreate list with validation
    to_create: List[CampaignCreate] = []
    for raw in items_raw:
        raw = dict(raw or {})
        raw.setdefault("event_id", str(normalized_event_id))
        try:
            item = CampaignCreate(**raw)
            # Force event_id to normalized value (ignore differing values in body)
            item.event_id = normalized_event_id
            to_create.append(item)
        except ValidationError as e:
            raise HTTPException(status_code=422, detail=e.errors())

    from app.usage import record_usage
    from shared.domain.enums import UsageMetric
    account_id = getattr(event, "account_id", None)

    if len(to_create) == 1:
        try:
            created_one = campaign_crud.create_campaign(db, to_create[0])
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        record_usage(db, account_id=account_id, event_id=normalized_event_id,
                     metric=UsageMetric.ROUND_LAUNCHED, quantity=1, ref_id=created_one.id)
        return created_one

    try:
        created = campaign_crud.create_campaigns_bulk(db, event_id=normalized_event_id, items=to_create)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if created:
        record_usage(db, account_id=account_id, event_id=normalized_event_id,
                     metric=UsageMetric.ROUND_LAUNCHED, quantity=len(created))
    return created


@router.put("/{campaign_id}", response_model=CampaignOut)
def update_campaign(
    campaign_id: uuid.UUID, 
    payload: CampaignUpdate, 
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id)
):
    campaign = campaign_crud.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    require_event_permission(db, event_crud.get_event(db, campaign.event_id), user_id, Action.CAMPAIGN_WRITE)

    try:
        campaign = campaign_crud.update_campaign(db, campaign, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    return campaign


@router.delete("/{campaign_id}", status_code=204)
def delete_campaign(campaign_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    campaign = campaign_crud.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    require_event_permission(db, event_crud.get_event(db, campaign.event_id), user_id, Action.CAMPAIGN_DELETE)
    campaign_crud.delete_campaign(db, campaign)
    return None


@router.delete("", response_model=dict)
def delete_campaigns_by_event(
    event_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    require_event_permission(db, event_crud.get_event(db, event_id), user_id, Action.CAMPAIGN_DELETE)
    count = campaign_crud.delete_campaigns_by_event(db, event_id=event_id)
    return {"deleted": count}


@router.get("/{campaign_id}/stats", response_model=dict)
def get_campaign_stats(
    campaign_id: uuid.UUID,
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Get campaign statistics: sent_count and read_count."""
    campaign = campaign_crud.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    require_event_permission(db, event_crud.get_event(db, campaign.event_id), user_id, Action.CAMPAIGN_READ)

    stats = campaign_crud.get_campaign_stats(db, campaign_id)
    return stats


