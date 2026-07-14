"""Admin-only Messaging publishing API (core-service) - Meta template management.

Content-management infrastructure ONLY. It never touches the planner, workers, or
the message send flow (`meta_adapter`/outpost). It manages template DEFINITIONS on
Meta and the workflow/state around them:

    GET  /admin/messaging/templates            list + merged mgmt view
    GET  /admin/messaging/templates/{key}      one template + Meta create payload
    POST /admin/messaging/templates/{key}/status   move internal workflow status
    POST /admin/messaging/preview              QA: exact WA send + Meta create payload
    POST /admin/messaging/publish              push to Meta (one/all/stage/event-type)
    POST /admin/messaging/sync                 refresh Meta review status

The catalog YAML stays pure authored content; all mutable state is written to the
`messaging_template_state` DB table. WhatsApp only (no channel abstraction).
"""
from __future__ import annotations

import os
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.models import Event
from app import messaging_state
from app.meta_templates import MetaTemplateClient
from app.audit import record_audit
from shared.auth.admin import get_admin_user_id
from shared.domain.enums import ActorType
from shared.domain.messaging import (
    ALL_TEMPLATES,
    VariableResolver,
    build_meta_message,
    build_create_payload,
    compute_checksum,
    select_templates,
    published_name,
    has_placeholder,
    can_transition,
    InternalStatus,
    MetaStatus,
    PUBLISHABLE_STATUSES,
    VARIABLES,
    TemplateCategory,
    validate_catalog,
)
from shared.domain.messaging.resolver import DEFAULT_HEADER_IMAGE_PATH

router = APIRouter(prefix="/admin/messaging", tags=["messaging-admin"])


# --------------------------------------------------------------------------- #
# Request models
# --------------------------------------------------------------------------- #

class StatusUpdate(BaseModel):
    status: str


class PreviewRequest(BaseModel):
    key: str
    event_id: Optional[str] = None      # preview against a real event; else sample
    recipient: Optional[str] = None     # sample recipient for the send payload


class PublishRequest(BaseModel):
    scope: str = "all"                  # one | all | stage | event_type
    key: Optional[str] = None           # scope=one
    stage: Optional[str] = None         # scope=stage
    event_type: Optional[str] = None    # scope=event_type (=> all; no event-type locks)
    only_changed: bool = True           # publish only templates whose content changed
    force: bool = False                 # bypass the approved_internal gate
    dry_run: bool = True                # simulate; do not call Meta or write state


class SyncRequest(BaseModel):
    scope: str = "all"
    key: Optional[str] = None
    stage: Optional[str] = None


class PromoteRequest(BaseModel):
    scope: str = "all"                  # one | all | stage | event_type
    key: Optional[str] = None
    stage: Optional[str] = None


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _sample_event(event_type: str = "wedding") -> dict:
    """A synthetic event built from the canonical variable samples, for QA when no
    real event is supplied."""
    return {
        "name": VARIABLES["event_name"].sample,
        "event_date": "2025-12-03T19:30:00",
        "location": VARIABLES["venue_name"].sample,
        "event_type": event_type,
        "inviters": [{"fn": "אור", "ln": "כהן"}],
        "public_slug": "demo",
        "subjects": {"p1": "נועה", "p2": "יונתן", "role1": "bride", "role2": "groom",
                     "parent1": "שרה", "parent2": "יעקב", "honoree": "אברהם", "company": "אקמה"},
    }


def _sample_guest() -> dict:
    return {"name": VARIABLES["guest_name"].sample, "guest_count": 2, "table_number": 12}


def _event_to_resolver_dict(ev: Event) -> dict:
    return {
        "name": ev.name,
        "event_date": ev.event_date.isoformat() if ev.event_date else "",
        "location": ev.location or "",
        "event_type": ev.event_type,
        "inviters": ev.inviters or [],
        "public_slug": ev.public_slug,
        "subjects": ev.subjects or {},
    }


def _require_template(key: str):
    # Look up across the whole repository (event-type production templates + base).
    t = ALL_TEMPLATES.get((key or "").strip())
    if not t:
        raise HTTPException(status_code=404, detail=f"template '{key}' not found")
    return t


# --------------------------------------------------------------------------- #
# Read
# --------------------------------------------------------------------------- #

@router.get("/validate")
def validate(_admin=Depends(get_admin_user_id)):
    """Structural validation of the content catalog (QA gate before writing/publishing
    production copy). Returns the list of problems; `ok` is true when empty."""
    errors = validate_catalog()
    return {"ok": not errors, "error_count": len(errors), "errors": errors}


@router.get("/templates")
def list_templates(db: Session = Depends(get_db), _admin=Depends(get_admin_user_id)):
    # The management view lists the PRODUCTION event-type catalog (what gets
    # published), through the SAME selector every other endpoint uses.
    rows = messaging_state.get_row_map(db)
    views = [messaging_state.effective(t, rows.get(t.key)) for t in select_templates("all")]
    return {
        "count": len(views),
        "changed": sum(1 for v in views if v["changed"]),
        "meta_configured": MetaTemplateClient().configured,
        "internal_statuses": [s.value for s in InternalStatus],
        "meta_statuses": [s.value for s in MetaStatus],
        "templates": views,
    }


