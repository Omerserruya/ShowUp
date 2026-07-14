"""Repository + merged view for messaging template Meta state.

Bridges the two stores: the AUTHORED catalog (shared SSOT, read-only product
content) and the MUTABLE runtime state (`messaging_template_state` DB rows). The
Admin publishing API reads the merged view and writes only the DB side.

A template key with no DB row is treated as its catalog default: the six live
anchors read as published/approved (and unchanged), drafts as draft/none.
"""
from __future__ import annotations

import datetime as dt
from typing import Dict, Optional

from sqlalchemy.orm import Session

from app.models.models import MessagingTemplateState
from shared.domain.messaging import (
    Template,
    compute_checksum,
    default_internal_status,
    default_meta_status,
    stage_variant_for_template,
)


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def get_row(db: Session, key: str) -> Optional[MessagingTemplateState]:
    return db.get(MessagingTemplateState, key)


def get_row_map(db: Session) -> Dict[str, MessagingTemplateState]:
    return {r.template_key: r for r in db.query(MessagingTemplateState).all()}


def upsert(db: Session, key: str, **fields) -> MessagingTemplateState:
    """Insert or update a state row and flush. Caller controls commit."""
    row = db.get(MessagingTemplateState, key)
    if row is None:
        row = MessagingTemplateState(template_key=key)
        db.add(row)
    for k, v in fields.items():
        setattr(row, k, v)
    db.flush()
    return row


def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def effective(template: Template, row: Optional[MessagingTemplateState]) -> dict:
    """Resolve the runtime state for a template, filling catalog defaults when no
    DB row exists. Returns the merged management view (the unified `meta:` block
    the Admin API exposes) plus change-detection fields."""
    live_checksum = compute_checksum(template)
    mc = template.meta_config

    if row is not None:
        internal_status = row.internal_status
        meta_status = row.meta_status
        meta_id = row.meta_id
        meta_category = row.meta_category or (mc.category if mc else None)
        uploaded_at = _iso(row.uploaded_at)
        last_sync = _iso(row.last_sync)
        rejection_reason = row.rejection_reason
        published_checksum = row.published_checksum
        published_version = row.published_version
    else:
        internal_status = default_internal_status(template).value
        meta_status = default_meta_status(template).value
        meta_id = None
        meta_category = mc.category if mc else None
        uploaded_at = None
        last_sync = None
        rejection_reason = None
        # Anchors are already live → treat as published-at-current (not "changed");
        # drafts have never been published → None (always "changed"/new).
        published_checksum = live_checksum if template.is_usable else None
        published_version = template.version if template.is_usable else 0

    changed = published_checksum != live_checksum
    sv = stage_variant_for_template(template.key)

    return {
        "key": template.key,
        "stage": template.flow_stage.value,
        "variant": sv[1] if sv else None,
        "channel": template.channel,           # whatsapp only
        "category": template.category.value,   # structural (text_only/with_image/…)
        "lifecycle": template.lifecycle,        # messaging-engine gating (unchanged)
        "internal_status": internal_status,
        "content_checksum": live_checksum,
        "changed": changed,
        "authored_version": template.version,
        "published_version": published_version,
        "published_checksum": published_checksum,
        "meta": {
            "id": meta_id,
            "name": (mc.name if mc else None) or template.key,
            "language": (mc.language if mc else None) or template.language,
            "category": meta_category,
            "status": meta_status,
            "uploaded_at": uploaded_at,
            "last_sync": last_sync,
            "rejection_reason": rejection_reason,
        },
    }
