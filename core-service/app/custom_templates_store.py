"""DB access for admin-authored WhatsApp templates (`custom_templates`, see
migrations.ensure_custom_templates). Shared by the admin router, the public
catalog (approved guest-stage templates become offerable) and every campaign
`db_lookup` (so a `custom__<key>` ref resolves the same way in core-service as in
campaign-worker). Pure domain rules live in shared/domain/messaging/custom_templates.py.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from shared.domain.messaging import custom_templates as ct

logger = logging.getLogger(__name__)

COLUMNS = ("key, doc, meta_name, meta_id, meta_status, rejection_reason, submitted_doc, submitted_at, "
           "live, version, archived, last_sync, created_at, updated_at, created_by, updated_by")


def _row_dict(r: Any) -> Dict[str, Any]:
    d = dict(r._mapping) if hasattr(r, "_mapping") else dict(r)
    for k in ("doc", "submitted_doc", "live"):
        d[k] = ct.coerce_json(d.get(k))
    return d


def get_row(db: Session, key: str) -> Optional[Dict[str, Any]]:
    r = db.execute(text(f"SELECT {COLUMNS} FROM custom_templates WHERE key = :k"), {"k": key}).first()
    return _row_dict(r) if r else None


def list_rows(db: Session, *, include_archived: bool = True) -> List[Dict[str, Any]]:
    sql = f"SELECT {COLUMNS} FROM custom_templates"
    if not include_archived:
        sql += " WHERE NOT archived"
    sql += " ORDER BY updated_at DESC"
    return [_row_dict(r) for r in db.execute(text(sql)).fetchall()]


def custom_template_row(db: Session, ref: Any) -> Optional[Dict[str, Any]]:
    """db_lookup for resolve_template: the row for a `custom__<key>` ref, or None.
    Never raises (a missing table on an un-migrated DB just means "not found")."""
    if not ct.is_custom_ref(ref):
        return None
    try:
        return get_row(db, ct.key_from_ref(str(ref)))
    except Exception:
        db.rollback()
        return None


def approved_guest_catalog_rows(db: Session) -> List[Dict[str, Any]]:
    """Non-archived rows whose LIVE version is approved and in a guest stage."""
    try:
        rows = db.execute(text(
            f"SELECT {COLUMNS} FROM custom_templates WHERE NOT archived "
            "AND live IS NOT NULL AND live->>'status' = 'approved'"
        )).fetchall()
    except Exception:
        db.rollback()
        return []
    out = []
    for r in rows:
        d = _row_dict(r)
        live = ct.live_of(d)
        if live and ct.normalize_doc(live.get("doc"))["group"] in ct.GUEST_GROUPS:
            out.append(d)
    return out
