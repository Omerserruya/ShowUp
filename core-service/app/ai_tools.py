"""AI tool layer (Phase 11): a fixed, RBAC-enforced, auditable tool registry.

This is infrastructure only - no LLM. Each tool maps to the same typed service
layer humans use (never raw SQL / dynamic queries). Every dispatch:
  1. resolves the caller's role on the target event (tenant isolation),
  2. checks the role grants the tool's required Action (default-deny),
  3. executes through CRUD, and
  4. writes an audit_log entry.

The AI assistant (Phase 12) calls dispatch_tool with an assistant-scoped context.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.crud import event as event_crud, guest as guest_crud
from app.models.models import Guest
from app.schemas.schemas import GuestCreate, GuestUpdate
from app.authz import resolve_role
from app.audit import record_audit
from app.timeline import record_guest_event
from app.usage import record_usage
from shared.domain.roles import Action, can
from shared.domain.enums import GuestStatus, ActorType, GuestEventType, UsageMetric


class ToolError(Exception):
    pass


class ToolNotFound(ToolError):
    pass


class ToolDenied(ToolError):
    pass


@dataclass
class ToolContext:
    db: Session
    user_id: uuid.UUID
    event_id: uuid.UUID
    actor_type: ActorType = ActorType.ASSISTANT


@dataclass
class Tool:
    name: str
    required_action: Action
    handler: Callable[["ToolContext", dict], Any]
    description: str = ""


REGISTRY: Dict[str, Tool] = {}


def register(tool: Tool) -> None:
    REGISTRY[tool.name] = tool


def list_tools() -> list[dict]:
    return [{"name": t.name, "required_action": t.required_action.value, "description": t.description}
            for t in REGISTRY.values()]


def dispatch_tool(ctx: ToolContext, name: str, args: Optional[dict] = None) -> dict:
    args = args or {}
    tool = REGISTRY.get(name)
    if not tool:
        raise ToolNotFound(f"unknown tool '{name}'")

    event = event_crud.get_event(ctx.db, ctx.event_id)
    role = resolve_role(ctx.db, event, ctx.user_id)
    account_id = getattr(event, "account_id", None)

    if role is None:
        record_audit(ctx.db, account_id=account_id, actor_type=ctx.actor_type, actor_id=ctx.user_id,
                     action=f"tool:{name}", entity_type="event", entity_id=ctx.event_id,
                     data={"status": "denied", "reason": "no_access"})
        raise ToolDenied("caller has no role on this event")

    if not can(role, tool.required_action):
        record_audit(ctx.db, account_id=account_id, actor_type=ctx.actor_type, actor_id=ctx.user_id,
                     action=f"tool:{name}", entity_type="event", entity_id=ctx.event_id,
                     data={"status": "denied", "reason": "insufficient_role", "role": role.value})
        raise ToolDenied(f"role '{role.value}' may not perform '{tool.required_action.value}'")

    result = tool.handler(ctx, args)
    record_audit(ctx.db, account_id=account_id, actor_type=ctx.actor_type, actor_id=ctx.user_id,
                 action=f"tool:{name}", entity_type="event", entity_id=ctx.event_id,
                 data={"status": "ok", "args": _safe(args)})
    return {"status": "ok", "result": result}


def _safe(args: dict) -> dict:
    # Keep audit payloads JSON-serializable + small.
    return {k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in args.items()}


# --------------------------- handlers ---------------------------

def _h_search_guest(ctx: ToolContext, args: dict):
    items, _ = guest_crud.list_guests(
        ctx.db, event_id=ctx.event_id, page=1, page_size=int(args.get("limit", 50)),
        search=args.get("query"), status=args.get("status"),
    )
    return [{"id": str(g.id), "name": g.name, "phone": g.phone, "status": g.status} for g in items]


def _h_add_guest(ctx: ToolContext, args: dict):
    payload = GuestCreate(event_id=ctx.event_id, name=args["name"], phone=args["phone"],
                          import_count=args.get("import_count", 1))
    guest = guest_crud.create_guest(ctx.db, payload)
    record_guest_event(ctx.db, guest_id=guest.id, event_id=ctx.event_id, type=GuestEventType.AI_ACTION,
                       actor_type=ActorType.ASSISTANT, actor_id=ctx.user_id, data={"action": "add_guest"})
    event = event_crud.get_event(ctx.db, ctx.event_id)
    record_usage(ctx.db, account_id=getattr(event, "account_id", None), event_id=ctx.event_id,
                 metric=UsageMetric.GUEST_ADDED, quantity=1)
    return {"id": str(guest.id), "name": guest.name}


def _h_update_guest(ctx: ToolContext, args: dict):
    guest = guest_crud.get_guest(ctx.db, uuid.UUID(str(args["guest_id"])))
    # Tenant isolation: the guest must belong to the context's event.
    if not guest or str(guest.event_id) != str(ctx.event_id):
        raise ToolDenied("guest not in this event")
    fields = {k: v for k, v in args.items() if k != "guest_id"}
    guest = guest_crud.update_guest(ctx.db, guest, GuestUpdate(**fields))
    record_guest_event(ctx.db, guest_id=guest.id, event_id=ctx.event_id, type=GuestEventType.AI_ACTION,
                       actor_type=ActorType.ASSISTANT, actor_id=ctx.user_id, data={"action": "update_guest", "fields": list(fields)})
    return {"id": str(guest.id), "status": guest.status}


def _h_event_stats(ctx: ToolContext, args: dict):
    def _count(values):
        return ctx.db.query(func.count(Guest.id)).filter(
            Guest.event_id == str(ctx.event_id), Guest.status.in_(list(values))
        ).scalar() or 0
    total = ctx.db.query(func.count(Guest.id)).filter(Guest.event_id == str(ctx.event_id)).scalar() or 0
    return {
        "total_guests": int(total),
        "confirmed": int(_count(GuestStatus.confirmed_values())),
        "declined": int(_count(GuestStatus.declined_values())),
        "maybe": int(_count(GuestStatus.maybe_values())),
        "no_response": int(_count(GuestStatus.pending_values())),
    }


def _h_export_guests(ctx: ToolContext, args: dict):
    items, _ = guest_crud.list_guests(ctx.db, event_id=ctx.event_id, page=1, page_size=10000)
    return [{"name": g.name, "phone": g.phone, "status": g.status,
             "group": g.group, "table_number": g.table_number} for g in items]


register(Tool("SearchGuest", Action.GUEST_READ, _h_search_guest, "Find guests by query/status."))
register(Tool("AddGuest", Action.GUEST_WRITE, _h_add_guest, "Create a guest."))
register(Tool("UpdateGuest", Action.GUEST_WRITE, _h_update_guest, "Update a guest in this event."))
register(Tool("EventStats", Action.GUEST_READ, _h_event_stats, "RSVP statistics for the event."))
register(Tool("ExportGuests", Action.GUEST_READ, _h_export_guests, "Export the guest list."))
