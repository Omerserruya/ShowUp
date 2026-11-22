"""The owners' mobile app registers its Firebase push token here after login
(shared/domain/push.py has the tables and the sender)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from shared.auth.deps import get_current_user_id
from shared.domain import push

router = APIRouter(prefix="/push", tags=["push"])


class DeviceIn(BaseModel):
    token: str = Field(..., min_length=20, max_length=4096)
    platform: str = Field(default="android", pattern="^(android|ios)$")


@router.post("/devices", status_code=204)
def register(body: DeviceIn, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    with db.connection().connection.cursor() as cur:
        push.register_device(cur, str(user_id), body.token, body.platform)
    db.commit()


@router.post("/devices/remove", status_code=204)
def unregister(body: DeviceIn, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    """On logout: this phone stops getting this account's notifications."""
    with db.connection().connection.cursor() as cur:
        if _exists(cur):
            cur.execute("DELETE FROM push_devices WHERE token = %s AND user_id = %s", (body.token, str(user_id)))
    db.commit()


@router.post("/test")
def send_test(db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    """"Send me a test notification" (app profile). Queued like any push, so the
    scheduler delivers it within a cycle (~30s). At most one per minute."""
    import time
    with db.connection().connection.cursor() as cur:
        queued = push.queue_push(
            cur, [str(user_id)], "ההתראות פועלות ✅", "כך תקבלו עדכון בכל פעם שאורח עונה.",
            url="/overview", dedupe_key=f"test:{int(time.time() // 60)}")
    db.commit()
    return {"queued": queued}


def _exists(cur) -> bool:
    cur.execute("SELECT to_regclass('public.push_devices') IS NOT NULL")
    return bool(cur.fetchone()[0])
