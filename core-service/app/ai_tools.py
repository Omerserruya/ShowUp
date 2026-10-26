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

import datetime as dt
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

from sqlalchemy import func, text as sql_text
from sqlalchemy.orm import Session

from app.crud import event as event_crud, guest as guest_crud, campaign as campaign_crud
from app.models.models import Guest
from app.schemas.schemas import GuestCreate, GuestUpdate, CampaignUpdate, EventUpdate
from app.audience import apply_audience, count_audience
from app.authz import resolve_role
from app.audit import record_audit
from app.timeline import record_guest_event
from app.usage import record_usage
from shared.domain.roles import Action, can
from shared.domain.enums import GuestStatus, ActorType, GuestEventType, UsageMetric, CampaignAudience


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
    # JSON Schema for the tool's arguments - consumed by the LLM agent loop.
    input_schema: dict = field(default_factory=lambda: {"type": "object", "properties": {}})


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

    try:
        result = tool.handler(ctx, args)
    except (ToolDenied, ToolError) as e:
        # A handler may have failed mid-write; never leave the session in a
        # failed transaction for the audit write (or the next tool call).
        ctx.db.rollback()
        record_audit(ctx.db, account_id=account_id, actor_type=ctx.actor_type, actor_id=ctx.user_id,
                     action=f"tool:{name}", entity_type="event", entity_id=ctx.event_id,
                     data={"status": "error", "error": str(e), "args": _safe(args)})
        raise
    except Exception:
        ctx.db.rollback()
        raise
    record_audit(ctx.db, account_id=account_id, actor_type=ctx.actor_type, actor_id=ctx.user_id,
                 action=f"tool:{name}", entity_type="event", entity_id=ctx.event_id,
                 data={"status": "ok", "args": _safe(args)})
    return {"status": "ok", "result": result}


def _safe(args: dict) -> dict:
    # Keep audit payloads JSON-serializable + small.
    return {k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in args.items()}


def _uuid_arg(value, field_name: str) -> uuid.UUID:
    """Parse an id argument, turning model mistakes (a name, a placeholder)
    into a ToolError the agent loop can feed back so the model self-corrects."""
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise ToolError(
            f"{field_name} must be a UUID, not a name - look it up first "
            f"(e.g. via the matching list/search tool) and pass its 'id'."
        )


# --------------------------- handlers ---------------------------

# Guest notes are written by GUESTS (free text over WhatsApp) - untrusted input
# that reaches the model. Bounded so a long note can't carry a payload/flood
# the context; the router additionally wraps every tool result as untrusted.
NOTES_MAX_CHARS = 200


def _short_notes(notes: Optional[str]) -> Optional[str]:
    if not notes:
        return notes
    notes = str(notes)
    return notes if len(notes) <= NOTES_MAX_CHARS else notes[:NOTES_MAX_CHARS] + "…"


def _guest_out(g: Guest, include_phone: bool = False) -> dict:
    out = {"id": str(g.id), "name": g.name, "status": g.status,
           "group": g.group,
           # party_size = the guest's own answer once they confirmed (guest_count),
           # else the owner's expected number (import_count).
           "party_size": _party_size(g),
           "guest_count": g.guest_count, "expected_count": g.import_count,
           "table_number": g.table_number,
           "notes": _short_notes(g.notes),
           "last_response": g.last_response.isoformat() if g.last_response else None}
    # Phone numbers are not sent to the LLM provider unless the user asked.
    if include_phone:
        out["phone"] = g.phone
    return out


def _is_confirmed(status: Optional[str]) -> bool:
    return (str(status or "").strip().lower() in GuestStatus.confirmed_values()
            or GuestStatus.normalize(status) == GuestStatus.CONFIRMED)


def _party_size(g: Guest) -> int:
    if _is_confirmed(g.status) and g.guest_count:
        return g.guest_count
    return g.import_count or g.guest_count or 1


def _parse_dt(value, field_name: str) -> dt.datetime:
    try:
        parsed = dt.datetime.fromisoformat(str(value))
    except ValueError:
        raise ToolError(f"{field_name} must be an ISO 8601 datetime, e.g. 2026-07-13T00:00:00")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def _h_search_guest(ctx: ToolContext, args: dict):
    limit = int(args.get("limit", 50))
    status = args.get("status")
    if status == "invited":  # the crud filter's key for "hasn't answered" is 'pending'
        status = "pending"
    notes_query = args.get("notes_query")
    has_notes = bool(args.get("has_notes"))
    group = args.get("group")
    table_number = args.get("table_number")
    responded_since = args.get("responded_since")
    # Notes/group/table/date filters scan the whole event list and match in
    # Python; guest lists are event-sized, this is cheap. Notes stay free text
    # by design (a guest can be both vegetarian AND allergic).
    scan_all = bool(notes_query or has_notes or group or table_number is not None or responded_since)
    items, _ = guest_crud.list_guests(
        ctx.db, event_id=ctx.event_id, page=1, page_size=10000 if scan_all else limit,
        search=args.get("query"), status=status,
    )
    if has_notes:
        items = [g for g in items if (g.notes or "").strip()]
    if notes_query:
        try:
            rx = re.compile(str(notes_query), re.IGNORECASE)
        except re.error:
            rx = re.compile(re.escape(str(notes_query)), re.IGNORECASE)
        items = [g for g in items if g.notes and rx.search(g.notes)]
    if group:
        items = [g for g in items if g.group and str(group).strip() in g.group]
    if table_number is not None:
        items = [g for g in items if g.table_number == int(table_number)]
    if responded_since:
        since = _parse_dt(responded_since, "responded_since")
        items = [g for g in items if g.last_response and g.last_response >= since]
    if scan_all:
        items = items[:max(limit, 200)]
    include_phone = bool(args.get("include_phone"))
    return [_guest_out(g, include_phone) for g in items]


