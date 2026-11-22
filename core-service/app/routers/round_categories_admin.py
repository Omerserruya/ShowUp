"""Admin: round categories (shared/domain/round_categories.py).

- GET  /admin/messaging/round-categories        every category + the audience dictionary
- POST /admin/messaging/round-categories        new category {title, description, base_stage, audience, audience_param}
- PUT  /admin/messaging/round-categories/{id}   edit; the audience is re-applied to its not-yet-sent rounds

Built-in categories (one per stage) can be renamed and re-targeted but not
archived or moved to another stage.
"""
from __future__ import annotations

import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import record_audit
from app.db import get_db
from app.round_categories import get_category, list_categories, sync_category
from shared.auth.admin import get_admin_user_id
from shared.domain.enums import ActorType
from shared.domain.round_categories import AUDIENCES, STAGE_KIND_HE, STAGES, validate

router = APIRouter(prefix="/admin/messaging/round-categories", tags=["round-categories"])


class CategoryIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=80)
    description: str = Field("", max_length=400)
    base_stage: Optional[str] = None
    audience: str
    audience_param: Optional[str] = Field(None, max_length=100)
    sort_order: Optional[int] = None
    archived: Optional[bool] = None


def _audit(db, admin_id, action, data):
    record_audit(db, actor_type=ActorType.USER, actor_id=admin_id, action=f"round_category.{action}",
                 entity_type="round_category", data=data, commit=False)


@router.get("")
def list_all(db: Session = Depends(get_db), admin_id: uuid.UUID = Depends(get_admin_user_id)):
    counts = {r[0]: r[1] for r in db.execute(text(
        "SELECT category_id, count(*) FROM campaigns WHERE status IN ('pending','draft','paused') "
        "AND category_id IS NOT NULL GROUP BY 1"))}
    cats = list_categories(db, include_archived=True)
    for c in cats:
        c["open_rounds"] = counts.get(c["id"], 0)
        c["kind_he"] = STAGE_KIND_HE.get(c["base_stage"], c["base_stage"])
    return {
        "categories": cats,
        "audiences": [{"key": a.key, "label": a.label_he, "hint": a.hint_he, "param": a.param}
                      for a in AUDIENCES.values()],
        "stages": [{"id": s, "label": STAGE_KIND_HE[s]} for s in STAGES],
    }


def _slug(title: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")[:30] or "cat"
    return f"{base}_{uuid.uuid4().hex[:6]}"


@router.post("", status_code=201)
def create(payload: CategoryIn, db: Session = Depends(get_db), admin_id: uuid.UUID = Depends(get_admin_user_id)):
    err = validate(payload.audience, payload.audience_param, payload.base_stage or "")
    if err:
        raise HTTPException(422, err)
    cid = _slug(payload.title)
    db.execute(text(
        "INSERT INTO round_categories (id, base_stage, title, description, audience, audience_param, sort_order) "
        "VALUES (:id, :st, :t, :d, :a, :p, :o)"),
        {"id": cid, "st": payload.base_stage, "t": payload.title.strip(), "d": payload.description.strip(),
         "a": payload.audience, "p": (payload.audience_param or "").strip() or None,
         "o": payload.sort_order if payload.sort_order is not None else 500})
    _audit(db, admin_id, "create", {"id": cid, "audience": payload.audience})
    db.commit()
    return get_category(db, cid)


@router.put("/{category_id}")
def update(category_id: str, payload: CategoryIn, db: Session = Depends(get_db),
           admin_id: uuid.UUID = Depends(get_admin_user_id)):
    cur = get_category(db, category_id)
    if cur is None:
        raise HTTPException(404, "הקטגוריה לא נמצאה")
    base_stage = cur["base_stage"] if cur["builtin"] or not payload.base_stage else payload.base_stage
    err = validate(payload.audience, payload.audience_param, base_stage)
    if err:
        raise HTTPException(422, err)
    if cur["builtin"] and payload.archived:
        raise HTTPException(422, "אי אפשר להסתיר קטגוריה מובנית")
    if base_stage != cur["base_stage"] and db.execute(text(
            "SELECT 1 FROM campaigns WHERE category_id = :id AND status IN ('pending','draft','paused') LIMIT 1"),
            {"id": category_id}).first():
        raise HTTPException(422, "יש סבבים פתוחים בקטגוריה - אי אפשר לשנות את הסוג")
    db.execute(text(
        "UPDATE round_categories SET title = :t, description = :d, base_stage = :st, audience = :a, "
        "audience_param = :p, sort_order = COALESCE(:o, sort_order), archived = COALESCE(:ar, archived), "
        "updated_at = now() WHERE id = :id"),
        {"id": category_id, "t": payload.title.strip(), "d": payload.description.strip(), "st": base_stage,
         "a": payload.audience, "p": (payload.audience_param or "").strip() or None,
         "o": payload.sort_order, "ar": payload.archived})
    cat = get_category(db, category_id)
    synced = sync_category(db, cat)
    _audit(db, admin_id, "update", {"id": category_id, "audience": payload.audience, "synced_rounds": synced})
    db.commit()
    return {**get_category(db, category_id), "synced_rounds": synced}


# ---- moving templates between categories --------------------------------------

placements_router = APIRouter(prefix="/admin/messaging/template-placements", tags=["round-categories"])


class PlacementIn(BaseModel):
    template: str = Field(..., min_length=1, max_length=120)
    category_id: Optional[str] = Field(None, max_length=60)   # None -> back to its own stage


@placements_router.put("")
def move_template(payload: PlacementIn, db: Session = Depends(get_db),
                  admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Move a template family into a category. Its not-yet-sent rounds follow:
    they take the new category and its audience."""
    from app.models.models import Campaign
    from app.crud.campaign import _recipient_count
    from app.template_placement import own_stage
    from app.round_categories import OPEN_STATUSES, pair_of
    from app.template_placement import family, set_placement
    cat = get_category(db, payload.category_id) if payload.category_id else None
    if payload.category_id and (cat is None or cat["archived"]):
        raise HTTPException(422, "קטגוריה לא קיימת")
    fam = family(payload.template)
    set_placement(db, fam, payload.category_id)
    like = fam if fam.startswith("custom__") else f"{fam}%"
    rows = (db.query(Campaign)
            .filter(Campaign.template.like(like), Campaign.status.in_(OPEN_STATUSES)).all())
    moved = 0
    for c in rows:
        if family(c.template) != fam:
            continue
        target = cat or get_category(db, own_stage(db, c.template))
        if not target:
            continue
        aud, flt = pair_of(target)
        c.category_id, c.audience, c.audience_filter = target["id"], aud, flt
        c.recipient_count = _recipient_count(db, c.event_id, aud, flt)
        db.add(c)
        moved += 1
    _audit(db, admin_id, "move_template", {"template": fam, "category": payload.category_id, "rounds": moved})
    db.commit()
    return {"template": fam, "category_id": payload.category_id, "moved_rounds": moved}
