"""Admin Template Studio API - WhatsApp templates authored as JSON documents.

Storage: `custom_templates` (migrations.ensure_custom_templates); pure rules in
shared/domain/messaging/custom_templates.py. Admin-only, every write audited.

Lifecycle
    draft --submit--> pending --sync--> approved | rejected | paused | disabled

    `doc` is the working copy. Submitting sends it to Meta and snapshots it in
    `submitted_doc`. When Meta approves, that snapshot becomes `live` - the ONLY
    version that is ever delivered. Editing after a submission keeps `live`
    delivering; the edits are a new draft version (`version` + 1).

Re-submission decision (documented):
    * REJECTED (has a Meta id)  -> Meta's EDIT endpoint `POST /{meta_id}` with
      the new components, same name (Meta allows editing rejected templates).
    * APPROVED / PAUSED / DISABLED -> a NEW Meta template under a versioned name
      `<key>_v<N>`. We deliberately do NOT edit an approved template in place:
      an in-place edit sends it back to review (and is rate-limited by Meta),
      which would stall every campaign using it. With a versioned name the
      approved version keeps sending until the new one is approved, then `live`
      switches over atomically on /sync.
    * PENDING -> refused (409) until Meta decides.

Usage once approved
    guest stage groups -> offered in /catalog as `custom__<key>` and accepted by
                          the campaign gate; campaign-worker delivers `live`.
    flow               -> GET /admin/templates/approved feeds the flow
                          builder's resend_template picker.
    host               -> stored/submitted/approved only.
"""
from __future__ import annotations

import datetime as dt
import json
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import custom_templates_store as store
from app import messaging_state
from app.audit import record_audit
from app.db import get_db
from app.meta_templates import MetaTemplateClient
from shared.auth.admin import get_admin_user_id
from shared.domain.enums import ActorType
from shared.domain.messaging import (
    ALL_TEMPLATES, VariableResolver, build_meta_message, published_name,
)
from shared.domain.messaging import custom_templates as ct

router = APIRouter(prefix="/admin/templates", tags=["admin-templates"])

ENTITY = "custom_template"

# Meta review states -> our vocabulary.
_META_STATUS_MAP = {
    "approved": "approved", "reinstated": "approved",
    "pending": "pending", "in_appeal": "pending",
    "rejected": "rejected", "limit_exceeded": "rejected",
    "paused": "paused", "flagged": "paused",
    "disabled": "disabled", "deleted": "disabled", "pending_deletion": "disabled", "archived": "disabled",
}


def _map_status(value: Optional[str], default: str = "pending") -> str:
    return _META_STATUS_MAP.get((value or "").strip().lower(), default)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _iso(v: Any) -> Optional[str]:
    return v.isoformat() if hasattr(v, "isoformat") else (str(v) if v else None)


def _j(v: Any) -> Optional[str]:
    return None if v is None else json.dumps(v, ensure_ascii=False)


def _audit(db: Session, admin_id, action: str, data: Dict[str, Any]) -> None:
    record_audit(db, actor_type=ActorType.USER, actor_id=admin_id, action=f"{ENTITY}.{action}",
                 entity_type=ENTITY, data=data, commit=False)


# ---------------------------------------------------------------------------
# names / views
# ---------------------------------------------------------------------------

def _catalog_names() -> set:
    names = set()
    for t in ALL_TEMPLATES.values():
        names.add(t.key)
        if t.meta:
            names.add(t.meta.template_name)
        if t.meta_config:
            names.add(t.meta_config.name)
        try:
            names.add(published_name(t))
        except Exception:
            pass
    try:
        from shared.domain.messaging.system_templates import all_system_templates
        for st in all_system_templates().values():
            names.add(st.key)
            names.add(st.meta_name)
    except Exception:
        pass
    return names


def _reserved_names(db: Session, *, exclude_key: Optional[str] = None) -> set:
    names = _catalog_names()
    for r in db.execute(text("SELECT key, meta_name, live FROM custom_templates")).fetchall():
        if r.key == exclude_key:
            continue
        names.add(r.key)
        if r.meta_name:
            names.add(r.meta_name)
        live = ct.coerce_json(r.live)
        if isinstance(live, dict) and live.get("meta_name"):
            names.add(live["meta_name"])
    return names