def _h_add_guest(ctx: ToolContext, args: dict):
    if not str(args.get("name") or "").strip() or not str(args.get("phone") or "").strip():
        raise ToolError("name and phone are both required to add a guest")
    try:
        payload = GuestCreate(event_id=ctx.event_id, name=args["name"], phone=args["phone"],
                              import_count=args.get("import_count", 1))
    except Exception as e:  # pydantic validation (bad count, too-long name...)
        raise ToolError(f"invalid guest details: {e}")
    try:
        guest = guest_crud.create_guest(ctx.db, payload)
    except ValueError as e:  # capacity reached / duplicate phone in this event
        ctx.db.rollback()
        raise ToolError(str(e))
    record_guest_event(ctx.db, guest_id=guest.id, event_id=ctx.event_id, type=GuestEventType.AI_ACTION,
                       actor_type=ActorType.ASSISTANT, actor_id=ctx.user_id, data={"action": "add_guest"})
    event = event_crud.get_event(ctx.db, ctx.event_id)
    record_usage(ctx.db, account_id=getattr(event, "account_id", None), event_id=ctx.event_id,
                 metric=UsageMetric.GUEST_ADDED, quantity=1)
    return {"id": str(guest.id), "name": guest.name}


def _resolve_guest(ctx: ToolContext, args: dict) -> Guest:
    """Resolve the target guest from guest_id (UUID) or guest_name.

    Small models routinely pass the guest's name where the id belongs, so a
    non-UUID guest_id falls back to a name lookup instead of erroring out.
    Ambiguity is never guessed: 0 or 2+ matches raise a ToolError that tells
    the model exactly how to disambiguate.
    """
    raw_id = args.get("guest_id")
    if raw_id:
        try:
            guest_id = uuid.UUID(str(raw_id))
        except (ValueError, AttributeError, TypeError):
            guest_id = None
        if guest_id:
            guest = guest_crud.get_guest(ctx.db, guest_id)
            # Tenant isolation: the guest must belong to the context's event.
            if not guest or str(guest.event_id) != str(ctx.event_id):
                raise ToolDenied("guest not in this event")
            return guest

    name = str(args.get("guest_name") or raw_id or "").strip()
    if not name:
        raise ToolError("identify the guest: pass guest_id (from SearchGuest) or guest_name")

    matches, _ = guest_crud.list_guests(ctx.db, event_id=ctx.event_id, page=1, page_size=6, search=name)
    if not matches and " " in name:
        # Owners misspell surnames; retry on the first name alone.
        matches, _ = guest_crud.list_guests(ctx.db, event_id=ctx.event_id, page=1, page_size=6,
                                            search=name.split()[0])
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise ToolError(f"no guest matching '{name}' in this event - "
                        "check the spelling with SearchGuest and try again")
    exact = [g for g in matches if (g.name or "").strip() == name]
    if len(exact) == 1:
        return exact[0]
    options = ", ".join(f"{g.name} (id {g.id})" for g in matches[:6])
    raise ToolError(f"several guests match '{name}': {options}. "
                    "Ask the user which one, then pass that guest_id.")


def _h_update_guest(ctx: ToolContext, args: dict):
    guest = _resolve_guest(ctx, args)
    args = dict(args)
    # Party size: `party_size` is the model-facing arg. A legacy `guest_count`
    # arg means the same thing - the model can't know the storage rule, and
    # writing guest_count for a guest who never answered fabricated an RSVP
    # answer ("coming with 3") the guest never gave. `import_count` stays an
    # explicit "expected" write.
    party_size = args.pop("party_size", None)
    if party_size is None:
        party_size = args.pop("guest_count", None)
    else:
        args.pop("guest_count", None)
    fields = {k: v for k, v in args.items() if k in GuestUpdate.model_fields and v is not None}
    if "status" in fields:
        fields["status"] = GuestStatus.normalize(fields["status"]).value
    if party_size is not None:
        try:
            party_size = int(party_size)
        except (TypeError, ValueError):
            raise ToolError("party_size must be a whole number (1 or more)")
        if party_size < 1:
            raise ToolError("party_size must be at least 1")
        # The status AFTER this update decides: confirmed -> the RSVP answer
        # (guest_count); otherwise -> the owner's expected number (import_count).
        if _is_confirmed(fields.get("status", guest.status)):
            fields["guest_count"] = party_size
        else:
            fields["import_count"] = party_size
    if not fields:
        raise ToolError("nothing to update - provide at least one field to change "
                        "(status, notes, party_size, table_number, name, phone, group...)")
    from app.plans_client import PlanLookupUnavailable
    try:
        guest = guest_crud.update_guest(ctx.db, guest, GuestUpdate(**fields))
    except ValueError as e:  # e.g. duplicate phone in this event, capacity reached
        ctx.db.rollback()
        raise ToolError(str(e))
    except PlanLookupUnavailable:
        ctx.db.rollback()
        raise ToolError("could not verify the plan's guest capacity right now - try again in a minute")
    record_guest_event(ctx.db, guest_id=guest.id, event_id=ctx.event_id, type=GuestEventType.AI_ACTION,
                       actor_type=ActorType.ASSISTANT, actor_id=ctx.user_id, data={"action": "update_guest", "fields": list(fields)})
    out = {"id": str(guest.id), "name": guest.name, "status": guest.status,
           "party_size": _party_size(guest), "updated_fields": sorted(fields)}
    if "import_count" in fields and party_size is not None:
        out["note"] = ("the guest has not confirmed yet, so this was saved as the EXPECTED party "
                       "size; it becomes their confirmed count only when they RSVP")
    if "table_number" in fields:
        out["table_number"] = guest.table_number
    return out


def _h_delete_guest(ctx: ToolContext, args: dict):
    guest = _resolve_guest(ctx, args)
    name = guest.name
    guest_crud.delete_guest(ctx.db, guest)
    return {"deleted": True, "name": name}


