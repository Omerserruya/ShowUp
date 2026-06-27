"""Campaign audience resolution (Phase 6).

Translates a campaign's audience (+ optional custom filter) into a guest query.
This is the single place audience selection lives — decoupled from templates.
Custom filter supported keys: status (list), group (str), tag_id (uuid).
"""
from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy.orm import Session, Query

from app.models.models import Guest, GuestTag
from shared.domain.enums import GuestStatus, CampaignAudience


def _audience_value(audience) -> str:
    return audience.value if isinstance(audience, CampaignAudience) else str(audience or "everyone")


def apply_audience(query: Query, audience, audience_filter: Optional[dict]) -> Query:
    a = _audience_value(audience)
    if a == CampaignAudience.EVERYONE.value:
        return query
    if a == CampaignAudience.CONFIRMED.value:
        return query.filter(Guest.status.in_(list(GuestStatus.confirmed_values())))
    if a == CampaignAudience.DECLINED.value:
        return query.filter(Guest.status.in_(list(GuestStatus.declined_values())))
    if a == CampaignAudience.NO_RESPONSE.value:
        return query.filter(Guest.status.in_(list(GuestStatus.pending_values())))
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
    return query


def count_audience(db: Session, event_id, audience, audience_filter: Optional[dict] = None) -> int:
    query = db.query(Guest).filter(Guest.event_id == str(event_id))
    return apply_audience(query, audience, audience_filter).count()
