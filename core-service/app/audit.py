"""Audit recording helper (Phase 11)."""
from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import AuditLog
from shared.domain.enums import ActorType


def record_audit(
    db: Session,
    *,
    account_id=None,
    actor_type: ActorType,
    actor_id: Optional[uuid.UUID] = None,
    action: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[uuid.UUID] = None,
    data: Optional[dict] = None,
    commit: bool = True,
) -> AuditLog:
    entry = AuditLog(
        account_id=account_id,
        actor_type=actor_type.value if isinstance(actor_type, ActorType) else str(actor_type),
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        data=data,
    )
    db.add(entry)
    if commit:
        db.commit()
        db.refresh(entry)
    return entry