def _h_event_stats(ctx: ToolContext, args: dict):
    guests = ctx.db.query(Guest).filter(Guest.event_id == str(ctx.event_id)).all()
    confirmed = GuestStatus.confirmed_values()
    declined = GuestStatus.declined_values()
    maybe = GuestStatus.maybe_values()

    def heads(g: Guest) -> int:
        # guest_count = what the guest answered; import_count = owner's estimate.
        return g.guest_count if g.guest_count else (g.import_count or 1)

    def bucket(subset) -> dict:
        subset = list(subset)
        n_conf = [g for g in subset if g.status in confirmed]
        return {
            "total_guests": len(subset),
            "confirmed": len(n_conf),
            "declined": sum(1 for g in subset if g.status in declined),
            "maybe": sum(1 for g in subset if g.status in maybe),
            "no_response": sum(1 for g in subset if g.status not in confirmed | declined | maybe),
            "expected_attendees": sum(heads(g) for g in n_conf),
        }

    out = bucket(guests)
    groups = sorted({(g.group or "").strip() for g in guests if (g.group or "").strip()})
    if groups:
        out["by_group"] = {grp: bucket(g for g in guests if (g.group or "").strip() == grp)
                           for grp in groups}
    return out


def _h_export_guests(ctx: ToolContext, args: dict):
    items, _ = guest_crud.list_guests(ctx.db, event_id=ctx.event_id, page=1, page_size=10000)
    include_phone = bool(args.get("include_phone"))
    out = []
    for g in items:
        row = {"name": g.name, "status": g.status, "group": g.group,
               "guest_count": g.guest_count, "table_number": g.table_number,
               "notes": _short_notes(g.notes)}
        if include_phone:
            row["phone"] = g.phone
        out.append(row)
    return out


def _phone_key(phone: Optional[str]) -> str:
    digits = re.sub(r"\D", "", phone or "")
    return digits[-9:]  # Israeli numbers: match on the significant tail, ignore +972/0 prefix


def _h_message_stats(ctx: ToolContext, args: dict):
    eid = str(ctx.event_id)
    params: dict = {"eid": eid}
    camp_cond = ""
    if args.get("campaign_id"):
        campaign = _get_event_campaign(ctx, args["campaign_id"])
        camp_cond = "AND c.id::text = :cid"
        params["cid"] = str(campaign.id)

    sent_ids = {row[0] for row in ctx.db.execute(sql_text(f"""
        SELECT DISTINCT ms.guest_id::text FROM messages_sent ms
        JOIN campaigns c ON c.id::text = ms.campaign_id::text
        WHERE c.event_id::text = :eid {camp_cond}"""), params)}

    def _status_phones(*statuses: str) -> set:
        in_list = ", ".join(f"'{s}'" for s in statuses)  # fixed literals, not user input
        # Outgoing rows carry the campaign but often no phone; the webhook's
        # 'status' rows carry the phone - take it from whichever side has it.
        rows = ctx.db.execute(sql_text(f"""
            SELECT DISTINCT COALESCE(ml_st.guest_phone, ml_out.guest_phone)
            FROM messages_log ml_out
            JOIN messages_log ml_st ON ml_st.wa_message_id = ml_out.wa_message_id
                AND ml_st.direction = 'status' AND ml_st.status IN ({in_list})
            JOIN campaigns c ON c.id::text = ml_out.campaign_id::text
            WHERE c.event_id::text = :eid {camp_cond}
              AND ml_out.direction = 'outgoing'"""), params)
        return {_phone_key(r[0]) for r in rows if r[0]}

    read_keys = _status_phones("read")
    delivered_keys = _status_phones("delivered", "read")
    failed_keys = _status_phones("failed")

    guests = ctx.db.query(Guest).filter(Guest.event_id == eid).all()
    got = [g for g in guests if str(g.id) in sent_ids]
    read = [g for g in got if _phone_key(g.phone) in read_keys]
    not_received = [g for g in guests if str(g.id) not in sent_ids]

    out = {
        "guests_messaged": len(got),
        "guests_read": len(read),
        "guests_delivered": sum(1 for g in got if _phone_key(g.phone) in delivered_keys),
        "guests_failed": sum(1 for g in got if _phone_key(g.phone) in failed_keys),
        "guests_not_messaged": len(not_received),
    }
    listing = args.get("list")
    if listing:
        pending = GuestStatus.pending_values()
        pick = {"read": read,
                "not_read": [g for g in got if _phone_key(g.phone) not in read_keys],
                "read_no_reply": [g for g in read if g.status in pending],
                "not_received": not_received}.get(listing)
        if pick is None:
            raise ToolError("list must be one of: read, not_read, read_no_reply, not_received")
        out["guests"] = [{"name": g.name, "rsvp_status": g.status} for g in pick[:200]]
    return out


def _h_event_summary(ctx: ToolContext, args: dict):
    event = event_crud.get_event(ctx.db, ctx.event_id)
    out = {
        "id": str(event.id),
        "name": event.name,
        "description": event.description,
        "event_date": event.event_date.isoformat() if event.event_date else None,
        "location": event.location,
        "event_type": getattr(event, "event_type", None),
        "active": bool(event.active),
        "plan": getattr(event, "plan_id", None),
    }
    # Message rounds: included in the plan + purchased, how many are used/left.
    try:
        out["rounds"] = _rounds_status(ctx, event)
    except Exception:
        ctx.db.rollback()
    return out


def _rounds_status(ctx: ToolContext, event) -> dict:
    from app.routers.campaigns import _rounds_status as rounds_status
    st = rounds_status(ctx.db, event)
    return {"included_in_plan": st["included"], "purchased_extra": st["allowance"],
            "used": st["used"], "remaining": st["remaining"]}


# --------------------------- questions to guests ---------------------------

_YES_NO_HE = {True: "כן", False: "לא"}
_QUESTION_TEXT_MAX = 80


