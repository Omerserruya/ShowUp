"""AI assistant infrastructure (Phase 12): identity verification + scoped sessions.

No LLM here. This is the trust boundary and session lifecycle the assistant runs
on. The inbound WhatsApp sender phone is NEVER trusted on its own - a session
only opens for a phone with a verified identity link AND a role on the target
event. Tool calls go through the Phase 11 registry, which re-checks RBAC and
audits every call.
"""
from __future__ import annotations

import datetime as dt
import uuid
from typing import Optional

from sqlalchemy.orm import Session

from app.crud import event as event_crud
from app.models.models import AssistantIdentityLink, AssistantSession
from app.authz import resolve_role
from app.ai_tools import ToolContext, dispatch_tool
from shared.domain.enums import ActorType
from shared.domain.entitlements import Feature, has_feature

SESSION_TTL_MINUTES = 30


class AssistantAuthError(Exception):
    """Raised when the sender cannot be authenticated/authorized for a session."""


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def link_identity(db: Session, phone: str, user_id: uuid.UUID, verified: bool = False) -> AssistantIdentityLink:
    """Create or update the phone->user binding. `verified` should only be set
    True after an out-of-band check (OTP / authenticated deep link)."""
    link = db.query(AssistantIdentityLink).filter(AssistantIdentityLink.phone == phone).first()
    if link:
        link.user_id = user_id
        if verified:
            link.verified = True
            link.verified_at = _now()
    else:
        link = AssistantIdentityLink(phone=phone, user_id=user_id, verified=verified,
                                     verified_at=_now() if verified else None)
        db.add(link)
    db.commit()
    db.refresh(link)
    return link


def verify_identity(db: Session, phone: str) -> AssistantIdentityLink:
    link = db.query(AssistantIdentityLink).filter(AssistantIdentityLink.phone == phone).first()
    if not link:
        raise AssistantAuthError("no identity link for phone")
    link.verified = True
    link.verified_at = _now()
    db.commit()
    db.refresh(link)
    return link


def authenticate_sender(db: Session, phone: str) -> Optional[uuid.UUID]:
    """Return the user_id for a VERIFIED phone, else None. Never trusts unverified."""
    link = db.query(AssistantIdentityLink).filter(
        AssistantIdentityLink.phone == phone, AssistantIdentityLink.verified == True  # noqa: E712
    ).first()
    return link.user_id if link else None


def open_session(db: Session, phone: str, event_id: uuid.UUID) -> AssistantSession:
    """Authenticate the sender and open a session scoped to (user, account, event).
    Raises AssistantAuthError if the phone is unverified or has no role on the event."""
    user_id = authenticate_sender(db, phone)
    if not user_id:
        raise AssistantAuthError("sender phone is not a verified, linked identity")

    event = event_crud.get_event(db, event_id)
    role = resolve_role(db, event, user_id)
    if role is None:
        raise AssistantAuthError("user has no role on this event")
    # Tier gate: the AI assistant is a Pro feature. Excluded from Free/Basic/Plus.
    if not has_feature(getattr(event, "plan_id", None), Feature.AI_ASSISTANT):
        raise AssistantAuthError("the AI assistant is not included in this event's plan")

    session = AssistantSession(
        user_id=user_id,
        account_id=getattr(event, "account_id", None),
        event_id=event_id,
        channel="whatsapp_assistant",
        active=True,
        expires_at=_now() + dt.timedelta(minutes=SESSION_TTL_MINUTES),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def assistant_dispatch(db: Session, session: AssistantSession, tool: str, args: Optional[dict] = None) -> dict:
    """Run a tool within a session. RBAC + ownership + audit are enforced by the
    Phase 11 dispatcher; here we enforce session validity."""
    if not session.active:
        raise AssistantAuthError("session is not active")
    if session.expires_at is not None and session.expires_at < _now():
        raise AssistantAuthError("session expired")
    ctx = ToolContext(db=db, user_id=session.user_id, event_id=session.event_id, actor_type=ActorType.ASSISTANT)
    return dispatch_tool(ctx, tool, args)
