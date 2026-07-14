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
        if membership:
            try:
                return Role(membership.role)
            except ValueError:
                pass
        # Owners-array bridge: the event's own `owners` array always grants OWNER
        # on THAT specific event, even when the event is bound to an account. This
        # is what makes the B2B2C venue model safe - a venue Account owns many
        # events, each owned by a different couple; account membership (held by
        # the venue admin) grants access across all of them, while each couple is
        # isolated to their own event via the owners array. Also the legacy bridge
        # for pre-tenancy single-owner events.
        if event_crud.is_owner(event, user_id):
            return Role.OWNER
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