def _answer_labels(field, value) -> list[str]:
    """A guest's stored answer as display labels (one per selected option)."""
    if value is None or value == "" or value == []:
        return []
    values = value if isinstance(value, list) else [value]
    out = []
    for v in values:
        if isinstance(v, dict):  # tolerate {"value": ..} / {"label": ..} shapes
            v = v.get("label", v.get("value"))
        if isinstance(v, bool) or (field.data_type == "boolean" and str(v).lower() in ("true", "false")):
            v = _YES_NO_HE[v if isinstance(v, bool) else str(v).lower() == "true"]
        text = str(v).strip()
        if text:
            out.append(text if len(text) <= _QUESTION_TEXT_MAX else text[:_QUESTION_TEXT_MAX] + "…")
    return out


def _h_question_results(ctx: ToolContext, args: dict):
    """Answers to the questions the event asks its guests (custom fields)."""
    from app.models.models import EventFieldDef, GuestCustomValue

    defs = (ctx.db.query(EventFieldDef)
            .filter(EventFieldDef.event_id == ctx.event_id)
            .order_by(EventFieldDef.sort_order, EventFieldDef.created_at).all())
    if not defs:
        return {"questions": [], "note": "this event has no questions for guests yet - they can be "
                                         "added in the app (Settings / invitation page)"}

    def _summary(f) -> dict:
        return {"key": f.key, "label": f.label, "type": f.data_type,
                "options": list(f.options or []) if f.data_type == "enum" else None,
                "asked_in_rsvp": bool(getattr(f, "ask_in_rsvp", False))}

    wanted = str(args.get("question") or args.get("question_key") or args.get("label") or "").strip()
    if not wanted:
        return {"questions": [_summary(f) for f in defs],
                "note": "call again with question=<key or label> for the answers"}

    low = wanted.lower()
    field = (next((f for f in defs if f.key.lower() == low), None)
             or next((f for f in defs if (f.label or "").strip().lower() == low), None))
    if field is None:
        partial = [f for f in defs if low in (f.label or "").lower() or low in f.key.lower()
                   or (f.label or "").lower() in low]
        if len(partial) == 1:
            field = partial[0]
        elif len(partial) > 1:
            raise ToolError("several questions match '%s': %s - pass the exact key" % (
                wanted, ", ".join(f"{f.label} (key {f.key})" for f in partial)))
        else:
            raise ToolError("no question matching '%s'. Existing questions: %s" % (
                wanted, ", ".join(f"{f.label} (key {f.key})" for f in defs)))

    rows = (ctx.db.query(GuestCustomValue, Guest)
            .join(Guest, Guest.id == GuestCustomValue.guest_id)
            .filter(GuestCustomValue.field_def_id == field.id,
                    Guest.event_id == str(ctx.event_id)).all())

    by_option: Dict[str, list] = {}
    if field.data_type == "enum":
        for opt in field.options or []:
            by_option[str(opt)] = []
    elif field.data_type == "boolean":
        by_option = {"כן": [], "לא": []}
    answered_ids = set()
    for cv, g in rows:
        labels = _answer_labels(field, cv.value)
        if not labels:
            continue
        answered_ids.add(str(g.id))
        for label in labels:
            by_option.setdefault(label, []).append({"name": g.name, "rsvp_status": g.status,
                                                    "party_size": _party_size(g)})

    confirmed = GuestStatus.confirmed_values()
    confirmed_guests = ctx.db.query(Guest).filter(Guest.event_id == str(ctx.event_id),
                                                  Guest.status.in_(list(confirmed))).all()
    no_answer = [g for g in confirmed_guests if str(g.id) not in answered_ids]
    return {
        **_summary(field),
        "answered": len(answered_ids),
        "results": [{"answer": label, "count": len(gs),
                     "people": sum(x["party_size"] for x in gs),
                     "guests": gs[:200]} for label, gs in by_option.items()],
        "confirmed_without_answer": len(no_answer),
        "confirmed_without_answer_names": [g.name for g in no_answer[:50]],
    }


def _campaign_out(c) -> dict:
    return {
        "id": str(c.id), "name": c.name, "template": c.template, "channel": c.channel,
        "status": c.status,
        "schedule_time": c.schedule_time.isoformat() if c.schedule_time else None,
        "audience": c.audience, "audience_filter": c.audience_filter,
        "recipient_count": c.recipient_count,
    }


def _get_event_campaign(ctx: ToolContext, campaign_id) -> Any:
    campaign = campaign_crud.get_campaign(ctx.db, _uuid_arg(campaign_id, "campaign_id"))
    # Tenant isolation: the campaign must belong to the context's event.
    if not campaign or str(campaign.event_id) != str(ctx.event_id):
        raise ToolDenied("campaign not in this event")
    return campaign


def _h_list_campaigns(ctx: ToolContext, args: dict):
    items, _ = campaign_crud.list_campaigns(
        ctx.db, event_id=ctx.event_id, page=1, page_size=int(args.get("limit", 50)),
        search=args.get("query"), order_by="schedule_time",
    )
    return [_campaign_out(c) for c in items]


def _h_campaign_stats(ctx: ToolContext, args: dict):
    campaign = _get_event_campaign(ctx, args["campaign_id"])
    stats = campaign_crud.get_campaign_stats(ctx.db, campaign.id)
    out = {**_campaign_out(campaign), "stats": stats}
    if campaign.status != "sent":
        out["planned_recipients"] = count_audience(ctx.db, ctx.event_id,
                                                   campaign.audience, campaign.audience_filter)
    if args.get("list_recipients"):
        q = ctx.db.query(Guest).filter(Guest.event_id == str(ctx.event_id))
        recipients = apply_audience(q, campaign.audience, campaign.audience_filter).limit(200).all()
        out["recipients"] = [{"name": g.name, "rsvp_status": g.status} for g in recipients]
    return out


