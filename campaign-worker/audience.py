"""Audience selection for campaign sends (Phase 6).

Decoupled from templates: a campaign carries its own audience, and this module
turns that into the guest list. Mirrors core-service/app/audience.py but in raw
SQL (this worker uses psycopg2). Status values come from the shared SSOT.
"""
from __future__ import annotations

from typing import Optional, Sequence

import psycopg2.extras

from shared.domain.enums import GuestStatus, CampaignAudience


def select_guests_by_audience(conn, event_id: str, audience, audience_filter: Optional[dict] = None) -> Sequence[dict]:
    a = audience.value if hasattr(audience, "value") else (audience or "everyone")
    f = audience_filter or {}

    join = ""
    where = ["g.event_id = %s", "g.phone IS NOT NULL", "g.phone <> ''"]
    params = [event_id]
    status_values = None

    if a == CampaignAudience.CONFIRMED.value:
        status_values = list(GuestStatus.confirmed_values())
    elif a == CampaignAudience.DECLINED.value:
        status_values = list(GuestStatus.declined_values())
    elif a == CampaignAudience.NO_RESPONSE.value:
        status_values = list(GuestStatus.pending_values())
    elif a == CampaignAudience.CUSTOM.value:
        cstat = f.get("status")
        if cstat:
            status_values = [cstat] if isinstance(cstat, str) else list(cstat)
        if f.get("group"):
            where.append("g.guest_group = %s")
            params.append(f["group"])
        if f.get("tag_id"):
            join = "JOIN guest_tags gt ON gt.guest_id = g.id"
            where.append("gt.tag_id = %s")
            params.append(f["tag_id"])
    # 'everyone' (and unknown) -> no status filter

    if status_values:
        placeholders = ",".join(["%s"] * len(status_values))
        where.append(f"g.status IN ({placeholders})")
        params += status_values

    sql = (
        "SELECT g.id, g.name, g.phone, g.email, g.status, g.guest_count, g.table_number "
        f"FROM guests g {join} WHERE {' AND '.join(where)}"
    )
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        return cur.fetchall()