def _view(row: Dict[str, Any], *, with_validation: bool = True) -> Dict[str, Any]:
    doc = ct.normalize_doc(row.get("doc"))
    live = row.get("live") if isinstance(row.get("live"), dict) else None
    submitted = row.get("submitted_doc")
    status = row.get("meta_status") or "draft"
    out = {
        "key": row["key"],
        "ref": ct.custom_ref(row["key"]),
        "doc": doc,
        "title": doc["title"],
        "group": doc["group"],
        "group_label": ct.GROUP_LABELS_HE.get(doc["group"], doc["group"]),
        "meta_name": row.get("meta_name"),
        "meta_id": row.get("meta_id"),
        "meta_status": status,
        "status_label": ct.STATUS_LABELS_HE.get(status, status),
        "rejection_reason": row.get("rejection_reason"),
        "version": int(row.get("version") or 1),
        "archived": bool(row.get("archived")),
        "submitted_at": _iso(row.get("submitted_at")),
        "last_sync": _iso(row.get("last_sync")),
        "created_at": _iso(row.get("created_at")),
        "updated_at": _iso(row.get("updated_at")),
        "updated_by": str(row["updated_by"]) if row.get("updated_by") else None,
        "has_unsubmitted_changes": bool(submitted) and not ct.docs_equal(doc, submitted),
        "submitted": bool(row.get("meta_name")),
        "live": None if not live else {
            "meta_name": live.get("meta_name"), "meta_id": live.get("meta_id"),
            "version": live.get("version"), "status": live.get("status"),
            "approved_at": live.get("approved_at"),
        },
        "deliverable": ct.live_of(row) is not None,
        "usable_in": _usable_in(row),
        "params": ct.param_hints(ct.normalize_doc((live or {}).get("doc")) if live else doc),
    }
    if with_validation:
        out["validation"] = ct.validate_doc(doc)
    return out


def _usable_in(row: Dict[str, Any]) -> List[str]:
    live = ct.live_of(row)
    if not live or row.get("archived"):
        return []
    group = ct.normalize_doc(live.get("doc"))["group"]
    if group in ct.GUEST_GROUPS:
        return ["campaigns", "flow"]
    return ["flow"] if group == ct.FLOW_GROUP else ["host"]


def _require(db: Session, key: str) -> Dict[str, Any]:
    row = store.get_row(db, key)
    if not row:
        raise HTTPException(404, "התבנית לא נמצאה")
    return row


def _catalog_listing(db: Session) -> List[Dict[str, Any]]:
    try:
        rows = messaging_state.get_row_map(db)
    except Exception:
        db.rollback()
        rows = {}
    out = []
    for t in ALL_TEMPLATES.values():
        r = rows.get(t.key)
        meta_status = (r.meta_status if r is not None and r.meta_status else
                       ("approved" if t.is_usable else "none"))
        out.append({
            "source": "catalog", "key": t.key, "title": t.title, "group": t.flow_stage.value,
            "group_label": ct.GROUP_LABELS_HE.get(t.flow_stage.value, t.flow_stage.value),
            "event_types": list(t.event_types), "body": t.body,
            "meta_name": t.meta.template_name if t.meta else published_name(t),
            "meta_status": meta_status, "sendable": t.is_usable,
            "placeholder": "[[" in (t.body or "") or "[[" in (t.title or ""),
        })
    return out


def _system_listing() -> List[Dict[str, Any]]:
    try:
        from shared.domain.messaging.system_templates import all_system_templates
        sts = all_system_templates()
    except Exception:
        return []
    return [{"source": "system", "key": st.key, "title": st.key, "group": ct.HOST_GROUP,
             "group_label": ct.GROUP_LABELS_HE[ct.HOST_GROUP], "event_types": [], "body": st.body,
             "meta_name": st.meta_name, "meta_status": "managed", "category": st.meta_category,
             "params": st.params} for st in sts.values()]


# ---------------------------------------------------------------------------
# write helpers
# ---------------------------------------------------------------------------

def _check_identity(db: Session, doc: Dict[str, Any], *, exclude_key: Optional[str]) -> None:
    """Name + title must be valid to store (the name is the table key). Other
    issues are allowed on a draft and reported; submit requires zero errors."""
    res = ct.validate_doc(doc, reserved_names=_reserved_names(db, exclude_key=exclude_key))
    blocking = [e for e in res["errors"] if e["field"] in ("name", "group")]
    if blocking:
        raise HTTPException(422, {"message": "validation_failed", "errors": blocking,
                                  "warnings": res["warnings"]})