@router.get("/templates/{key}")
def get_template(key: str, db: Session = Depends(get_db), _admin=Depends(get_admin_user_id)):
    t = _require_template(key)
    view = messaging_state.effective(t, messaging_state.get_row(db, key))
    view["create_payload"] = build_create_payload(t)
    return view


# --------------------------------------------------------------------------- #
# Internal workflow status
# --------------------------------------------------------------------------- #

@router.post("/templates/{key}/status")
def set_status(key: str, body: StatusUpdate, db: Session = Depends(get_db),
               admin=Depends(get_admin_user_id)):
    t = _require_template(key)
    try:
        target = InternalStatus(body.status)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"unknown status '{body.status}'")

    current = messaging_state.effective(t, messaging_state.get_row(db, key))["internal_status"]
    if not can_transition(current, target.value):
        raise HTTPException(status_code=409,
                            detail=f"illegal transition {current} → {target.value}")
    messaging_state.upsert(db, key, internal_status=target.value)
    record_audit(db, actor_type=ActorType.USER, actor_id=admin,
                 action="messaging.status", entity_type="messaging_template",
                 data={"key": key, "from": current, "to": target.value}, commit=False)
    db.commit()
    return messaging_state.effective(t, messaging_state.get_row(db, key))


# --------------------------------------------------------------------------- #
# QA preview - the EXACT payload that would be sent to Meta/WhatsApp
# --------------------------------------------------------------------------- #

@router.post("/preview")
def preview(body: PreviewRequest, db: Session = Depends(get_db),
            _admin=Depends(get_admin_user_id)):
    t = _require_template(body.key)

    if body.event_id:
        try:
            eid = uuid.UUID(str(body.event_id))
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid event_id")
        ev = db.get(Event, eid)
        if not ev:
            raise HTTPException(status_code=404, detail="event not found")
        event_dict = _event_to_resolver_dict(ev)
        source = "event"
    else:
        event_dict = _sample_event()
        source = "sample"

    resolver = VariableResolver(event_dict)
    values = resolver.values_for(_sample_guest())

    send_payload = None
    if t.meta:
        send_payload = build_meta_message(
            t, values, recipient=(body.recipient or "+972500000000"),
            event_id=str(body.event_id or "preview"), campaign_id="preview", guest_id="preview",
        )

    return {
        "key": t.key,
        "source": source,                         # 'event' or 'sample'
        "resolved_variables": values,             # every variable resolved
        "whatsapp_send_payload": send_payload,    # exact outpost/Meta send payload (null if no Meta mapping yet)
        "meta_create_payload": build_create_payload(t),  # exact Meta template CREATE payload
        "rendered_body": resolver.render_body(t.body, _sample_guest()),
    }


# --------------------------------------------------------------------------- #
# Publish to Meta
# --------------------------------------------------------------------------- #

@router.post("/promote")
def promote(body: PromoteRequest, db: Session = Depends(get_db),
            admin=Depends(get_admin_user_id)):
    """Bulk-move templates to `approved_internal` so they can be published. Admin
    override - skips already-approved/published and deprecated templates. Use before
    a full publish run instead of promoting each template one at a time."""
    targets = select_templates(body.scope, key=body.key, stage=body.stage)
    if body.scope == "one" and not targets:
        raise HTTPException(status_code=404, detail=f"template '{body.key}' not found")
    rows = messaging_state.get_row_map(db)
    results: List[dict] = []
    for t in targets:
        cur = messaging_state.effective(t, rows.get(t.key))["internal_status"]
        if cur in (InternalStatus.APPROVED_INTERNAL.value, InternalStatus.PUBLISHED.value):
            results.append({"key": t.key, "action": "skipped", "reason": f"already {cur}"})
            continue
        if cur == InternalStatus.DEPRECATED.value:
            results.append({"key": t.key, "action": "skipped", "reason": "deprecated"})
            continue
        messaging_state.upsert(db, t.key, internal_status=InternalStatus.APPROVED_INTERNAL.value)
        results.append({"key": t.key, "action": "promoted", "from": cur})
    record_audit(db, actor_type=ActorType.USER, actor_id=admin, action="messaging.promote",
                 entity_type="messaging_template", data={"scope": body.scope}, commit=False)
    db.commit()
    return {"promoted": sum(1 for r in results if r["action"] == "promoted"),
            "total": len(results), "results": results}


