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
        record_audit(ctx.db, account_id=account_id, actor_type=ctx.actor_type, actor_id=ctx.user_id,
                     action=f"tool:{name}", entity_type="event", entity_id=ctx.event_id,
                     data={"status": "error", "error": str(e), "args": _safe(args)})
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

def _guest_out(g: Guest) -> dict:
    return {"id": str(g.id), "name": g.name, "phone": g.phone, "status": g.status,
            "group": g.group, "guest_count": g.guest_count, "table_number": g.table_number,
            "notes": g.notes,
            "last_response": g.last_response.isoformat() if g.last_response else None}


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
    return [_guest_out(g) for g in items]


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
    fields = {k: v for k, v in args.items() if k in GuestUpdate.model_fields and v is not None}
    if not fields:
        raise ToolError("nothing to update - provide at least one field to change "
                        "(status, notes, guest_count, table_number, name, phone, group...)")
    if "status" in fields:
        fields["status"] = GuestStatus.normalize(fields["status"]).value
    try:
        guest = guest_crud.update_guest(ctx.db, guest, GuestUpdate(**fields))
    except ValueError as e:  # e.g. duplicate phone in this event
        raise ToolError(str(e))
    record_guest_event(ctx.db, guest_id=guest.id, event_id=ctx.event_id, type=GuestEventType.AI_ACTION,
                       actor_type=ActorType.ASSISTANT, actor_id=ctx.user_id, data={"action": "update_guest", "fields": list(fields)})
    return {"id": str(guest.id), "status": guest.status}


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
    return [{"name": g.name, "phone": g.phone, "status": g.status, "group": g.group,
             "guest_count": g.guest_count, "table_number": g.table_number, "notes": g.notes}
            for g in items]


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
    return {
        "id": str(event.id),
        "name": event.name,
        "description": event.description,
        "event_date": event.event_date.isoformat() if event.event_date else None,
        "location": event.location,
        "active": bool(event.active),
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
    event = event_crud.update_event(ctx.db, event, EventUpdate(**fields))
    return {"id": str(event.id), "name": event.name,
            "event_date": event.event_date.isoformat() if event.event_date else None,
            "location": event.location}


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
                  "limit": {"type": "integer", "description": "Max results (default 50)"}}}))
register(Tool("AddGuest", Action.GUEST_WRITE, _h_add_guest,
              "Create a guest in this event.",
              {"type": "object", "properties": {
                  "name": {"type": "string"},
                  "phone": {"type": "string", "description": "Phone in international format, e.g. +9725..."},
                  "import_count": {"type": "integer", "description": "Party size (default 1)"}},
               "required": ["name", "phone"]}))
register(Tool("UpdateGuest", Action.GUEST_WRITE, _h_update_guest,
              "Update a guest in this event (status, name, phone, group, table_number, notes, guest_count...). "
              "Identify the guest with guest_id (preferred, from SearchGuest) or guest_name.",
              {"type": "object", "properties": {
                  "guest_id": {"type": "string", "description": "Guest UUID from SearchGuest (preferred)"},
                  "guest_name": {"type": "string", "description": "Guest's name, used to find them when you don't have the id"},
                  "status": {"type": "string", "enum": ["invited", "confirmed", "declined", "maybe"],
                             "description": "invited = reset to 'not answered' (e.g. cancel a confirmation)"},
                  "name": {"type": "string", "description": "New name (rename the guest)"},
                  "phone": {"type": "string", "description": "New phone, international format +9725..."},
                  "group": {"type": "string", "description": "Guest group/side"},
                  "guest_count": {"type": "integer"},
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
              "This event's details: name, date, location, description, active state."))
register(Tool("UpdateEvent", Action.EVENT_WRITE, _h_update_event,
              "Update this event's name, description, location (venue/address) and/or event_date "
              "(date AND time live in event_date). Confirm with the user before changing the date - "
              "scheduled campaigns do not move automatically.",
              {"type": "object", "properties": {
                  "name": {"type": "string"},
                  "description": {"type": "string"},
                  "location": {"type": "string", "description": "Venue name and/or address, free text"},
                  "event_date": {"type": "string", "description": "ISO 8601 datetime with timezone offset"}}}))
register(Tool("ExportGuests", Action.GUEST_READ, _h_export_guests,
              "Full guest list with status, group and table assignment."))
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
register(Tool("PauseCampaign", Action.CAMPAIGN_WRITE, _h_pause_campaign,
              "Put a scheduled campaign on hold so it will NOT be sent. Confirm with the user first.",
              {"type": "object", "properties": {"campaign_id": {"type": "string"}},
               "required": ["campaign_id"]}))
register(Tool("TriggerCampaign", Action.CAMPAIGN_LAUNCH, _h_trigger_campaign,
              "Send a not-yet-sent campaign now (schedules it for immediate dispatch). "
              "Ask the user for explicit confirmation before calling this.",
              {"type": "object", "properties": {"campaign_id": {"type": "string"}},
               "required": ["campaign_id"]}))