def _h_update_campaign(ctx: ToolContext, args: dict):
    campaign = _get_event_campaign(ctx, args["campaign_id"])
    if campaign.status not in ("pending", "draft", "paused"):
        raise ToolDenied(f"campaign in status '{campaign.status}' can no longer be edited")
    # Deliberately narrow: name, schedule and audience. Template/channel changes
    # go through the human UI, which enforces the deliverability gate (audience
    # only picks WHO receives the already-approved template, so it is safe here).
    fields: dict = {}
    if args.get("name"):
        fields["name"] = args["name"]
    if args.get("schedule_time"):
        fields["schedule_time"] = _parse_dt(args["schedule_time"], "schedule_time")
        # Moving a round to (nearly) now is a LAUNCH, not an edit: it needs the
        # same permission as TriggerCampaign (an editor may reschedule, not send).
        if is_near_launch(fields["schedule_time"]):
            _require_action(ctx, Action.CAMPAIGN_LAUNCH)
    if args.get("audience"):
        try:
            fields["audience"] = CampaignAudience(str(args["audience"]))
        except ValueError:
            raise ToolError("audience must be one of: everyone, confirmed, declined, no_response")
    if args.get("audience_group"):
        grp = str(args["audience_group"]).strip()
        known = {(g.group or "").strip() for g in
                 ctx.db.query(Guest).filter(Guest.event_id == str(ctx.event_id)).all()}
        if grp not in known:
            raise ToolError(f"no guest group named '{grp}' - existing groups: "
                            + (", ".join(sorted(k for k in known if k)) or "(none)"))
        fields["audience"] = CampaignAudience.CUSTOM
        fields["audience_filter"] = {"group": grp}
    if not fields:
        raise ToolError("nothing to update - provide name, schedule_time, audience and/or audience_group")
    try:
        campaign = campaign_crud.update_campaign(ctx.db, campaign, CampaignUpdate(**fields))
    except ValueError as e:  # e.g. schedule conflicts with another campaign
        raise ToolError(str(e))
    return _campaign_out(campaign)


# A reschedule to within this window of "now" counts as launching the round.
NEAR_LAUNCH_WINDOW = dt.timedelta(hours=6)


def is_near_launch(when: dt.datetime) -> bool:
    if when.tzinfo is None:
        when = when.replace(tzinfo=dt.timezone.utc)
    return when <= dt.datetime.now(dt.timezone.utc) + NEAR_LAUNCH_WINDOW


def _require_action(ctx: ToolContext, action: Action) -> None:
    event = event_crud.get_event(ctx.db, ctx.event_id)
    role = resolve_role(ctx.db, event, ctx.user_id)
    if role is None or not can(role, action):
        raise ToolDenied(f"this requires the '{action.value}' permission, which your role does not have")


# --------------------------- new rounds ---------------------------

# Stages the assistant may open a round for (save-the-date is wizard-only).
CREATABLE_STAGES = ("invitation", "reminder", "final_reminder", "table_assignment", "thank_you")
STAGE_TITLE_HE = {"invitation": "הזמנה", "reminder": "תזכורת", "final_reminder": "תזכורת אחרונה",
                  "table_assignment": "שיוך שולחן", "thank_you": "תודה"}
AUDIENCE_HE = {"everyone": "כל האורחים", "confirmed": "מי שאישר הגעה", "declined": "מי שסירב",
               "no_response": "מי שעוד לא ענה", "custom": "קבוצה מותאמת"}
SEND_WINDOW_NOTE_HE = ("סבבים יוצאים רק בשעות השליחה: א'-ה' 09:00-21:00, שישי עד 14:00 "
                       "(ובמוצאי שבת 20:00-21:00). סבב שמתוזמן מחוץ לשעות האלה יוצא כשהחלון נפתח.")

_IL_TZ = None


def _il_tz():
    global _IL_TZ
    if _IL_TZ is None:
        try:
            from zoneinfo import ZoneInfo
            _IL_TZ = ZoneInfo("Asia/Jerusalem")
        except Exception:
            _IL_TZ = dt.timezone(dt.timedelta(hours=2))
    return _IL_TZ


def _in_send_window(when: dt.datetime) -> bool:
    """Default campaign send window (scheduler-service/send_window.py):
    Sun-Thu 09-21, Fri 09-14, Sat 20-21, Israel time. Informational only."""
    local = when.astimezone(_il_tz())
    minutes = local.hour * 60 + local.minute
    wd = local.weekday()  # Mon=0 .. Sun=6
    if wd == 4:
        return 9 * 60 <= minutes < 14 * 60
    if wd == 5:
        return 20 * 60 <= minutes < 21 * 60
    return 9 * 60 <= minutes < 21 * 60


def _parse_when(value) -> dt.datetime:
    """'now' or an ISO datetime; a naive time is Israel local time."""
    raw = str(value or "").strip()
    now = dt.datetime.now(dt.timezone.utc)
    if not raw or raw.lower() in ("now", "עכשיו", "immediately"):
        return now
    try:
        parsed = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise ToolError("when must be 'now' or an ISO 8601 datetime with offset, e.g. 2026-11-02T10:00:00+02:00")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_il_tz())
    parsed = parsed.astimezone(dt.timezone.utc)
    if parsed < now - dt.timedelta(minutes=5):
        raise ToolError("when is in the past - pick a future time, or 'now'")
    return max(parsed, now)


def _template_for_stage(stage: str, event_type: Optional[str]):
    """The catalog's default SENDABLE template for this stage AND event type -
    the same choice the Messages page's "סבב חדש" dialog preselects
    (isSendableFor + is_default first). Image-header templates are skipped:
    the assistant cannot attach the required image."""
    from shared.domain.messaging import BUILTIN_CATALOG
    from app.routers.catalog import _sendable_event_types
    sendable_for = _sendable_event_types()

    def _sendable(t) -> bool:
        ets = sendable_for.get(t.key, ())
        if not event_type:
            return bool(t.is_usable or ets)
        return event_type in ets

    candidates = [t for t in BUILTIN_CATALOG.values()
                  if getattr(t.flow_stage, "value", t.flow_stage) == stage and _sendable(t)]
    no_image = [t for t in candidates if getattr(t.preview, "header", None) != "image"]
    if not no_image:
        if candidates:
            raise ToolError(f"the {stage} templates available for this event need an image - "
                            "tell the user to create this round in the app (סבבי שליחה -> סבב חדש)")
        raise ToolError(f"no sendable {stage} template is available for this event type yet - "
                        "tell the user to check the סבבי שליחה page")
    no_image.sort(key=lambda t: (not t.is_default, t.title or ""))
    return no_image[0]


