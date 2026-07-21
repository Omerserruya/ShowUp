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
from app.authz import require_event_permission


router = APIRouter(prefix="/campaigns", tags=["campaigns"])


# ---------------------------------------------------------------------------
# Paid extra rounds
# ---------------------------------------------------------------------------

def _rounds_used(db: Session, event_id) -> int:
    """Rounds this event has CONSUMED, from the append-only usage ledger.

    Deliberately not `COUNT(campaigns)`: that made consumption reversible, so
    "create a round, send it, delete it" refunded a paid round indefinitely.
    Round usage is billing usage - it only ever goes up.
    """
    from app.usage import event_usage_total
    from shared.domain.enums import UsageMetric
    return event_usage_total(db, event_id, UsageMetric.ROUND_LAUNCHED)


def _rounds_status(db: Session, event) -> dict:
    """included / used / allowance / whether the next round is free."""
    from app.entitlement_service import effective_included_rounds
    used = _rounds_used(db, event.id)
    # Honour a per-event override from the entitlement (e.g. a promo bundle),
    # else the plan's included rounds.
    included = effective_included_rounds(event)
    allowance = int(getattr(event, "extra_rounds_allowance", 0) or 0)
    free_total = included + allowance
    return {
        "included": included,
        "allowance": allowance,
        "used": used,
        "free_total": free_total,
        "remaining": max(0, free_total - used),
        "next_round_free": used < free_total,
    }


def _require_rounds_available(db: Session, event, event_id, requested: int, items) -> None:
    """Reject a create that would consume more rounds than the event has left.

    Applies to EVERY create path. The old gate ran only when exactly one campaign
    was being created, so posting a two-element `items` array skipped it entirely
    and produced unlimited free rounds. Provisioning is not a special case: a
    plan's included rounds are, by definition, within its own entitlement.
    """
    status = _rounds_status(db, event)
    if requested <= status["remaining"]:
        return
    from shared.domain.rounds import extra_round_price
    from app.plans_client import plan_extra_round_bands
    from app.audience import count_audience
    first = items[0] if items else None
    recipients = count_audience(
        db, event_id,
        getattr(first, "audience", "everyone") if first else "everyone",
        getattr(first, "audience_filter", None) if first else None,
    )
    price = extra_round_price(recipients, plan_extra_round_bands(getattr(event, "plan_id", None)))
    raise HTTPException(status_code=402, detail={
        "code": "extra_round_required",
        "message": "הסבב הזה הוא מעבר למה שכלול בחבילה - יש לרכוש אותו לפני היצירה.",
        "requested": requested,
        "recipients": recipients,
        "price_gross": price["price_gross"],
        "band_label": price["band_label"],
        **status,
    })


def _wa_template_row(db: Session, ref: str) -> Optional[dict]:
    """db_lookup for resolve_template: fetch a custom event-scoped template by id,
    shaped like the worker's `wa_templates` row."""
    try:
        tid = uuid.UUID(str(ref))
    except (ValueError, TypeError):
        return None
    from app.models.models import WaTemplate
    t = db.query(WaTemplate).filter(WaTemplate.id == tid).first()
    if not t:
        return None
    return {
        "id": str(t.id), "flow_stage": t.flow_stage, "components": t.components,
        "name": t.name, "body": t.body, "language": t.language,
        "event_type": t.event_type, "visibility": t.visibility, "lifecycle": t.lifecycle,
    }


def _require_deliverable_template(db: Session, template_ref: Optional[str],
                                  custom_message: Optional[str],
                                  event_type: Optional[str] = None) -> None:
    """Reject a campaign whose template cannot actually be delivered. A custom
    free-text body sends as plain text (no Meta template needed); otherwise the
    template must resolve to a usable catalog template - one with an approved Meta
    mapping. Mirrors the worker's resolution (including the event-type variant
    preference) so we never enqueue a send that will crash at build time."""
    if custom_message and custom_message.strip():
        return
    from shared.domain.messaging import resolve_template
    tmpl = resolve_template(template_ref, event_type=event_type,
                            db_lookup=lambda ref: _wa_template_row(db, ref))
    # Unresolvable refs are left to the worker (may be a stage/variant-addressed
    # campaign we don't model here); only block a template we CAN resolve and know
    # is undeliverable.
    if tmpl is not None and not tmpl.is_usable:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Template '{template_ref}' cannot be delivered yet: it has no approved "
                f"Meta template mapping. Choose a sendable template or provide a custom message."
            ),
        )


@router.get("/rounds-status")
def rounds_status(
    event_id: uuid.UUID = Query(...),
    audience: str = Query("everyone"),
    audience_filter: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Round entitlement for an event + the price of the NEXT (extra) round.

    The Messages "new round" dialog reads this to decide whether creating another
    round is free (included/paid) or needs a purchase, and what it would cost."""
    event = event_crud.get_event(db, event_id)
    require_event_permission(db, event, user_id, Action.CAMPAIGN_READ)
    status = _rounds_status(db, event)
    from shared.domain.rounds import extra_round_price, all_bands
    from app.plans_client import plan_extra_round_bands
    from app.audience import count_audience
    import json as _json
    af = None
    if audience_filter:
        try:
            af = _json.loads(audience_filter)
        except (ValueError, TypeError):
            af = None
    recipients = count_audience(db, event_id, audience, af)
    # Extra-round pricing is per-plan (plans.json `extra_round_prices`).
    bands = plan_extra_round_bands(getattr(event, "plan_id", None))
    price = extra_round_price(recipients, bands)
    return {
        **status,
        "recipients": recipients,
        "next_round_price_gross": None if status["next_round_free"] else price["price_gross"],
        "next_round_band_label": price["band_label"],
        "price_bands": all_bands(bands),
    }


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

    # Build CampaignCreate list with validation
    to_create: List[CampaignCreate] = []
    for raw in items_raw:
        raw = dict(raw or {})
        raw.setdefault("event_id", str(normalized_event_id))
        try:
            item = CampaignCreate(**raw)
            # Force event_id to normalized value (ignore differing values in body)
            item.event_id = normalized_event_id
        except ValidationError as e:
            raise HTTPException(status_code=422, detail=e.errors())
        # Block campaigns whose template can't actually be delivered (no Meta mapping).
        _require_deliverable_template(db, item.template, item.custom_message,
                                      event_type=getattr(event, "event_type", None))
        to_create.append(item)

    from app.usage import record_usage
    from shared.domain.enums import UsageMetric
    account_id = getattr(event, "account_id", None)

    # Paid-rounds gate. Applies to EVERY create path, single or bulk: the batch
    # must fit within the event's remaining (included + purchased) rounds.
    _require_rounds_available(db, event, normalized_event_id, len(to_create), to_create)

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

    # If the template is being changed, ensure the new one is actually deliverable.
    # A free-text campaign (existing custom_message) sends as plain text regardless.
    if payload.template is not None and payload.template != campaign.template:
        _event = event_crud.get_event(db, campaign.event_id)
        _require_deliverable_template(db, payload.template, campaign.custom_message,
                                      event_type=getattr(_event, "event_type", None))

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

    event = event_crud.get_event(db, campaign.event_id)
    require_event_permission(db, event, user_id, Action.CAMPAIGN_READ)

    stats = campaign_crud.get_campaign_stats(db, campaign_id)
    return stats