def _insert(db: Session, doc: Dict[str, Any], admin_id) -> None:
    db.execute(text(
        "INSERT INTO custom_templates (key, doc, created_by, updated_by) "
        "VALUES (:k, CAST(:d AS jsonb), :by, :by)"),
        {"k": doc["name"], "d": _j(doc), "by": str(admin_id)})


def _promote_live(row: Dict[str, Any]) -> Dict[str, Any]:
    return {"meta_name": row.get("meta_name"), "meta_id": row.get("meta_id"),
            "doc": row.get("submitted_doc"), "version": int(row.get("version") or 1),
            "status": "approved", "approved_at": _now().isoformat()}


def _next_versioned_name(db: Session, row: Dict[str, Any]) -> str:
    key = row["key"]
    taken = _reserved_names(db, exclude_key=key)
    live = row.get("live") if isinstance(row.get("live"), dict) else {}
    taken |= {n for n in (row.get("meta_name"), live.get("meta_name"), key) if n}
    n = max(int(row.get("version") or 1), 2)
    while f"{key}_v{n}" in taken:
        n += 1
    return f"{key}_v{n}"


# ---------------------------------------------------------------------------
# read endpoints (static paths first)
# ---------------------------------------------------------------------------

@router.get("")
def list_templates(include_archived: bool = Query(True), db: Session = Depends(get_db),
                   admin_id: uuid.UUID = Depends(get_admin_user_id)):
    rows = store.list_rows(db, include_archived=include_archived)
    return {
        "templates": [_view(r) for r in rows],
        "catalog": _catalog_listing(db),
        "system": _system_listing(),
        "groups": [{"id": g, "label": ct.GROUP_LABELS_HE[g], "guest": g in ct.GUEST_GROUPS} for g in ct.GROUPS],
        "statuses": [{"id": s, "label": ct.STATUS_LABELS_HE[s]} for s in ct.STATUSES],
        "meta_configured": MetaTemplateClient().configured,
    }


@router.get("/variables")
def variables(admin_id: uuid.UUID = Depends(get_admin_user_id)):
    from shared.domain.messaging.event_types import EVENT_TYPES
    return {
        "variables": ct.variables_catalog(),
        "url_vars": [{"name": k, **v} for k, v in ct.BUTTON_URL_VARS.items()],
        "quick_reply_actions": [
            {"id": "rsvp_accepted", "label": "מאשר/ת הגעה"},
            {"id": "rsvp_declined", "label": "לא מגיע/ה"},
            {"id": "rsvp_maybe", "label": "עוד לא בטוח/ה"},
        ],
        "groups": [{"id": g, "label": ct.GROUP_LABELS_HE[g], "guest": g in ct.GUEST_GROUPS} for g in ct.GROUPS],
        "categories": list(ct.CATEGORIES),
        "statuses": [{"id": s, "label": ct.STATUS_LABELS_HE[s]} for s in ct.STATUSES],
        "event_types": [{"key": m.key.value, "name_he": m.name_he} for m in EVENT_TYPES.values()],
        "limits": ct.LIMITS,
    }