def _rounds_exhausted_error(ctx: ToolContext, detail: dict) -> ToolError:
    price = detail.get("price_gross")
    price_txt = f" (מחיר סבב נוסף ל-{detail.get('recipients')} נמענים: ₪{price:g})" if isinstance(
        price, (int, float)) else ""
    return ToolError(
        "ROUNDS_EXHAUSTED: לא נשארו סבבים כלולים בחבילה של האירוע "
        f"(נוצלו {detail.get('used')} מתוך {detail.get('free_total')}). "
        f"סבב נוסף הוא בתשלום{price_txt} ואפשר לרכוש אותו רק באפליקציה: "
        "בעמוד 'סבבי שליחה' -> 'סבב חדש'. אי אפשר לרכוש סבב דרכי. "
        "Tell the user exactly this, in Hebrew; do NOT retry.")


def plan_new_round(ctx: ToolContext, args: dict) -> dict:
    """Validate a CreateCampaign request WITHOUT writing anything: stage,
    template, time, audience, deliverability, rounds left, launch permission.
    Shared by the confirmation summary and the handler, so the user is never
    asked to confirm something that would then be refused."""
    from fastapi import HTTPException
    from app.routers import campaigns as campaigns_router
    from app.schemas.schemas import CampaignCreate
    from shared.domain.messaging import canonical_stage

    cs = canonical_stage(args.get("stage"))
    stage = cs.value if cs else None
    if stage not in CREATABLE_STAGES:
        raise ToolError("stage must be one of: " + ", ".join(CREATABLE_STAGES))
    when = _parse_when(args.get("when"))
    if is_near_launch(when):
        _require_action(ctx, Action.CAMPAIGN_LAUNCH)

    event = event_crud.get_event(ctx.db, ctx.event_id)
    event_type = getattr(event, "event_type", None) or "wedding"
    tmpl = _template_for_stage(stage, event_type)

    fields = {"event_id": ctx.event_id, "name": STAGE_TITLE_HE.get(stage, "סבב חדש"),
              "template": tmpl.key, "channel": "whatsapp", "status": "pending",
              "schedule_time": when}
    audience_arg = str(args.get("audience") or "").strip()
    if audience_arg:
        if audience_arg not in ("no_response", "confirmed", "everyone"):
            raise ToolError("audience must be one of: no_response, confirmed, everyone")
        fields["audience"] = CampaignAudience(audience_arg)
    item = CampaignCreate(**fields)

    try:
        campaigns_router._require_deliverable_template(ctx.db, item.template, None, event_type=event_type)
    except HTTPException as e:
        raise ToolError(f"template not deliverable: {e.detail}")
    try:
        campaign_crud.validate_schedule_vs_event(ctx.db, event, item.template, when)
    except ValueError:
        raise ToolError("that time is after the event - a pre-event round must go out before the event")
    try:
        campaigns_router._require_rounds_available(ctx.db, event, ctx.event_id, 1, [item])
    except HTTPException as e:
        if e.status_code == 402 and isinstance(e.detail, dict):
            raise _rounds_exhausted_error(ctx, e.detail)
        raise ToolError(str(e.detail))

    audience, audience_filter = campaign_crud.derive_audience(ctx.db, item)
    return {"item": item, "stage": stage, "when": when, "template": tmpl.key,
            "audience": audience, "audience_filter": audience_filter,
            "recipients": count_audience(ctx.db, ctx.event_id, audience, audience_filter),
            "in_send_window": _in_send_window(when)}


def new_round_summary(plan: dict) -> str:
    when_local = plan["when"].astimezone(_il_tz()).strftime("%d/%m/%Y %H:%M")
    near_now = plan["when"] <= dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=2)
    when_txt = "מיד (עכשיו)" if near_now else when_local
    txt = (f'ליצור סבב "{STAGE_TITLE_HE.get(plan["stage"], plan["stage"])}" שיתוזמן ל-{when_txt}, '
           f'ל-{plan["recipients"]} אורחים ({AUDIENCE_HE.get(plan["audience"], plan["audience"])}). '
           "הסבב ינוצל מהסבבים הכלולים בחבילה")
    if not plan["in_send_window"]:
        txt += ". המועד מחוץ לשעות השליחה, אז הוא ייצא כשחלון השליחה ייפתח"
    return txt


def _h_create_campaign(ctx: ToolContext, args: dict):
    from app.usage import record_usage as _record_usage
    plan = plan_new_round(ctx, args)
    try:
        campaign = campaign_crud.create_campaign(ctx.db, plan["item"])
    except ValueError as e:  # min gap between rounds, schedule after event...
        ctx.db.rollback()
        raise ToolError(str(e))
    event = event_crud.get_event(ctx.db, ctx.event_id)
    # Round usage is billing usage - recorded exactly like the HTTP create path.
    _record_usage(ctx.db, account_id=getattr(event, "account_id", None), event_id=ctx.event_id,
                  metric=UsageMetric.ROUND_LAUNCHED, quantity=1, ref_id=campaign.id)
    out = _campaign_out(campaign)
    out["schedule_time_israel"] = plan["when"].astimezone(_il_tz()).strftime("%d/%m/%Y %H:%M")
    out["planned_recipients"] = plan["recipients"]
    out["note"] = ("The round was CREATED and SCHEDULED - it has NOT been sent yet. Tell the user it is "
                   "scheduled for schedule_time_israel (to planned_recipients guests). "
                   + SEND_WINDOW_NOTE_HE)
    if not plan["in_send_window"]:
        out["outside_send_window"] = True
    return out


