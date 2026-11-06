"""Round categories in core: storage + applying a category to rounds.

The dictionary (audiences, built-ins) lives in shared/domain/round_categories.py.
Here: read the admin-managed rows, give every template round a category, copy
the category's audience onto the round, and re-apply it to every not-yet-sent
round when an admin edits the category.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from shared.domain.round_categories import audience_pair, describe

logger = logging.getLogger(__name__)

# Rounds whose audience still matters (not sent / not sending).
OPEN_STATUSES = ("pending", "draft", "paused")


def _row(r) -> Dict:
    d = dict(r._mapping)
    d["audience_label"] = describe(d.get("audience"), d.get("audience_param"))
    return d


def list_categories(db: Session, include_archived: bool = False) -> List[Dict]:
    q = "SELECT * FROM round_categories" + ("" if include_archived else " WHERE NOT archived")
    try:
        return [_row(r) for r in db.execute(text(q + " ORDER BY sort_order, title"))]
    except Exception:  # table not migrated yet
        db.rollback()
        return []


def get_category(db: Session, category_id: Optional[str]) -> Optional[Dict]:
    if not category_id:
        return None
    try:
        r = db.execute(text("SELECT * FROM round_categories WHERE id = :id"), {"id": category_id}).first()
    except Exception:
        db.rollback()
        return None
    return _row(r) if r else None


def category_for(db: Session, requested: Optional[str], stage: Optional[str],
                 default_id: Optional[str] = None) -> Optional[Dict]:
    """The category a round gets: the requested one when it exists, is active
    and fits the template's (effective) stage; else `default_id` (the category
    the template was moved into) or the built-in category of that stage."""
    cat = get_category(db, requested)
    if cat and not cat["archived"] and (stage is None or cat["base_stage"] == stage):
        return cat
    if requested and cat is None:
        raise ValueError("קטגוריה לא קיימת")
    if cat and stage is not None and cat["base_stage"] != stage:
        raise ValueError("הקטגוריה לא מתאימה לתבנית שנבחרה")
    fallback = get_category(db, default_id) if default_id else None
    if fallback and not fallback["archived"]:
        return fallback
    return get_category(db, stage) if stage else None


def pair_of(cat: Dict):
    return audience_pair(cat["audience"], cat.get("audience_param"))


def sync_category(db: Session, cat: Dict) -> int:
    """Re-apply the category's audience to its not-yet-sent rounds. Caller commits."""
    from app.models.models import Campaign
    from app.crud.campaign import _recipient_count
    aud, flt = pair_of(cat)
    rows = (db.query(Campaign)
            .filter(Campaign.category_id == cat["id"], Campaign.status.in_(OPEN_STATUSES)).all())
    for c in rows:
        c.audience, c.audience_filter = aud, flt
        c.recipient_count = _recipient_count(db, c.event_id, aud, flt)
        db.add(c)
    if rows:
        logger.info("category %s: audience re-applied to %d open round(s)", cat["id"], len(rows))
    return len(rows)
