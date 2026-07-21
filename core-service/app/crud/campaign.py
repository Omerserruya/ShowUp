from __future__ import annotations

import os
import uuid
from typing import List, Optional, Tuple
import datetime as dt

from sqlalchemy.orm import Session

from app.models.models import Campaign, Event, Guest
from app.schemas.schemas import CampaignCreate, CampaignUpdate

# Configurable minimum gap between campaigns (in minutes). Defaults to 300 (5h)
# so a missing env var cannot crash the service at import time.
CAMPAIGN_MIN_GAP_MINUTES = int(os.getenv("CAMPAIGN_MIN_GAP_MINUTES") or 300)


def _aud(value):
    """Coerce a CampaignAudience enum (or str/None) to its stored string value."""
    return value.value if hasattr(value, "value") else value


def _canonical_key(template_ref) -> Optional[str]:
    """Canonical catalog key for a template reference (SSOT), or None. Stored on
    the campaign so every layer shares one identifier. UUID refs (event-scoped
    custom templates) resolve at send time with a DB lookup, so they stay None
    here - the worker still resolves them correctly."""
    try:
        from shared.domain.messaging import resolve_template
        t = resolve_template(template_ref)
        return t.key if t else None
    except Exception:
        return None


def _stage_variant(template_ref) -> Tuple[Optional[str], Optional[str]]:
    """(stage_id, variant_id) for a campaign's template - the stage-execution
    coordinates. Both resolve back to the same channel template, so this is a
    label on top of delivery, not a behavior change."""
    try:
        from shared.domain.messaging import resolve_template, stage_variant_for_template
        t = resolve_template(template_ref)
        sv = stage_variant_for_template(t.key) if t else None
        return sv if sv else (None, None)
    except Exception:
        return (None, None)


