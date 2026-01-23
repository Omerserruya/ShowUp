from __future__ import annotations

import os
import uuid
from typing import List, Optional, Tuple
import datetime as dt

from sqlalchemy.orm import Session

from app.models.models import Campaign, Event
from app.schemas.schemas import CampaignCreate, CampaignUpdate

# Configurable minimum gap between campaigns (in minutes)
CAMPAIGN_MIN_GAP_MINUTES = int(os.getenv("CAMPAIGN_MIN_GAP_MINUTES"))  # 5 hours = 300 minutes


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

    campaign = Campaign(
        event_id=str(data.event_id),
        name=data.name,
        template=data.template,
        channel=data.channel,
        schedule_time=data.schedule_time,
        status=data.status,
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
            print(f"[CREATE_CAMPAIGNS_BULK] Campaign[{idx}] skipped: duplicate key {key}")
            continue
        seen_keys.add(key)
        c = Campaign(
            event_id=str(event_id),
            name=data.name,
            template=data.template,
            channel=data.channel,
            schedule_time=data.schedule_time,
            status=data.status,
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
                print(f"[CREATE_CAMPAIGNS_BULK] Campaign[{idx}] '{c.name}' ({c.template}) skipped: DB conflict at {c.schedule_time}")
                continue
            if conflict_batch:
                print(f"[CREATE_CAMPAIGNS_BULK] Campaign[{idx}] '{c.name}' ({c.template}) skipped: batch conflict at {c.schedule_time}")
                continue
        print(f"[CREATE_CAMPAIGNS_BULK] Campaign[{idx}] '{c.name}' ({c.template}) added: schedule_time={c.schedule_time}")
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
    
    # Count sent recipients from messages_sent table
    sent_result = db.execute(
        text("SELECT COUNT(*) FROM messages_sent WHERE campaign_id = :campaign_id"),
        {"campaign_id": campaign_id_str}
    )
    sent_count = sent_result.scalar() or 0
    
    # Count read recipients from messages_log table
    # A message is considered "read" if there's a status update with status='read' 
    # for an outgoing message with this campaign_id
    read_result = db.execute(
        text("""
            SELECT COUNT(DISTINCT ml_outgoing.guest_phone)
            FROM messages_log ml_outgoing
            INNER JOIN messages_log ml_status 
                ON ml_status.wa_message_id = ml_outgoing.wa_message_id
                AND ml_status.direction = 'status'
                AND ml_status.status = 'read'
            WHERE ml_outgoing.campaign_id = :campaign_id
                AND ml_outgoing.direction = 'outgoing'
                AND ml_outgoing.guest_phone IS NOT NULL
        """),
        {"campaign_id": campaign_id_str}
    )
    read_count = read_result.scalar() or 0
    
    return {
        "sent_count": sent_count,
        "read_count": read_count
    }