@router.get("/approved")
def approved(group: Optional[str] = Query(None), db: Session = Depends(get_db),
             admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Approved (live) templates for pickers - e.g. the flow builder's
    resend_template: Meta name, language and one hint per positional param."""
    out = []
    for row in store.list_rows(db, include_archived=False):
        live = ct.live_of(row)
        if not live:
            continue
        doc = ct.normalize_doc(live.get("doc"))
        if group and doc["group"] != group:
            continue
        body_only = doc["header"]["type"] == "none" or (
            doc["header"]["type"] == "text" and not ct.header_var(doc))
        body_only = body_only and not any(b.get("url_var") for b in doc["buttons"])
        out.append({
            "key": row["key"], "ref": ct.custom_ref(row["key"]), "title": doc["title"],
            "group": doc["group"], "group_label": ct.GROUP_LABELS_HE.get(doc["group"], doc["group"]),
            "name": live["meta_name"], "language": doc["language"], "body": doc["body"],
            "params": ct.param_hints(doc), "body_params_only": body_only,
        })
    out.sort(key=lambda t: (t["group"] != ct.FLOW_GROUP, t["title"]))
    return {"templates": out}


@router.get("/export")
def export(include_archived: bool = Query(True), db: Session = Depends(get_db),
           admin_id: uuid.UUID = Depends(get_admin_user_id)):
    docs = [ct.normalize_doc(r["doc"]) for r in store.list_rows(db, include_archived=include_archived)]
    docs.sort(key=lambda d: d["name"])
    stamp = _now().strftime("%Y%m%d-%H%M")
    return JSONResponse(content=docs, headers={
        "Content-Disposition": f'attachment; filename="showup-templates-{stamp}.json"'})


class ValidateIn(BaseModel):
    doc: Dict[str, Any]
    key: Optional[str] = Field(None, description="the template being edited (its own name is not 'taken')")


@router.post("/validate")
def validate(payload: ValidateIn = Body(...), db: Session = Depends(get_db),
             admin_id: uuid.UUID = Depends(get_admin_user_id)):
    res = ct.validate_doc(payload.doc, reserved_names=_reserved_names(db, exclude_key=payload.key))
    return {"valid": not res["errors"], **res,
            "suggested_name": ct.suggest_name(ct.normalize_doc(payload.doc)["title"],
                                              _reserved_names(db, exclude_key=payload.key))}


class PreviewIn(BaseModel):
    doc: Optional[Dict[str, Any]] = None
    key: Optional[str] = None
    event_id: Optional[str] = None
    guest_id: Optional[str] = None


@router.post("/preview")
def preview(payload: PreviewIn = Body(...), db: Session = Depends(get_db),
            admin_id: uuid.UUID = Depends(get_admin_user_id)):
    if payload.doc is None and not payload.key:
        raise HTTPException(400, "יש לשלוח doc או key")
    doc = ct.normalize_doc(payload.doc if payload.doc is not None else _require(db, payload.key)["doc"])
    from app.routers.messaging_admin import _sample_event, _sample_guest, _event_to_resolver_dict
    source = "sample"
    event_dict = _sample_event()
    guest = _sample_guest()
    if payload.event_id:
        from app.models.models import Event, Guest
        try:
            eid = uuid.UUID(str(payload.event_id))
        except ValueError:
            raise HTTPException(400, "מזהה אירוע לא תקין")
        ev = db.get(Event, eid)
        if not ev:
            raise HTTPException(404, "האירוע לא נמצא")
        event_dict = _event_to_resolver_dict(ev)
        event_dict["id"] = str(ev.id)
        event_dict["wa_image_url"] = getattr(ev, "wa_image_url", None)
        source = "event"
        if payload.guest_id:
            try:
                g = db.get(Guest, uuid.UUID(str(payload.guest_id)))
            except ValueError:
                g = None
            if not g or str(g.event_id) != str(ev.id):
                raise HTTPException(404, "האורח לא נמצא באירוע")
            guest = {"id": str(g.id), "name": g.name or "", "guest_count": g.guest_count,
                     "table_number": g.table_number}
    resolver = VariableResolver(event_dict)
    values = {**ct.sample_values(doc), **resolver.values_for(guest)} if source == "event" else ct.sample_values(doc)
    t = ct.template_from_doc(doc, key=doc["name"] or "preview", meta_name=doc["name"] or "preview",
                             deliverable=True)
    try:
        send_payload = build_meta_message(t, values, recipient="+972500000000", event_id=str(payload.event_id or "preview"),
                                          campaign_id="preview", guest_id=str(payload.guest_id or "preview"))
    except Exception:
        send_payload = None
    return {
        "source": source,
        "rendered": ct.render(doc, values),
        "values": values,
        "params": ct.param_hints(doc),
        "meta_create_payload": ct.build_create_payload(doc),
        "whatsapp_send_payload": send_payload,
        "validation": ct.validate_doc(doc, reserved_names=_reserved_names(db, exclude_key=payload.key or doc["name"])),
    }


class DuplicateIn(BaseModel):
    source: str = Field("custom", description="custom | catalog | system")
    source_key: str
    name: Optional[str] = None
    title: Optional[str] = None
    group: Optional[str] = None


@router.post("/duplicate")
def duplicate(payload: DuplicateIn = Body(...), db: Session = Depends(get_db),
              admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Copy any template (custom / catalog / system) into a NEW custom draft."""
    taken = _reserved_names(db)
    src = payload.source.strip().lower()
    if src == "custom":
        row = _require(db, payload.source_key)
        doc = ct.normalize_doc(row["doc"])
        doc["notes"] = (doc["notes"] + "\n" if doc["notes"] else "") + f"שוכפל מ-{row['key']}"
        base_title = f"{doc['title']} (עותק)"
    elif src == "catalog":
        t = ALL_TEMPLATES.get(payload.source_key)
        if not t:
            raise HTTPException(404, "תבנית הקטלוג לא נמצאה")
        doc = ct.doc_from_catalog_template(t, name="")
        base_title = f"{doc['title']} (עותק)"
    elif src == "system":
        from shared.domain.messaging.system_templates import get_system_template
        st = get_system_template(payload.source_key)
        if not st:
            raise HTTPException(404, "תבנית המערכת לא נמצאה")
        doc = ct.doc_from_system_template(st, name="")
        base_title = f"{st.key} (עותק)"
    else:
        raise HTTPException(400, "מקור לא מוכר")
    doc["title"] = (payload.title or base_title).strip()[: ct.LIMITS["title"]]
    if payload.group:
        doc["group"] = payload.group
    doc["name"] = (payload.name or "").strip() or ct.suggest_name(f"{payload.source_key}_copy", taken)
    _check_identity(db, doc, exclude_key=None)
    try:
        _insert(db, doc, admin_id)
        _audit(db, admin_id, "duplicate", {"key": doc["name"], "source": src, "source_key": payload.source_key})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "כבר קיימת תבנית בשם הזה")
    return _view(store.get_row(db, doc["name"]))


