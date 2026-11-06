"""Where a template sits, and what replaced it.

* Placement: an admin can move a template FAMILY (a catalog template and all its
  per-event-type variants, e.g. `final_reminder_gentle` + `..__wedding`, or one
  Studio template `custom__x`) into any round category. The category's base stage
  becomes the template's EFFECTIVE stage: where it is offered on the timeline and
  which categories (audiences) a round using it may pick.
* Replacement: a built-in template is edited by copying it into the Template
  Studio with `replaces = <family>`. Once Meta approves the copy it stands in for
  the original everywhere - pickers offer the copy, and rounds already scheduled
  with the original send the copy (campaign-worker does the same lookup).
"""
from __future__ import annotations

from typing import Dict, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session


def family(template_ref: Optional[str]) -> str:
    ref = (template_ref or "").strip()
    if ref.startswith("custom__"):
        return ref
    return ref.split("__", 1)[0]


def placements(db: Session) -> Dict[str, str]:
    """family -> category_id"""
    try:
        return {r[0]: r[1] for r in db.execute(text("SELECT template_family, category_id FROM template_placements"))}
    except Exception:
        db.rollback()
        return {}


def replacements(db: Session) -> Dict[str, Dict]:
    """catalog family -> {ref, event_types} of its Meta-approved Studio copy."""
    try:
        rows = db.execute(text(
            "SELECT key, live->'doc'->>'replaces' AS fam, live->'doc'->'event_types' AS ets "
            "FROM custom_templates WHERE NOT archived AND live->>'status' = 'approved' "
            "AND COALESCE(live->'doc'->>'replaces', '') <> ''")).fetchall()
    except Exception:
        db.rollback()
        return {}
    return {r[1]: {"ref": f"custom__{r[0]}", "event_types": list(r[2] or [])} for r in rows}


def set_placement(db: Session, template_ref: str, category_id: Optional[str]) -> None:
    """Move a template family into a category (None = back to its own stage). Caller commits."""
    fam = family(template_ref)
    if category_id:
        db.execute(text(
            "INSERT INTO template_placements (template_family, category_id) VALUES (:f, :c) "
            "ON CONFLICT (template_family) DO UPDATE SET category_id = EXCLUDED.category_id, updated_at = now()"),
            {"f": fam, "c": category_id})
    else:
        db.execute(text("DELETE FROM template_placements WHERE template_family = :f"), {"f": fam})


def placed_category(db: Session, template_ref: Optional[str]) -> Optional[str]:
    """The category a template was moved into - its replacement inherits the
    original's place - or None when it sits in its own stage."""
    pl = placements(db)
    fam = family(template_ref)
    if fam in pl:
        return pl[fam]
    if fam.startswith("custom__"):
        try:
            orig = db.execute(text("SELECT COALESCE(live->'doc'->>'replaces', doc->>'replaces') FROM custom_templates "
                                   "WHERE key = :k"), {"k": fam[len("custom__"):]}).scalar()
        except Exception:
            db.rollback()
            orig = None
        if orig and orig in pl:
            return pl[orig]
    return None


def own_stage(db: Session, template_ref: Optional[str]) -> Optional[str]:
    """The template's catalog stage; an event-type variant (`x__wedding`) the
    stage resolver does not know falls back to its family."""
    from app.crud.campaign import campaign_stage
    return campaign_stage(db, template_ref) or (campaign_stage(db, family(template_ref)) if template_ref else None)


def effective_stage(db: Session, template_ref: Optional[str], own_stage: Optional[str]) -> Optional[str]:
    cat_id = placed_category(db, template_ref)
    if cat_id:
        from app.round_categories import get_category
        cat = get_category(db, cat_id)
        if cat:
            return cat["base_stage"]
    return own_stage
