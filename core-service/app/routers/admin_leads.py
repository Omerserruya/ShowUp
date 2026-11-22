"""Admin "פניות": everyone who asked the landing page for a sample WhatsApp
message or a sample call (shared/domain/leads.py), with whether they went on
to sign up / open an event. One row per phone, newest first."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from shared.auth.admin import get_admin_user_id

router = APIRouter(prefix="/admin/leads", tags=["admin"])

_SQL = text("""
WITH l AS (
    SELECT phone,
           max(created_at) AS last_at, min(created_at) AS first_at, count(*) AS requests,
           (array_agg(name ORDER BY created_at DESC) FILTER (WHERE name IS NOT NULL))[1] AS name,
           array_agg(DISTINCT kind) AS kinds
    FROM demo_leads
    WHERE created_at > now() - make_interval(days => :days)
    GROUP BY phone
)
SELECT l.*, u.id AS user_id, u.created_at AS signed_up_at,
       (SELECT count(*) FROM events e WHERE u.id IS NOT NULL AND e.owners::jsonb ? u.id::text) AS events
FROM l
LEFT JOIN users u ON right(regexp_replace(u.phone, '\\D', '', 'g'), 9) = right(regexp_replace(l.phone, '\\D', '', 'g'), 9)
ORDER BY l.last_at DESC
""")


@router.get("")
def list_leads(days: int = Query(90, ge=1, le=3650), db: Session = Depends(get_db),
               admin_id: uuid.UUID = Depends(get_admin_user_id)):
    from shared.domain.leads import CREATE_SQL
    db.execute(text(CREATE_SQL))
    rows = db.execute(_SQL, {"days": days}).mappings().all()
    leads = [{
        "phone": r["phone"], "name": r["name"], "kinds": sorted(r["kinds"] or []),
        "requests": r["requests"], "first_at": r["first_at"].isoformat(), "last_at": r["last_at"].isoformat(),
        "signed_up": r["user_id"] is not None, "events": int(r["events"] or 0),
    } for r in rows]
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    return {"leads": leads, "total": len(leads), "new_7d": sum(1 for r in rows if r["first_at"] >= week_ago)}