@router.post("/import")
def import_templates(payload: Any = Body(...), db: Session = Depends(get_db),
                     admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Upsert drafts from a JSON array (or {templates: [...], dry_run}). A
    template that was ever submitted to Meta is NEVER overwritten - it is
    reported as a conflict."""
    if isinstance(payload, list):
        items, dry_run = payload, False
    elif isinstance(payload, dict) and isinstance(payload.get("templates"), list):
        items, dry_run = payload["templates"], bool(payload.get("dry_run"))
    else:
        raise HTTPException(400, "יש לשלוח מערך JSON של תבניות")
    if len(items) > 500:
        raise HTTPException(400, "אפשר לייבא עד 500 תבניות בפעם אחת")
    catalog_names = _catalog_names()
    results: List[Dict[str, Any]] = []
    seen: set = set()
    for i, raw in enumerate(items):
        doc = ct.normalize_doc(raw)
        name = doc["name"]
        res = ct.validate_doc(doc, reserved_names=catalog_names)
        ident = [e for e in res["errors"] if e["field"] in ("name", "group")]
        if ident or name in seen:
            results.append({"index": i, "name": name or None, "action": "error",
                            "errors": ident or [{"field": "name", "code": "duplicate", "message": "השם מופיע פעמיים בקובץ"}]})
            continue
        seen.add(name)
        row = store.get_row(db, name)
        if row is not None and (row.get("meta_name") or row.get("live")):
            results.append({"index": i, "name": name, "action": "conflict",
                            "reason": "התבנית כבר נשלחה ל-Meta ולא נדרסה. שכפלו אותה או ערכו ידנית."})
            continue
        if row is not None and ct.docs_equal(row["doc"], doc):
            results.append({"index": i, "name": name, "action": "unchanged"})
            continue
        action = "updated" if row is not None else "created"
        if not dry_run:
            if row is None:
                _insert(db, doc, admin_id)
            else:
                db.execute(text("UPDATE custom_templates SET doc = CAST(:d AS jsonb), updated_at = now(), "
                                "updated_by = :by WHERE key = :k"), {"d": _j(doc), "by": str(admin_id), "k": name})
        results.append({"index": i, "name": name, "action": action, "issues": len(res["errors"])})
    counts = {a: sum(1 for r in results if r["action"] == a)
              for a in ("created", "updated", "unchanged", "conflict", "error")}
    if not dry_run:
        _audit(db, admin_id, "import", {"counts": counts})
        db.commit()
    return {"dry_run": dry_run, "counts": counts, "results": results}


@router.post("/sync")
def sync_all(db: Session = Depends(get_db), admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Refresh Meta review status for every submitted template that can still
    change (pending / approved / paused) and every live version."""
    client = MetaTemplateClient()
    if not client.configured:
        raise HTTPException(400, "Meta לא מוגדר בשרת (WA_WABA_ID / WA_API_B)")
    results = []
    for row in store.list_rows(db):
        if not row.get("meta_name"):
            continue
        if row.get("meta_status") not in ("pending", "approved", "paused") and not row.get("live"):
            continue
        results.append(_sync_row(db, client, row))
    _audit(db, admin_id, "sync", {"count": len(results)})
    db.commit()
    return {"synced": sum(1 for r in results if r.get("ok")), "results": results}


# ---------------------------------------------------------------------------
# create / item endpoints
# ---------------------------------------------------------------------------

class CreateIn(BaseModel):
    doc: Dict[str, Any]


@router.post("")
def create(payload: CreateIn = Body(...), db: Session = Depends(get_db),
           admin_id: uuid.UUID = Depends(get_admin_user_id)):
    doc = ct.normalize_doc(payload.doc)
    if not doc["name"] and doc["title"]:
        doc["name"] = ct.suggest_name(doc["title"], _reserved_names(db))
    _check_identity(db, doc, exclude_key=None)
    try:
        _insert(db, doc, admin_id)
        _audit(db, admin_id, "create", {"key": doc["name"], "group": doc["group"]})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "כבר קיימת תבנית בשם הזה")
    return _view(store.get_row(db, doc["name"]))


