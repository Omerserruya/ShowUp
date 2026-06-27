"""Centralized authorization for core-service.

Resolves a user's effective Role for an event and enforces the shared permission
matrix. Bridges the legacy `events.owners` JSON array (treated as Role.OWNER)
during the V2 tenancy migration, so existing single-owner events keep working.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import Account, Membership, Event
from app.crud import event as event_crud
from shared.domain.roles import Role, Action, can
from shared.domain.entitlements import Feature, has_feature


def resolve_role(db: Session, event: Optional[Event], user_id: uuid.UUID) -> Optional[Role]:
    """Effective role of user on the event's account, or None if not a member."""
    if event is None:
        return None

    account_id = getattr(event, "account_id", None)
    if account_id:
        membership = (
            db.query(Membership)
            .filter(
                Membership.account_id == account_id,
                Membership.user_id == user_id,
                Membership.status == "active",
            )
            .first()
        )
        if not membership:
            return None
        try:
            return Role(membership.role)
        except ValueError:
            return None

    # Legacy bridge: pre-tenancy events use the owners JSON array.
    if event_crud.is_owner(event, user_id):
        return Role.OWNER
    return None


def require_event_permission(
    db: Session, event: Optional[Event], user_id: uuid.UUID, action: Action
) -> Role:
    """Raise unless the user may perform `action` on the event.

    404 when the user has no role at all (don't leak existence across tenants);
    403 when the user is a member but the role lacks the action.
    """
    role = resolve_role(db, event, user_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Not found")
    if not can(role, action):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return role


def require_feature(event: Optional[Event], feature: Feature) -> None:
    """Raise 403 unless the event's plan tier unlocks `feature`.

    This is the plan/tier gate (entitlements), orthogonal to the role gate in
    `require_event_permission`. Callers that need both should run the role check
    first (it returns 404 for non-members, avoiding cross-tenant existence leaks),
    then this. A None event or a legacy/None plan id is treated as fully entitled.
    """
    plan_id = getattr(event, "plan_id", None) if event is not None else None
    if not has_feature(plan_id, feature):
        raise HTTPException(
            status_code=403,
            detail=f"Your plan does not include this feature ({feature.value}). Upgrade to unlock it.",
        )


def ensure_personal_account(db: Session, user_id: uuid.UUID) -> uuid.UUID:
    """Return the user's account id, creating a personal account + OWNER membership
    on first use. This is how new V2 events get bound to an account."""
    membership = (
        db.query(Membership)
        .filter(
            Membership.user_id == user_id,
            Membership.role == Role.OWNER.value,
            Membership.status == "active",
        )
        .first()
    )
    if membership:
        return membership.account_id

    account = Account(name=None)
    db.add(account)
    db.flush()  # assign account.id
    db.add(Membership(account_id=account.id, user_id=user_id, role=Role.OWNER.value, status="active"))
    db.commit()
    return account.id