@router.post("/publish")
def publish(body: PublishRequest, db: Session = Depends(get_db),
            admin=Depends(get_admin_user_id)):
    targets = select_templates(body.scope, key=body.key, stage=body.stage,
                               event_type=body.event_type)
    if body.scope == "one" and not targets:
        raise HTTPException(status_code=404, detail=f"template '{body.key}' not found")

    client = MetaTemplateClient()
    rows = messaging_state.get_row_map(db)
    results: List[dict] = []

    # IMAGE-header templates need an uploaded media handle (not a URL). Upload one
    # representative image once and reuse the handle for every image template.
    header_handle: Optional[str] = None
    _header_uploaded = False
    _sample_header_url = (os.getenv("WA_SAMPLE_HEADER_URL")
                          or (os.getenv("MEDIA_S3_URL", "") + DEFAULT_HEADER_IMAGE_PATH))

    def _needs_image_header(tpl) -> bool:
        return tpl.category == TemplateCategory.WITH_IMAGE or bool(tpl.meta and tpl.meta.header_image_var)

    for t in targets:
        view = messaging_state.effective(t, rows.get(t.key))
        live = view["content_checksum"]

        # gate 0: never publish placeholder copy ([[body]]/[[title]]).
        if has_placeholder(t):
            results.append({"key": t.key, "action": "skipped",
                            "reason": "placeholder - copy not authored yet"})
            continue
        # gate 1: internal review must have cleared (unless forced)
        if not body.force and view["internal_status"] not in [s.value for s in PUBLISHABLE_STATUSES]:
            results.append({"key": t.key, "action": "skipped",
                            "reason": f"internal_status={view['internal_status']} (needs approved_internal)"})
            continue
        # gate 2: only changed
        if body.only_changed and not view["changed"]:
            results.append({"key": t.key, "action": "skipped", "reason": "unchanged"})
            continue

        # For a REAL publish of an image template, obtain the header handle once.
        if _needs_image_header(t) and not body.dry_run and client.configured and not _header_uploaded:
            header_handle = client.upload_header_handle(_sample_header_url)
            _header_uploaded = True

        payload = build_create_payload(t, header_handle=header_handle if _needs_image_header(t) else None)
        res = client.create_template(payload, dry_run=body.dry_run)

        if not res.ok:
            # persist the failure (rejection reason / error) unless dry-run
            if not body.dry_run:
                messaging_state.upsert(
                    db, t.key, meta_status=res.meta_status, last_sync=messaging_state.now_utc(),
                    rejection_reason=res.rejection_reason,
                )
            results.append({"key": t.key, "action": "failed",
                            "reason": res.rejection_reason or res.error, "simulated": res.simulated})
            continue

        if body.dry_run:
            results.append({"key": t.key, "action": "would_publish", "simulated": True,
                            "meta_create_payload": payload})
            continue

        # success → record the published snapshot + Meta state
        published_version = (view["published_version"] or 0) + 1
        messaging_state.upsert(
            db, t.key,
            internal_status=InternalStatus.PUBLISHED.value,
            meta_id=res.meta_id or (rows.get(t.key).meta_id if rows.get(t.key) else None),
            meta_status=res.meta_status,
            meta_category=res.category or payload["category"],
            uploaded_at=messaging_state.now_utc(),
            last_sync=messaging_state.now_utc(),
            rejection_reason=None,
            published_checksum=live,
            published_version=published_version,
        )
        results.append({"key": t.key, "action": "published", "simulated": res.simulated,
                        "meta_status": res.meta_status, "version": published_version})

    if not body.dry_run:
        record_audit(db, actor_type=ActorType.USER, actor_id=admin,
                     action="messaging.publish", entity_type="messaging_template",
                     data={"scope": body.scope, "results": results}, commit=False)
        db.commit()

    published = sum(1 for r in results if r["action"] == "published")
    return {
        "scope": body.scope, "dry_run": body.dry_run,
        "meta_configured": client.configured,
        "total": len(results), "published": published, "results": results,
    }


# --------------------------------------------------------------------------- #
# Sync review status from Meta
# --------------------------------------------------------------------------- #

@router.post("/sync")
def sync(body: SyncRequest, db: Session = Depends(get_db), admin=Depends(get_admin_user_id)):
    client = MetaTemplateClient()
    if not client.configured:
        raise HTTPException(status_code=400, detail="Meta not configured (WA_WABA_ID/WA_API_B)")

    targets = select_templates(body.scope, key=body.key, stage=body.stage)
    rows = messaging_state.get_row_map(db)
    results: List[dict] = []
    for t in targets:
        row = rows.get(t.key)
        # only sync templates we've actually pushed to Meta (have a row + are published)
        if row is None or row.internal_status != InternalStatus.PUBLISHED.value:
            results.append({"key": t.key, "action": "skipped", "reason": "not published"})
            continue
        name = published_name(t)
        res = client.fetch_status(name)
        if not res.ok:
            results.append({"key": t.key, "action": "failed", "reason": res.error})
            continue
        messaging_state.upsert(db, t.key, meta_id=res.meta_id, meta_status=res.meta_status,
                               meta_category=res.category, rejection_reason=res.rejection_reason,
                               last_sync=messaging_state.now_utc())
        results.append({"key": t.key, "action": "synced", "meta_status": res.meta_status})

    record_audit(db, actor_type=ActorType.USER, actor_id=admin, action="messaging.sync",
                 entity_type="messaging_template", data={"scope": body.scope}, commit=False)
    db.commit()
    return {"synced": sum(1 for r in results if r["action"] == "synced"), "results": results}