@router.get("/{key}")
def get_template(key: str, db: Session = Depends(get_db), admin_id: uuid.UUID = Depends(get_admin_user_id)):
    row = _require(db, key)
    view = _view(row)
    view["meta_create_payload"] = ct.build_create_payload(row["doc"])
    view["submitted_doc"] = row.get("submitted_doc")
    view["live_doc"] = (row.get("live") or {}).get("doc") if isinstance(row.get("live"), dict) else None
    return view


class UpdateIn(BaseModel):
    doc: Dict[str, Any]
    expected_updated_at: Optional[str] = Field(None, description="optimistic concurrency (updated_at the edit began from)")


@router.put("/{key}")
def update(key: str, payload: UpdateIn = Body(...), db: Session = Depends(get_db),
           admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Save the working copy. Renaming is allowed only before the first
    submission. Editing a submitted template opens a new draft version; the
    approved (live) version keeps delivering until the new one is approved."""
    row = _require(db, key)
    if payload.expected_updated_at and _iso(row.get("updated_at")) != payload.expected_updated_at:
        raise HTTPException(409, "התבנית השתנתה מאז שנפתחה - יש לרענן ולנסות שוב")
    doc = ct.normalize_doc(payload.doc)
    doc["name"] = doc["name"] or key
    submitted = bool(row.get("meta_name") or row.get("live"))
    new_key = doc["name"]
    if new_key != key and submitted:
        raise HTTPException(409, "אי אפשר לשנות שם לתבנית שכבר נשלחה ל-Meta. שכפלו אותה לשם חדש.")
    _check_identity(db, doc, exclude_key=key)
    version = int(row.get("version") or 1)
    sub = row.get("submitted_doc")
    if sub is not None and ct.docs_equal(row["doc"], sub) and not ct.docs_equal(doc, sub):
        version += 1   # first edit after a submission -> a new draft version
    try:
        db.execute(text(
            "UPDATE custom_templates SET key = :nk, doc = CAST(:d AS jsonb), version = :v, updated_at = now(), "
            "updated_by = :by WHERE key = :k"),
            {"nk": new_key, "d": _j(doc), "v": version, "by": str(admin_id), "k": key})
        _audit(db, admin_id, "update", {"key": new_key, "renamed_from": key if new_key != key else None,
                                        "version": version})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "כבר קיימת תבנית בשם הזה")
    return _view(store.get_row(db, new_key))


class GroupIn(BaseModel):
    group: str


@router.post("/{key}/group")
def change_group(key: str, payload: GroupIn = Body(...), db: Session = Depends(get_db),
                 admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Move a template between groups. Routing only (not Meta content), so it
    also applies to the live version: an approved template can be moved from
    `flow` to `invitation` without resubmitting."""
    row = _require(db, key)
    if payload.group not in ct.GROUPS:
        raise HTTPException(422, "קבוצה לא מוכרת")
    doc = ct.normalize_doc(row["doc"])
    old = doc["group"]
    doc["group"] = payload.group
    params: Dict[str, Any] = {"d": _j(doc), "by": str(admin_id), "k": key}
    sets = ["doc = CAST(:d AS jsonb)"]
    for col in ("submitted_doc", "live"):
        val = row.get(col)
        if isinstance(val, dict):
            val = dict(val)
            if col == "live":
                ld = ct.normalize_doc(val.get("doc"))
                ld["group"] = payload.group
                val["doc"] = ld
            else:
                val = {**ct.normalize_doc(val), "group": payload.group}
            sets.append(f"{col} = CAST(:{col} AS jsonb)")
            params[col] = _j(val)
    db.execute(text(f"UPDATE custom_templates SET {', '.join(sets)}, updated_at = now(), updated_by = :by "
                    "WHERE key = :k"), params)
    _audit(db, admin_id, "group", {"key": key, "from": old, "to": payload.group})
    db.commit()
    return _view(store.get_row(db, key))


class ArchiveIn(BaseModel):
    archived: bool = True


@router.post("/{key}/archive")
def archive(key: str, payload: ArchiveIn = Body(...), db: Session = Depends(get_db),
            admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Archived templates are hidden from the wizard and pickers. Campaigns that
    already reference one keep delivering its approved version."""
    _require(db, key)
    db.execute(text("UPDATE custom_templates SET archived = :a, updated_at = now(), updated_by = :by WHERE key = :k"),
               {"a": payload.archived, "by": str(admin_id), "k": key})
    _audit(db, admin_id, "archive" if payload.archived else "unarchive", {"key": key})
    db.commit()
    return _view(store.get_row(db, key))


@router.delete("/{key}")
def delete(key: str, db: Session = Depends(get_db), admin_id: uuid.UUID = Depends(get_admin_user_id)):
    row = _require(db, key)
    if row.get("meta_name") or row.get("live"):
        raise HTTPException(409, "אפשר למחוק רק טיוטה שלא נשלחה ל-Meta. אפשר להעביר לארכיון.")
    db.execute(text("DELETE FROM custom_templates WHERE key = :k"), {"k": key})
    _audit(db, admin_id, "delete", {"key": key})
    db.commit()
    return {"deleted": key}


class SubmitIn(BaseModel):
    dry_run: bool = False


@router.post("/{key}/submit")
def submit(key: str, payload: Optional[SubmitIn] = Body(None), db: Session = Depends(get_db),
           admin_id: uuid.UUID = Depends(get_admin_user_id)):
    payload = payload or SubmitIn()
    row = _require(db, key)
    doc = ct.normalize_doc(row["doc"])
    doc["name"] = key
    res = ct.validate_doc(doc, reserved_names=_reserved_names(db, exclude_key=key))
    if res["errors"]:
        raise HTTPException(422, {"message": "validation_failed", "errors": res["errors"],
                                  "warnings": res["warnings"]})
    status = row.get("meta_status") or "draft"
    if status == "pending" and not payload.dry_run:
        raise HTTPException(409, "התבנית ממתינה לאישור Meta - אפשר לשלוח שוב רק אחרי שתתקבל החלטה")
    if status == "approved" and ct.docs_equal(doc, row.get("submitted_doc")):
        raise HTTPException(409, "אין שינויים לשליחה - הגרסה הזו כבר מאושרת")

    if not row.get("meta_name"):
        mode, name = "create", key
    elif status == "rejected" and row.get("meta_id"):
        mode, name = "edit", row["meta_name"]
    elif status in ("rejected", "draft", "pending"):
        mode, name = "create", row["meta_name"]
    else:  # approved / paused / disabled -> new versioned Meta template
        mode, name = "create", _next_versioned_name(db, row)

    client = MetaTemplateClient()
    handle = None
    if ct.needs_header_handle(doc) and not payload.dry_run and client.configured:
        handle = client.upload_header_handle(doc["header"]["url"])
        if not handle:
            raise HTTPException(502, "העלאת תמונת הדוגמה ל-Meta נכשלה. בדקו שהקישור לתמונה פתוח ונסו שוב.")
    meta_payload = (ct.build_edit_payload(doc, header_handle=handle) if mode == "edit"
                    else ct.build_create_payload(doc, name=name, header_handle=handle))

    if payload.dry_run:
        return {"dry_run": True, "ok": True, "mode": mode, "meta_name": name, "meta_payload": meta_payload,
                "meta_configured": client.configured, "warnings": res["warnings"]}

    result = (client.edit_template(row["meta_id"], meta_payload) if mode == "edit"
              else client.create_template(meta_payload))
    if result.ok:
        new_status = _map_status(result.meta_status)
        upd = {"meta_name": name, "meta_id": result.meta_id or (row.get("meta_id") if mode == "edit" else None),
               "meta_status": new_status, "rejection_reason": None, "submitted_doc": doc}
    else:
        upd = {"meta_name": name, "meta_id": row.get("meta_id") if mode == "edit" else None,
               "meta_status": "rejected", "rejection_reason": result.rejection_reason or result.error,
               "submitted_doc": doc}
    live = row.get("live") if isinstance(row.get("live"), dict) else None
    if result.ok and upd["meta_status"] == "approved":
        live = _promote_live({**row, **upd})
    try:
        db.execute(text(
            "UPDATE custom_templates SET doc = CAST(:d AS jsonb), meta_name = :mn, meta_id = :mid, meta_status = :ms, "
            "rejection_reason = :rr, submitted_doc = CAST(:sd AS jsonb), submitted_at = now(), "
            "live = CAST(:live AS jsonb), updated_at = now(), updated_by = :by WHERE key = :k"),
            {"d": _j(doc), "mn": upd["meta_name"], "mid": upd["meta_id"], "ms": upd["meta_status"],
             "rr": upd["rejection_reason"], "sd": _j(doc), "live": _j(live), "by": str(admin_id), "k": key})
        _audit(db, admin_id, "submit", {"key": key, "mode": mode, "meta_name": name, "ok": result.ok,
                                        "simulated": result.simulated, "status": upd["meta_status"],
                                        "error": result.error})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "שם התבנית ב-Meta כבר תפוס")
    return {"dry_run": False, "ok": result.ok, "simulated": result.simulated, "mode": mode, "meta_name": name,
            "error": None if result.ok else (result.rejection_reason or result.error),
            "meta_configured": client.configured, "template": _view(store.get_row(db, key))}


def _sync_row(db: Session, client: MetaTemplateClient, row: Dict[str, Any]) -> Dict[str, Any]:
    key = row["key"]
    out: Dict[str, Any] = {"key": key}
    res = client.fetch_status(row["meta_name"])
    live = dict(row["live"]) if isinstance(row.get("live"), dict) else None
    if not res.ok:
        out.update(ok=False, error=res.error)
        return out
    status = _map_status(res.meta_status, default=row.get("meta_status") or "pending")
    merged = {**row, "meta_id": res.meta_id or row.get("meta_id"), "meta_status": status}
    if status == "approved":
        if not live or live.get("meta_name") != row["meta_name"] or live.get("status") != "approved" \
                or not ct.docs_equal(live.get("doc"), row.get("submitted_doc")):
            live = _promote_live(merged)
    elif live and live.get("meta_name") == row["meta_name"]:
        live["status"] = status   # the LIVE template itself was paused/disabled
    if live and live.get("meta_name") and live["meta_name"] != row["meta_name"]:
        lres = client.fetch_status(live["meta_name"])
        if lres.ok:
            live["status"] = _map_status(lres.meta_status, default=live.get("status") or "approved")
    db.execute(text(
        "UPDATE custom_templates SET meta_id = :mid, meta_status = :ms, rejection_reason = :rr, "
        "live = CAST(:live AS jsonb), last_sync = now() WHERE key = :k"),
        {"mid": merged["meta_id"], "ms": status,
         "rr": res.rejection_reason if status == "rejected" else None,
         "live": _j(live), "k": key})
    out.update(ok=True, meta_status=status, live_status=(live or {}).get("status"))
    return out


@router.post("/{key}/sync")
def sync_one(key: str, db: Session = Depends(get_db), admin_id: uuid.UUID = Depends(get_admin_user_id)):
    row = _require(db, key)
    if not row.get("meta_name"):
        raise HTTPException(409, "התבנית עוד לא נשלחה ל-Meta")
    client = MetaTemplateClient()
    if not client.configured:
        raise HTTPException(400, "Meta לא מוגדר בשרת (WA_WABA_ID / WA_API_B)")
    res = _sync_row(db, client, row)
    _audit(db, admin_id, "sync", {"key": key, **res})
    db.commit()
    if not res.get("ok"):
        raise HTTPException(502, f"לא הצלחנו לקבל סטטוס מ-Meta ({res.get('error')})")
    return _view(store.get_row(db, key))
