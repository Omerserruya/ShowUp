"""Remaining-audience count for planning, in SQL.

The planner sizes each campaign from the LIVE audience instead of the stored
`campaigns.recipient_count` (which is 0/NULL for many rounds and goes stale the
moment guests are added/removed). Semantics MUST mirror
campaign-worker/audience.py (`select_guests_by_audience`) - the worker is what
actually sends, the planner only predicts how many it will send:

  * guests of the event with a non-empty phone, not opted out
  * audience everyone | confirmed | declined | no_response | custom
  * custom filter keys: status, group, tag_id, table ('none' | 'any')

"Remaining" = audience members with no messages_sent row for this campaign
(the worker's claim table), i.e. who the next batch would still message.
"""
from __future__ import annotations

import json
from typing import Optional, Tuple

try:  # the shared SSOT (present in the container: Dockerfile copies shared/)
    from shared.domain.enums import GuestStatus, CampaignAudience
    from shared.domain.optout import OPT_OUT_SQL_PREDICATE
    _CONFIRMED = sorted(GuestStatus.confirmed_values())
    _DECLINED = sorted(GuestStatus.declined_values())
    _PENDING = sorted(GuestStatus.pending_values())
    _A = {a.name: a.value for a in CampaignAudience}
except Exception:  # pragma: no cover - local tests without the repo root on sys.path
    _CONFIRMED = ["attending", "confirmed"]
    _DECLINED = ["declined"]
    _PENDING = ["invited", "pending"]
    _A = {"EVERYONE": "everyone", "CONFIRMED": "confirmed", "DECLINED": "declined",
          "NO_RESPONSE": "no_response", "CUSTOM": "custom"}
    OPT_OUT_SQL_PREDICATE = "g.opted_out_at IS NULL"


def _filter(value) -> dict:
    if not value:
        return {}
    if isinstance(value, dict):
        return value
    try:
        data = json.loads(value)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def audience_where(event_id: str, audience, audience_filter=None) -> Tuple[str, str, list]:
    """(join, where, params) selecting the campaign's audience (alias g)."""
    a = (getattr(audience, "value", audience) or "everyone")
    f = _filter(audience_filter)
    join = ""
    where = ["g.event_id = %s", "g.phone IS NOT NULL", "g.phone <> ''", OPT_OUT_SQL_PREDICATE]
    params: list = [event_id]
    status_values = None
    if a == _A["CONFIRMED"]:
        status_values = list(_CONFIRMED)
    elif a == _A["DECLINED"]:
        status_values = list(_DECLINED)
    elif a == _A["NO_RESPONSE"]:
        status_values = list(_PENDING)
        where.append("NOT EXISTS (SELECT 1 FROM guest_tags gtn JOIN tags tn ON tn.id = gtn.tag_id "
                     "WHERE gtn.guest_id = g.id AND tn.name = 'no_reminders')")
    elif a == _A["CUSTOM"]:
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
        table = f.get("table")
        if table == "none":
            where.append("g.table_number IS NULL")
        elif table == "any":
            where.append("g.table_number IS NOT NULL")
    if status_values:
        where.append(f"g.status IN ({','.join(['%s'] * len(status_values))})")
        params += status_values
    return join, " AND ".join(where), params


def remaining_audience(cur, campaign_id: str, event_id: str, audience,
                       audience_filter=None) -> Optional[int]:
    """Audience members not yet claimed by this campaign. None on error (the
    caller falls back to recipient_count); the cursor's transaction is left
    usable via a savepoint."""
    join, where, params = audience_where(event_id, audience, audience_filter)
    sql = (
        f"SELECT COUNT(DISTINCT g.id) FROM guests g {join} WHERE {where} "
        "AND NOT EXISTS (SELECT 1 FROM messages_sent m WHERE m.campaign_id = %s AND m.guest_id = g.id)"
    )
    in_tx = not getattr(cur.connection, "autocommit", True)
    try:
        if in_tx:
            cur.execute("SAVEPOINT planner_aud")
        cur.execute(sql, params + [campaign_id])
        n = int(cur.fetchone()[0])
        if in_tx:
            cur.execute("RELEASE SAVEPOINT planner_aud")
        return n
    except Exception:
        if in_tx:
            try:
                cur.execute("ROLLBACK TO SAVEPOINT planner_aud")
            except Exception:
                pass
        return None
