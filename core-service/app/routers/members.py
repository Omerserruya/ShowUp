"""Team / membership management (per-account RBAC).

Exposes the existing Account/Membership tenancy so an owner can see and manage
their event team. Scoped by event_id (the event's account) so any account member
- not just the personal-account owner - can be managed.

Invitations do NOT require the invitee to already have an account: a registered
phone becomes an active Membership immediately; an unregistered phone becomes a
PENDING row in `team_invitations`, claimed automatically on the invitee's first
sign-in (aub's verify-otp calls /internal/team-invites/claim). Either way the
invitee gets a WhatsApp invite via the owner-notifications outbox - the inviter
never needs to know whether the user exists.
"""
from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud
from app.models.models import Membership
from app.authz import require_event_permission
from app.notifications import queue_owner_notification
from app.user_directory import resolve_user_id_by_phone, resolve_users_by_ids
from app.utils import normalize_phone
from shared.auth.deps import get_current_user_id
from shared.domain.roles import Role, Action, can

router = APIRouter(tags=["members"])

# Owner is never assignable via invite/role-change (no ownership transfer here).
ASSIGNABLE = {Role.MANAGER, Role.EDITOR, Role.VIEWER, Role.GUEST_COORDINATOR}

# Hebrew role labels for the WhatsApp invite ({{3}} in the team_invite template).
ROLE_LABELS_HE = {
    Role.MANAGER: "ניהול מלא",
    Role.EDITOR: "שותף/ה לתכנון",
    Role.VIEWER: "צפייה",
    Role.GUEST_COORDINATOR: "ריכוז אורחים",
}


def _canonical_invite_phone(phone: str) -> str:
    """Canonical E.164 (+972...) - MUST match aub's user-table canonicalization
    so a pending invitation matches the user row created at first sign-in."""
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0"):
        digits = "972" + digits[1:]
    elif len(digits) == 9:
        digits = "972" + digits
    return ("+" + digits) if digits else normalize_phone(phone or "")


def _queue_invite_message(db: Session, *, phone: str, inviter_name: str,
                          event, role: Role) -> None:
    queue_owner_notification(
        db,
        kind="team_invite",
        recipient_phone=phone,
        event_id=getattr(event, "id", None),
        params={
            "1": inviter_name or "חבר/ת צוות",
            "2": getattr(event, "name", "") or "האירוע",
            "3": ROLE_LABELS_HE.get(role, role.value),
        },
        # One invite message per (account, phone) - re-inviting doesn't re-spam.
        dedupe_key=f"team_invite:{getattr(event, 'account_id', '')}:{phone}",
        commit=False,  # committed together with the membership/invitation row
    )