def _h_pause_campaign(ctx: ToolContext, args: dict):
    campaign = _get_event_campaign(ctx, args["campaign_id"])
    if campaign.status not in ("pending", "draft"):
        raise ToolDenied(f"campaign in status '{campaign.status}' cannot be paused")
    campaign = campaign_crud.update_campaign(ctx.db, campaign, CampaignUpdate(status="paused"))
    return {**_campaign_out(campaign),
            "note": "campaign is on hold and will not be sent; re-activate with TriggerCampaign or in the app"}


def _h_trigger_campaign(ctx: ToolContext, args: dict):
    import datetime as _dt
    campaign = _get_event_campaign(ctx, args["campaign_id"])
    if campaign.status not in ("pending", "draft", "paused"):
        raise ToolDenied(f"campaign in status '{campaign.status}' cannot be triggered")
    campaign = campaign_crud.update_campaign(
        ctx.db, campaign,
        CampaignUpdate(schedule_time=_dt.datetime.now(_dt.timezone.utc), status="pending"),
    )
    return {**_campaign_out(campaign),
            "note": "campaign scheduled for immediate dispatch; the scheduler picks it up within its next cycle"}


def _h_update_event(ctx: ToolContext, args: dict):
    event = event_crud.get_event(ctx.db, ctx.event_id)
    fields: dict = {}
    for key in ("name", "description", "location"):
        if args.get(key):
            fields[key] = str(args[key])
    if args.get("event_date"):
        fields["event_date"] = _parse_dt(args["event_date"], "event_date")
    if not fields:
        raise ToolError("nothing to update - provide name, description, location and/or event_date")
    try:
        event = event_crud.update_event(ctx.db, event, EventUpdate(**fields))
    except ValueError as e:  # e.g. event_date in the past
        ctx.db.rollback()
        raise ToolError(str(e))
    out = {"id": str(event.id), "name": event.name,
           "event_date": event.event_date.isoformat() if event.event_date else None,
           "location": event.location}
    shifted = getattr(event, "shifted_campaigns", None)
    if shifted:
        out["shifted_campaigns"] = shifted
        out["note"] = ("not-yet-sent campaigns were moved by the same amount as the event; "
                       "any that would now be in the past were paused")
    return out


register(Tool("SearchGuest", Action.GUEST_READ, _h_search_guest,
              "Find guests in this event by free-text query, RSVP status, group/side, table, "
              "response date and/or notes content (dietary needs, allergies and special "
              "requirements live in free-text notes). Combine filters freely.",
              {"type": "object", "properties": {
                  "query": {"type": "string", "description": "Name/phone search text"},
                  "status": {"type": "string", "enum": ["pending", "confirmed", "declined", "maybe"],
                             "description": "pending = hasn't answered yet"},
                  "group": {"type": "string", "description": "Guest group/side, e.g. 'חברים של החתן' (contains match)"},
                  "table_number": {"type": "integer", "description": "Only guests seated at this table"},
                  "responded_since": {"type": "string", "description":
                      "ISO datetime - only guests whose last RSVP response is at/after this time "
                      "(use for 'who confirmed today/this week')"},
                  "notes_query": {"type": "string", "description":
                      "Case-insensitive regex matched against guest notes, e.g. 'צמחוני|טבעוני' or 'אלרג'"},
                  "has_notes": {"type": "boolean", "description":
                      "Only guests that have any note - use to summarize all notes/special requirements"},
                  "include_phone": {"type": "boolean", "description":
                      "Include phone numbers - ONLY when the user explicitly asked for phone numbers (default false)"},
                  "limit": {"type": "integer", "description": "Max results (default 50)"}}}))
register(Tool("AddGuest", Action.GUEST_WRITE, _h_add_guest,
              "Create a guest in this event.",
              {"type": "object", "properties": {
                  "name": {"type": "string"},
                  "phone": {"type": "string", "description": "Phone in international format, e.g. +9725..."},
                  "import_count": {"type": "integer", "description": "Party size (default 1)"}},
               "required": ["name", "phone"]}))
register(Tool("UpdateGuest", Action.GUEST_WRITE, _h_update_guest,
              "Update a guest in this event (status, name, phone, group, table_number, notes, party_size...). "
              "Identify the guest with guest_id (preferred, from SearchGuest) or guest_name.",
              {"type": "object", "properties": {
                  "guest_id": {"type": "string", "description": "Guest UUID from SearchGuest (preferred)"},
                  "guest_name": {"type": "string", "description": "Guest's name, used to find them when you don't have the id"},
                  "status": {"type": "string", "enum": ["invited", "confirmed", "declined", "maybe"],
                             "description": "invited = reset to 'not answered' (e.g. cancel a confirmation)"},
                  "name": {"type": "string", "description": "New name (rename the guest)"},
                  "phone": {"type": "string", "description": "New phone, international format +9725..."},
                  "group": {"type": "string", "description": "Guest group/side"},
                  "party_size": {"type": "integer", "description":
                      "How many people this guest is coming with in total (including them). The "
                      "server stores it correctly for confirmed vs not-yet-answered guests."},
                  "table_number": {"type": "integer"},
                  "notes": {"type": "string", "description": "Free-text note saved on the guest (overwrites the "
                            "existing note; pass an empty string to delete the note)"}}}))
register(Tool("DeleteGuest", Action.GUEST_DELETE, _h_delete_guest,
              "Permanently delete a guest from this event. Irreversible - you MUST have the user's "
              "explicit confirmation for that specific guest before calling this.",
              {"type": "object", "properties": {
                  "guest_id": {"type": "string", "description": "Guest UUID from SearchGuest (preferred)"},
                  "guest_name": {"type": "string", "description": "Guest's name when you don't have the id"}}}))
