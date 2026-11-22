"""Campaign audience resolution (Phase 6).

Translates a campaign's audience (+ optional custom filter) into a guest query.
This is the single place audience selection lives - decoupled from templates.
Custom filter supported keys: status (list), group (str), tag_id (uuid),
tag_name (str), table ('none' -> no table assigned, 'any' -> has a table),
skip_no_reminders (bool). The round-category audiences
(shared/domain/round_categories.py) are built from these. campaign-worker's
audience.py must understand exactly the same keys with the same semantics - a
key only one side knows silently widens the send.

Guests without a phone are excluded, exactly like the worker's selection: this
count is quoted to the owner and persisted as the campaign's recipient_count
(the planner sizes its releases from it), so it must equal what will be sent.
"""
from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy.orm import Session, Query

from app.models.models import Guest, GuestTag, Tag
from shared.domain.enums import GuestStatus, CampaignAudience


def _audience_value(audience) -> str:
    return audience.value if isinstance(audience, CampaignAudience) else str(audience or "everyone")


def apply_audience(query: Query, audience, audience_filter: Optional[dict]) -> Query:
    a = _audience_value(audience)
    # Opted-out guests are excluded from EVERY audience, including 'everyone'.
    # Applied before the audience branch so no branch can forget it - this count
    # is what the owner is quoted for an extra round, so it must match what
    # campaign-worker will actually send.
    query = query.filter(Guest.opted_out_at.is_(None))
    query = query.filter(Guest.phone.isnot(None), Guest.phone != "")
    if a == CampaignAudience.EVERYONE.value:
        return query
    if a == CampaignAudience.CONFIRMED.value:
        return query.filter(Guest.status.in_(list(GuestStatus.confirmed_values())))
    if a == CampaignAudience.DECLINED.value:
        return query.filter(Guest.status.in_(list(GuestStatus.declined_values())))
    if a == CampaignAudience.NO_RESPONSE.value:
        # Reminders skip guests the conversation flow tagged 'no_reminders'
        # (flow-graph action stop_reminders). Same rule in campaign-worker.
        no_rem = (GuestTag.__table__.join(Tag.__table__, Tag.id == GuestTag.tag_id))
        from sqlalchemy import exists, and_
        return query.filter(Guest.status.in_(list(GuestStatus.pending_values()))).filter(
            ~exists().select_from(no_rem).where(and_(GuestTag.guest_id == Guest.id, Tag.name == NO_REMINDERS_TAG)))
    if a == CampaignAudience.CUSTOM.value:
        return _apply_custom(query, audience_filter or {})
    return query


def _apply_custom(query: Query, f: dict) -> Query:
    statuses = f.get("status")
    if statuses:
        if isinstance(statuses, str):
            statuses = [statuses]
        query = query.filter(Guest.status.in_(statuses))
    group = f.get("group")
    if group:
        query = query.filter(Guest.group == group)
    tag_id = f.get("tag_id")
    if tag_id:
        query = query.join(GuestTag, GuestTag.guest_id == Guest.id).filter(GuestTag.tag_id == tag_id)
    tag_name = f.get("tag_name")
    if tag_name:
        from sqlalchemy import exists, and_
        tagged = GuestTag.__table__.join(Tag.__table__, Tag.id == GuestTag.tag_id)
        query = query.filter(exists().select_from(tagged).where(
            and_(GuestTag.guest_id == Guest.id, Tag.name == tag_name)))
    if f.get("skip_no_reminders"):
        from sqlalchemy import exists, and_
        no_rem = GuestTag.__table__.join(Tag.__table__, Tag.id == GuestTag.tag_id)
        query = query.filter(~exists().select_from(no_rem).where(
            and_(GuestTag.guest_id == Guest.id, Tag.name == NO_REMINDERS_TAG)))
    table = f.get("table")
    if table == "none":
        query = query.filter(Guest.table_number.is_(None))
    elif table == "any":
        query = query.filter(Guest.table_number.isnot(None))
    return query


# Keys both audience resolvers (this module + campaign-worker/audience.py)
# understand. Anything else in a custom filter is ignored by them.
NO_REMINDERS_TAG = "no_reminders"

SUPPORTED_FILTER_KEYS = frozenset({"status", "group", "tag_id", "tag_name", "table", "skip_no_reminders"})


def count_audience(db: Session, event_id, audience, audience_filter: Optional[dict] = None) -> int:
    query = db.query(Guest).filter(Guest.event_id == str(event_id))
    return apply_audience(query, audience, audience_filter).count()