class MemberOut(BaseModel):
    id: uuid.UUID
    # None for a pending invitation (the invitee has no account yet).
    user_id: Optional[uuid.UUID] = None
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
    # Pending invitations (invitee hasn't signed in yet) render as team rows too.
    pending = db.execute(
        text("SELECT id, phone, role FROM team_invitations WHERE account_id = :a AND status = 'pending'"),
        {"a": str(account_id)},
    ).fetchall()
    for inv in pending:
        out.append(MemberOut(id=inv[0], user_id=None, role=inv[2], status="invited",
                             is_self=False, name=None, phone=inv[1]))
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

    phone = _canonical_invite_phone(payload.phone)
    if len(phone) < 10:
        raise HTTPException(status_code=400, detail="invalid_phone")

    inviter_info = resolve_users_by_ids([user_id]).get(str(user_id), {})
    inviter_name = (inviter_info.get("first_name") or "").strip()

    info = resolve_user_id_by_phone(phone)
    if info:
        # Registered user: join them immediately (and still send the WA invite
        # so they know they were added).
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
        _queue_invite_message(db, phone=phone, inviter_name=inviter_name, event=event, role=payload.role)
        db.commit()
        db.refresh(m)
        name = f"{info.get('first_name', '')} {info.get('last_name', '')}".strip() or None
        return MemberOut(id=m.id, user_id=m.user_id, role=m.role, status=m.status, is_self=False, name=name, phone=info.get("phone"))

    # Unregistered phone: store a pending invitation, claimed automatically on
    # the invitee's first sign-in. The inviter doesn't need to know or care.
    existing_inv = db.execute(
        text("SELECT id, status FROM team_invitations WHERE account_id = :a AND phone = :p"),
        {"a": str(account_id), "p": phone},
    ).fetchone()
    if existing_inv and existing_inv[1] == "pending":
        raise HTTPException(status_code=409, detail="already_invited")
    if existing_inv:
        # Revoked/stale row - refresh it into a new pending invite.
        db.execute(
            text("UPDATE team_invitations SET role = :r, status = 'pending', invited_by = :u, "
                 "event_id = :e, created_at = now(), accepted_at = NULL WHERE id = :id"),
            {"r": payload.role.value, "u": str(user_id), "e": str(event.id), "id": str(existing_inv[0])},
        )
        inv_id = existing_inv[0]
    else:
        inv_id = db.execute(
            text("INSERT INTO team_invitations (account_id, event_id, phone, role, invited_by) "
                 "VALUES (:a, :e, :p, :r, :u) RETURNING id"),
            {"a": str(account_id), "e": str(event.id), "p": phone,
             "r": payload.role.value, "u": str(user_id)},
        ).fetchone()[0]
    _queue_invite_message(db, phone=phone, inviter_name=inviter_name, event=event, role=payload.role)
    db.commit()
    return MemberOut(id=inv_id, user_id=None, role=payload.role.value, status="invited",
                     is_self=False, name=None, phone=phone)


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
        # Not a membership - maybe it's a pending invitation (same list in the UI).
        inv = db.execute(
            text("SELECT id, account_id FROM team_invitations WHERE id = :id AND status = 'pending'"),
            {"id": str(membership_id)},
        ).fetchone()
        if not inv:
            raise HTTPException(status_code=404, detail="Not found")
        _require_member_manage(db, inv[1], user_id)
        db.execute(text("UPDATE team_invitations SET status = 'revoked' WHERE id = :id"),
                   {"id": str(inv[0])})
        db.commit()
        return None
    _require_member_manage(db, m.account_id, user_id)
    if m.role == Role.OWNER.value:
        raise HTTPException(status_code=400, detail="cannot_remove_owner")
    db.delete(m)
    db.commit()
    return None


@router.post("/internal/team-invites/claim")
def claim_team_invites(
    payload: dict = Body(...),
    x_internal_secret: Optional[str] = Header(None, alias="X-Internal-Secret"),
    db: Session = Depends(get_db),
):
    """Internal (called by aub after a successful sign-in): convert every
    pending team invitation for this phone into an active Membership.
    Idempotent - claimed invites are marked accepted; existing memberships win."""
    from app.routers.venues import _check_internal_secret
    _check_internal_secret(x_internal_secret)

    phone = _canonical_invite_phone(str((payload or {}).get("phone") or ""))
    raw_user = (payload or {}).get("user_id")
    if not phone or not raw_user:
        raise HTTPException(status_code=400, detail="phone and user_id are required")
    try:
        claimer = uuid.UUID(str(raw_user))
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid user_id")

    invites = db.execute(
        text("SELECT id, account_id, role FROM team_invitations WHERE phone = :p AND status = 'pending'"),
        {"p": phone},
    ).fetchall()
    claimed = 0
    for inv_id, account_id, role in invites:
        existing = (
            db.query(Membership)
            .filter(Membership.account_id == account_id, Membership.user_id == claimer)
            .first()
        )
        if not existing:
            db.add(Membership(account_id=account_id, user_id=claimer, role=role, status="active"))
        db.execute(
            text("UPDATE team_invitations SET status = 'accepted', user_id = :u, accepted_at = now() WHERE id = :id"),
            {"u": str(claimer), "id": str(inv_id)},
        )
        claimed += 1
    db.commit()
    return {"claimed": claimed}