def list_campaigns(
    db: Session,
    event_id: uuid.UUID,
    page: int,
    page_size: int,
    search: Optional[str] = None,
    order_by: Optional[str] = None,
) -> Tuple[List[Campaign], int]:
    query = db.query(Campaign).filter(Campaign.event_id == str(event_id))
    if search:
        like = f"%{search}%"
        query = query.filter(Campaign.name.ilike(like))
    total = query.count()
    
    # Order by schedule_time if requested, otherwise by created_at
    if order_by == "schedule_time":
        items = (
            query.order_by(Campaign.schedule_time.asc().nullslast())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
    else:
        items = (
            query.order_by(Campaign.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
    return items, total


def get_campaign(db: Session, campaign_id: uuid.UUID) -> Optional[Campaign]:
    return db.query(Campaign).filter(Campaign.id == str(campaign_id)).first()


def create_campaign(db: Session, data: CampaignCreate) -> Campaign:
    # ensure event exists
    event = db.query(Event).filter(Event.id == str(data.event_id)).first()
    if not event:
        raise ValueError("event_id does not exist")

    # Enforce minimum gap between campaigns for same event
    if data.schedule_time is not None:
        window_start = data.schedule_time - dt.timedelta(minutes=CAMPAIGN_MIN_GAP_MINUTES)
        window_end = data.schedule_time + dt.timedelta(minutes=CAMPAIGN_MIN_GAP_MINUTES)
        conflict = (
            db.query(Campaign)
            .filter(
                Campaign.event_id == str(data.event_id),
                Campaign.schedule_time != None,
                Campaign.schedule_time >= window_start,
                Campaign.schedule_time <= window_end,
            )
            .first()
        )
        if conflict:
            raise ValueError(f"campaign schedule conflicts with another campaign (min {CAMPAIGN_MIN_GAP_MINUTES} minutes apart)")

    _tkey = _canonical_key(data.template)
    _sid, _vid = _stage_variant(data.template)
    campaign = Campaign(
        event_id=str(data.event_id),
        name=data.name,
        template=data.template,
        template_key=_tkey,
        stage_id=_sid,
        variant_id=_vid,
        custom_message=getattr(data, "custom_message", None),
        header_image_url=getattr(data, "header_image_url", None),
        channel=data.channel,
        schedule_time=data.schedule_time,
        status=data.status,
        audience=_aud(data.audience),
        audience_filter=data.audience_filter,
        follow_up_after_hours=data.follow_up_after_hours,
        follow_up_audience=_aud(data.follow_up_audience),
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign


def update_campaign(db: Session, campaign: Campaign, data: CampaignUpdate) -> Campaign:
    if data.name is not None:
        campaign.name = data.name
    if data.template is not None:
        campaign.template = data.template
    if data.channel is not None:
        campaign.channel = data.channel
    if data.schedule_time is not None:
        # enforce minimum gap spacing on update
        window_start = data.schedule_time - dt.timedelta(minutes=CAMPAIGN_MIN_GAP_MINUTES)
        window_end = data.schedule_time + dt.timedelta(minutes=CAMPAIGN_MIN_GAP_MINUTES)
        conflict = (
            db.query(Campaign)
            .filter(
                Campaign.event_id == campaign.event_id,
                Campaign.id != campaign.id,
                Campaign.schedule_time != None,
                Campaign.schedule_time >= window_start,
                Campaign.schedule_time <= window_end,
            )
            .first()
        )
        if conflict:
            raise ValueError(f"campaign schedule conflicts with another campaign (min {CAMPAIGN_MIN_GAP_MINUTES} minutes apart)")
        campaign.schedule_time = data.schedule_time
    if data.status is not None:
        campaign.status = data.status
    if data.audience is not None:
        campaign.audience = _aud(data.audience)
    if data.audience_filter is not None:
        campaign.audience_filter = data.audience_filter
    if data.follow_up_after_hours is not None:
        campaign.follow_up_after_hours = data.follow_up_after_hours
    if data.follow_up_audience is not None:
        campaign.follow_up_audience = _aud(data.follow_up_audience)
    if data.header_image_url is not None:
        campaign.header_image_url = data.header_image_url or None
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign


def delete_campaign(db: Session, campaign: Campaign) -> None:
    db.delete(campaign)
    db.commit()


def create_campaigns_bulk(db: Session, event_id: uuid.UUID, items: List[CampaignCreate]) -> List[Campaign]:
    # ensure event exists
    event = db.query(Event).filter(Event.id == str(event_id)).first()
    if not event:
        raise ValueError("event_id does not exist")

    created: List[Campaign] = []
    # Deduplicate within the same request by (name, template, channel, schedule_time)
    seen_keys: set[tuple] = set()
    for idx, data in enumerate(items):
        key = (data.name, data.template, data.channel, data.schedule_time)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        _b_sid, _b_vid = _stage_variant(data.template)
        c = Campaign(  # noqa: E128
            template_key=_canonical_key(data.template),
            stage_id=_b_sid,
            variant_id=_b_vid,
            event_id=str(event_id),
            name=data.name,
            template=data.template,
            custom_message=getattr(data, "custom_message", None),
            channel=data.channel,
            schedule_time=data.schedule_time,
            status=data.status,
            audience=_aud(data.audience),
            audience_filter=data.audience_filter,
            follow_up_after_hours=data.follow_up_after_hours,
            follow_up_audience=_aud(data.follow_up_audience),
        )
        # Enforce spacing: check conflicts within DB and within batch
        # BUT: allow multiple campaigns with same schedule_time if they have different template/name
        if c.schedule_time is not None:
            window_start = c.schedule_time - dt.timedelta(minutes=CAMPAIGN_MIN_GAP_MINUTES)
            window_end = c.schedule_time + dt.timedelta(minutes=CAMPAIGN_MIN_GAP_MINUTES)
            # Check DB conflicts - only if same template AND name (different templates can share time)
            conflict_db = (
                db.query(Campaign)
                .filter(
                    Campaign.event_id == str(event_id),
                    Campaign.schedule_time != None,
                    Campaign.schedule_time >= window_start,
                    Campaign.schedule_time <= window_end,
                    Campaign.template == c.template,
                    Campaign.name == c.name,
                )
                .first()
            )
            # Check batch conflicts - only if same template AND name
            conflict_batch = any(
                (x.schedule_time is not None 
                 and window_start <= x.schedule_time <= window_end
                 and x.template == c.template
                 and x.name == c.name)
                for x in created
            )
            if conflict_db:
                continue
            if conflict_batch:
                continue
        db.add(c)
        created.append(c)
    db.commit()
    for c in created:
        db.refresh(c)
    return created


def delete_campaigns_by_event(db: Session, event_id: uuid.UUID) -> int:
    # returns number of rows deleted
    q = db.query(Campaign).filter(Campaign.event_id == str(event_id))
    count = q.count()
    q.delete(synchronize_session=False)
    db.commit()
    return count


def get_campaign_stats(db: Session, campaign_id: uuid.UUID) -> dict:
    """
    Get campaign statistics:
    - sent_count: Number of recipients the campaign was sent to (from messages_sent)
    - read_count: Number of recipients who read the message (from messages_log with status='read')
    
    Returns dict with sent_count and read_count.
    """
    from sqlalchemy import text
    
    campaign_id_str = str(campaign_id)
    
    # Per-status message counts. `sent_count` deliberately counts only messages
    # Meta ACCEPTED - a plain COUNT(*) counted rows the worker had merely queued,
    # so a campaign that Meta rejected wholesale still reported a full send.
    from shared.domain.delivery import MessageDeliveryStatus
    status_rows = db.execute(
        text("SELECT status, COUNT(*) FROM messages_sent WHERE campaign_id = :campaign_id GROUP BY status"),
        {"campaign_id": campaign_id_str},
    ).fetchall()
    by_status = {row[0]: int(row[1]) for row in status_rows}

    sent_count = sum(by_status.get(s, 0) for s in MessageDeliveryStatus.successful_values())
    failed_count = by_status.get(MessageDeliveryStatus.FAILED.value, 0)
    queued_count = by_status.get(MessageDeliveryStatus.QUEUED.value, 0)
    delivered_count = (
        by_status.get(MessageDeliveryStatus.DELIVERED.value, 0)
        + by_status.get(MessageDeliveryStatus.READ.value, 0)
    )
    
    # Count read recipients from messages_log table
    # A message is considered "read" if there's a status update with status='read' 
    # for an outgoing message with this campaign_id
    # Outgoing rows often have no guest_phone (the webhook's 'status' rows carry
    # it) - count via whichever side has the phone, else the message id itself.
    read_result = db.execute(
        text("""
            SELECT COUNT(DISTINCT COALESCE(ml_status.guest_phone,
                                           ml_outgoing.guest_phone,
                                           ml_outgoing.wa_message_id))
            FROM messages_log ml_outgoing
            INNER JOIN messages_log ml_status
                ON ml_status.wa_message_id = ml_outgoing.wa_message_id
                AND ml_status.direction = 'status'
                AND ml_status.status = 'read'
            WHERE ml_outgoing.campaign_id = :campaign_id
                AND ml_outgoing.direction = 'outgoing'
        """),
        {"campaign_id": campaign_id_str}
    )
    read_count = read_result.scalar() or 0
    
    return {
        # Accepted by Meta - the honest "sent" number.
        "sent_count": sent_count,
        "read_count": read_count,
        # Partial-failure visibility. Zero for a healthy campaign, so existing
        # consumers that ignore these fields are unaffected.
        "failed_count": failed_count,
        "queued_count": queued_count,
        "delivered_count": delivered_count,
        "attempted_count": sent_count + failed_count + queued_count,
    }