register(Tool("EventStats", Action.GUEST_READ, _h_event_stats,
              "RSVP statistics for this event: guest counts by status, expected attendee headcount "
              "(sums party sizes of confirmed guests), and the same breakdown per guest group/side."))
register(Tool("MessageStats", Action.CAMPAIGN_READ, _h_message_stats,
              "WhatsApp delivery stats for this event (or one campaign): how many guests were "
              "messaged / delivered / read / failed / never messaged. Set list to also get names: "
              "'read' (opened), 'not_read' (got it but didn't open), 'read_no_reply' (opened but "
              "still hasn't answered the RSVP), 'not_received' (never messaged).",
              {"type": "object", "properties": {
                  "campaign_id": {"type": "string", "description": "Limit to one campaign (default: whole event)"},
                  "list": {"type": "string", "enum": ["read", "not_read", "read_no_reply", "not_received"]}}}))
register(Tool("EventSummary", Action.EVENT_READ, _h_event_summary,
              "This event's details: name, date, location, description, type, active state, plan, "
              "and message rounds (included in the plan / used / remaining)."))
register(Tool("UpdateEvent", Action.EVENT_WRITE, _h_update_event,
              "Update this event's name, description, location (venue/address) and/or event_date "
              "(date AND time live in event_date). Changing the date needs the user's confirmation; "
              "not-yet-sent campaigns move automatically by the same amount.",
              {"type": "object", "properties": {
                  "name": {"type": "string"},
                  "description": {"type": "string"},
                  "location": {"type": "string", "description": "Venue name and/or address, free text"},
                  "event_date": {"type": "string", "description": "ISO 8601 datetime with timezone offset"}}}))
register(Tool("ExportGuests", Action.GUEST_READ, _h_export_guests,
              "Full guest list with status, group and table assignment.",
              {"type": "object", "properties": {
                  "include_phone": {"type": "boolean", "description":
                      "Include phone numbers - ONLY when the user explicitly asked for them (default false)"}}}))
register(Tool("ListCampaigns", Action.CAMPAIGN_READ, _h_list_campaigns,
              "List this event's message campaigns with status and schedule.",
              {"type": "object", "properties": {
                  "query": {"type": "string", "description": "Filter by campaign name"},
                  "limit": {"type": "integer"}}}))
register(Tool("CampaignStats", Action.CAMPAIGN_READ, _h_campaign_stats,
              "Stats for one campaign: sent/read counts, and for a not-yet-sent campaign how many "
              "guests will receive it (planned_recipients). Set list_recipients for their names.",
              {"type": "object", "properties": {
                  "campaign_id": {"type": "string"},
                  "list_recipients": {"type": "boolean", "description": "Also return recipient names"}},
               "required": ["campaign_id"]}))
register(Tool("UpdateCampaign", Action.CAMPAIGN_WRITE, _h_update_campaign,
              "Edit a not-yet-sent campaign: rename, reschedule, or retarget its audience "
              "(e.g. send only to guests who haven't answered, or only to one group). "
              "Template/message-content changes must be done in the UI.",
              {"type": "object", "properties": {
                  "campaign_id": {"type": "string"},
                  "name": {"type": "string"},
                  "schedule_time": {"type": "string", "description": "ISO 8601 datetime with timezone offset"},
                  "audience": {"type": "string", "enum": ["everyone", "confirmed", "declined", "no_response"],
                               "description": "Who receives the campaign"},
                  "audience_group": {"type": "string", "description":
                      "Send only to this guest group/side (exact group name from EventStats)"}},
               "required": ["campaign_id"]}))
register(Tool("CreateCampaign", Action.CAMPAIGN_WRITE, _h_create_campaign,
              "Create a NEW message round (reminder / final reminder / invitation / thank-you / "
              "table assignment) and schedule it. The server picks the right approved template for "
              "this event and asks the user to confirm first. Uses one of the plan's rounds; if none "
              "are left it returns an error explaining an extra round must be bought in the app. "
              "Never say the round was sent - it is scheduled.",
              {"type": "object", "properties": {
                  "stage": {"type": "string", "enum": list(CREATABLE_STAGES),
                            "description": "reminder = to those who haven't answered; final_reminder = "
                                           "close to the event; thank_you = after the event; "
                                           "table_assignment = tell confirmed guests their table"},
                  "when": {"type": "string", "description":
                      "'now' or ISO 8601 datetime with Israel offset, e.g. 2026-11-02T10:00:00+02:00"},
                  "audience": {"type": "string", "enum": ["no_response", "confirmed", "everyone"],
                               "description": "Optional override; default follows the stage "
                                              "(reminder -> no_response, thank_you -> confirmed...)"}},
               "required": ["stage", "when"]}))
register(Tool("QuestionResults", Action.GUEST_READ, _h_question_results,
              "Answers to the event's questions for guests (asked in the RSVP, e.g. 'צריכים הסעה?', "
              "'מנה מועדפת'): count and guest names per answer. Call with no question to list the "
              "event's questions; then with question=<key or label>.",
              {"type": "object", "properties": {
                  "question": {"type": "string", "description": "Question key or (part of) its label"}}}))
register(Tool("PauseCampaign", Action.CAMPAIGN_WRITE, _h_pause_campaign,
              "Put a scheduled campaign on hold so it will NOT be sent. Confirm with the user first.",
              {"type": "object", "properties": {"campaign_id": {"type": "string"}},
               "required": ["campaign_id"]}))
register(Tool("TriggerCampaign", Action.CAMPAIGN_LAUNCH, _h_trigger_campaign,
              "Send a not-yet-sent campaign now (schedules it for immediate dispatch). "
              "Ask the user for explicit confirmation before calling this.",
              {"type": "object", "properties": {"campaign_id": {"type": "string"}},
               "required": ["campaign_id"]}))
