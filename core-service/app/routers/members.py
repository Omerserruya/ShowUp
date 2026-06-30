"""Team / membership management (per-account RBAC).

Exposes the existing Account/Membership tenancy so an owner can see and manage
their event team. Scoped by event_id (the event's account) so any account member
- not just the personal-account owner - can be managed. Invite-by-phone resolves
the user via aub-service (users live there, not here).
"""
from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud
from app.models.models import Membership
from app.authz import require_event_permission
from app.user_directory import resolve_user_id_by_phone, resolve_users_by_ids
from shared.auth.deps import get_current_user_id
from shared.domain.roles import Role, Action, can

router = APIRouter(tags=["members"])

# Owner is never assignable via invite/role-change (no ownership transfer here).
ASSIGNABLE = {Role.MANAGER, Role.EDITOR, Role.VIEWER, Role.GUEST_COORDINATOR}


class MemberOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    role: str
    status: str
    is_self: bool = False
    name: Optional[str] = None
    phone: Optional[str] = None


class InviteIn(BaseModel):
    event_id: uuid.UUID
    phone: str
    role: Role


class RoleIn(BaseModel):
    role: Role


def _account_role(db: Session, account_id, user_id) -> Optional[Role]:
    m = (
        db.query(Membership)
        .filter(
            Membership.account_id == account_id,
            Membership.user_id == user_id,
            Membership.status == "active",
        )
        .first()
    )
    if not m:
        return None
    try:
        return Role(m.role)
    except ValueError:
        return None


def _require_member_manage(db: Session, account_id, user_id) -> Role:
    role = _account_role(db, account_id, user_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Not found")
    if not can(role, Action.MEMBER_MANAGE):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return role


@router.get("/members", response_model=List[MemberOut])
def list_members(
    event_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    event = event_crud.get_event(db, event_id)
    require_event_permission(db, event, user_id, Action.EVENT_READ)
    account_id = getattr(event, "account_id", None)
    if not account_id:
        return []  # legacy event with no account -> no team concept
    members = db.query(Membership).filter(Membership.account_id == account_id).all()
    directory = resolve_users_by_ids([m.user_id for m in members])
    out: List[MemberOut] = []
    for m in members:
        info = directory.get(str(m.user_id), {})
        name = (f"{info.get('first_name', '')} {info.get('last_name', '')}".strip() or None) if info else None
        out.append(
            MemberOut(
                id=m.id, user_id=m.user_id, role=m.role, status=m.status,
                is_self=(m.user_id == user_id), name=name, phone=info.get("phone"),
            )
        )
    return out


@router.post("/members/invite", response_model=MemberOut, status_code=201)
def invite_member(
    payload: InviteIn,
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    event = event_crud.get_event(db, payload.event_id)
    require_event_permission(db, event, user_id, Action.MEMBER_MANAGE)
    account_id = getattr(event, "account_id", None)
    if not account_id:
        raise HTTPException(status_code=400, detail="event_not_migrated")
    if payload.role not in ASSIGNABLE:
        raise HTTPException(status_code=400, detail="role_not_assignable")
    info = resolve_user_id_by_phone(payload.phone)
    if not info:
        raise HTTPException(status_code=404, detail="user_not_registered")
    invited = uuid.UUID(info["user_id"])
    existing = (
        db.query(Membership)
        .filter(Membership.account_id == account_id, Membership.user_id == invited)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="already_member")
    m = Membership(account_id=account_id, user_id=invited, role=payload.role.value, status="active")
    db.add(m)
    db.commit()
    db.refresh(m)
    name = f"{info.get('first_name', '')} {info.get('last_name', '')}".strip() or None
    return MemberOut(id=m.id, user_id=m.user_id, role=m.role, status=m.status, is_self=False, name=name, phone=info.get("phone"))


@router.put("/members/{membership_id}", response_model=MemberOut)
def update_member(
    membership_id: uuid.UUID,
    payload: RoleIn,
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    m = db.query(Membership).filter(Membership.id == membership_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Not found")
    _require_member_manage(db, m.account_id, user_id)
    if m.role == Role.OWNER.value:
        raise HTTPException(status_code=400, detail="cannot_modify_owner")
    if payload.role not in ASSIGNABLE:
        raise HTTPException(status_code=400, detail="role_not_assignable")
    m.role = payload.role.value
    db.commit()
    db.refresh(m)
    return MemberOut(id=m.id, user_id=m.user_id, role=m.role, status=m.status, is_self=(m.user_id == user_id))


@router.delete("/members/{membership_id}", status_code=204)
def remove_member(
    membership_id: uuid.UUID,
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    m = db.query(Membership).filter(Membership.id == membership_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Not found")
    _require_member_manage(db, m.account_id, user_id)
    if m.role == Role.OWNER.value:
        raise HTTPException(status_code=400, detail="cannot_remove_owner")
    db.delete(m)
    db.commit()
    return None
