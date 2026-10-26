"""Admin: guest WhatsApp RSVP conversation flow settings.

Storage: conversation_flow_configs (migrations.ensure_conversation_flow_configs).
Each row is one saved VERSION of a scope's SPARSE override; one active row per
(scope, scope_key). Logic (schema, defaults, merge, preview) lives in
shared/domain/flow_config.py so webhook-worker reads exactly what is saved here.

Scopes: global/default -> event_type/<type> -> event/<uuid>.
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import record_audit
from app.db import get_db
from shared.auth.admin import get_admin_user_id
from shared.domain import flow_config as fc
from shared.domain.enums import ActorType

router = APIRouter(prefix="/admin/flows", tags=["admin-flows"])

_T = fc.TABLE


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _check_scope(db: Session, scope: str, key: str) -> Dict[str, Any]:
    """Validate (scope, key); return {"event_type": ..., "event_id": ...} context."""
    if scope == fc.SCOPE_GLOBAL:
        if key != fc.GLOBAL_KEY:
            raise HTTPException(404, "unknown global key")
        return {"event_type": "", "event_id": ""}
    if scope == fc.SCOPE_EVENT_TYPE:
        if key not in fc.EVENT_TYPE_KEYS:
            raise HTTPException(404, "unknown event type")
        return {"event_type": key, "event_id": ""}
    if scope == fc.SCOPE_EVENT:
        try:
            eid = str(uuid.UUID(key))
        except ValueError:
            raise HTTPException(404, "event key must be a uuid")
        row = db.execute(text("SELECT event_type, name FROM events WHERE id = CAST(:id AS uuid)"),
                         {"id": eid}).first()
        if not row:
            raise HTTPException(404, "event not found")
        return {"event_type": fc.normalize_event_type(row.event_type), "event_id": eid, "event_name": row.name}
    raise HTTPException(404, "unknown scope")


def _active(db: Session, scope: str, key: str) -> Optional[Any]:
    return db.execute(
        text(f"SELECT id, config, version, created_at, created_by, note FROM {_T} "
             "WHERE scope = :s AND scope_key = :k AND is_active"),
        {"s": scope, "k": key},
    ).first()


def _active_override(db: Session, scope: str, key: str) -> Dict[str, Any]:
    row = _active(db, scope, key)
    return (fc.coerce_json(row.config) or {}) if row else {}


def _parent_overrides(db: Session, scope: str, ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Stored overrides of the layers BELOW `scope` (what it inherits)."""
    parents: List[Dict[str, Any]] = []
    if scope in (fc.SCOPE_EVENT_TYPE, fc.SCOPE_EVENT):
        parents.append(_active_override(db, fc.SCOPE_GLOBAL, fc.GLOBAL_KEY))
    if scope == fc.SCOPE_EVENT and ctx.get("event_type"):
        parents.append(_active_override(db, fc.SCOPE_EVENT_TYPE, ctx["event_type"]))
    return parents


def _iso(v: Any) -> Optional[str]:
    return v.isoformat() if hasattr(v, "isoformat") else (str(v) if v else None)


def _scope_payload(db: Session, scope: str, key: str, ctx: Dict[str, Any]) -> Dict[str, Any]:
    row = _active(db, scope, key)
    override = (fc.coerce_json(row.config) or {}) if row else {}
    parents = _parent_overrides(db, scope, ctx)
    inherited = fc.merge_layers(*parents)
    effective = fc.merge_layers(*parents, override)
    # Which fields were changed by an inherited (non-default) layer.
    parent_paths = sorted({p for o in parents for p in fc.override_paths(o)})
    return {
        "scope": scope,
        "scope_key": key,
        "context": ctx,
        "version": row.version if row else None,
        "updated_at": _iso(row.created_at) if row else None,
        "updated_by": str(row.created_by) if row and row.created_by else None,
        "note": row.note if row else None,
        "override": override,
        "changed_paths": fc.override_paths(override),
        "inherited": inherited,
        "inherited_changed_paths": parent_paths,
        "effective": effective,
        "defaults": fc.DEFAULT_FLOW,
    }


def _save_version(db: Session, scope: str, key: str, config: Dict[str, Any], admin_id: uuid.UUID,
                  note: Optional[str], action: str) -> int:
    try:
        db.execute(text(f"UPDATE {_T} SET is_active = false WHERE scope = :s AND scope_key = :k AND is_active"),
                   {"s": scope, "k": key})
        version = db.execute(
            text(f"""
                INSERT INTO {_T} (scope, scope_key, config, version, is_active, note, created_by)
                SELECT :s, :k, CAST(:cfg AS jsonb), COALESCE(MAX(version), 0) + 1, true, :note, :by
                FROM {_T} WHERE scope = :s AND scope_key = :k
                RETURNING version
            """),
            {"s": scope, "k": key, "cfg": json.dumps(config, ensure_ascii=False), "note": note,
             "by": str(admin_id)},
        ).scalar_one()
        record_audit(db, actor_type=ActorType.USER, actor_id=admin_id, action=action,
                     entity_type="conversation_flow",
                     data={"scope": scope, "scope_key": key, "version": version,
                           "changed_paths": fc.override_paths(config)},
                     commit=False)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "הגדרות נשמרו במקביל על ידי מישהו אחר - יש לרענן ולנסות שוב")
    fc.invalidate_cache()
    return int(version)


# ---------------------------------------------------------------------------
# endpoints
# ---------------------------------------------------------------------------

@router.get("")
def list_flows(db: Session = Depends(get_db), admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Every scope (global + all event types, plus events that have an override)
    with its active version, and the schema the UI needs."""
    rows = db.execute(text(
        f"SELECT f.scope, f.scope_key, f.version, f.created_at, f.config, e.name AS event_name "
        f"FROM {_T} f LEFT JOIN events e ON f.scope = 'event' AND CAST(e.id AS text) = f.scope_key "
        "WHERE f.is_active"
    )).fetchall()
    active = {(r.scope, r.scope_key): r for r in rows}

    def entry(scope: str, key: str, label: str) -> Dict[str, Any]:
        r = active.get((scope, key))
        cfg = (fc.coerce_json(r.config) or {}) if r else {}
        return {"scope": scope, "scope_key": key, "label": label,
                "version": r.version if r else None,
                "updated_at": _iso(r.created_at) if r else None,
                "changed_count": len(fc.override_paths(cfg))}

    try:
        from shared.domain.messaging.event_types import EVENT_TYPES, event_type_of
        type_labels = {k: (EVENT_TYPES[event_type_of(k)].name_he if event_type_of(k) in EVENT_TYPES else k)
                       for k in fc.EVENT_TYPE_KEYS}
    except Exception:
        type_labels = {k: k for k in fc.EVENT_TYPE_KEYS}

    scopes = [entry(fc.SCOPE_GLOBAL, fc.GLOBAL_KEY, "ברירת מחדל")]
    scopes += [entry(fc.SCOPE_EVENT_TYPE, k, type_labels[k]) for k in fc.EVENT_TYPE_KEYS]
    scopes += [entry(fc.SCOPE_EVENT, r.scope_key, r.event_name or r.scope_key)
               for r in rows if r.scope == fc.SCOPE_EVENT]
    return {"scopes": scopes, "schema": fc.schema_for_ui(), "defaults": fc.DEFAULT_FLOW}


class FlowSaveIn(BaseModel):
    config: Dict[str, Any] = Field(default_factory=dict, description="sparse override for this scope")
    note: Optional[str] = Field(None, max_length=300)
    expected_version: Optional[int] = Field(None, description="optimistic concurrency: active version the edit started from")


class PreviewIn(BaseModel):
    event_type: Optional[str] = None
    scope: Optional[str] = None
    scope_key: Optional[str] = None
    config: Optional[Dict[str, Any]] = Field(None, description="draft override for scope/scope_key (unsaved)")


@router.post("/preview")
def preview_flow(payload: PreviewIn = Body(...), db: Session = Depends(get_db),
                 admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Simulated conversation (bot/guest turns) for the confirm / decline /
    maybe / didn't-understand / already-answered / opt-out paths. With
    scope+scope_key+config it previews an UNSAVED draft over the stored parents."""
    scope = payload.scope or (fc.SCOPE_EVENT_TYPE if payload.event_type else fc.SCOPE_GLOBAL)
    key = payload.scope_key or (payload.event_type if scope == fc.SCOPE_EVENT_TYPE else fc.GLOBAL_KEY)
    ctx = _check_scope(db, scope, key)
    draft = fc.normalize_override(payload.config) if payload.config is not None else _active_override(db, scope, key)
    errors = fc.validate_override(draft)
    parents = _parent_overrides(db, scope, ctx)
    layers = [*parents, draft] if not errors else parents
    if not errors:
        errors = fc.validate_effective(fc.merge_layers(*layers))
    flow = fc.FlowConfig(fc.merge_layers(*layers)) if not errors else fc.FlowConfig(fc.merge_layers(*parents))

    questions = None
    if ctx.get("event_id"):
        try:
            qrows = db.execute(text(
                "SELECT label, options FROM event_field_defs WHERE event_id = CAST(:e AS uuid) "
                "AND ask_in_rsvp ORDER BY sort_order, created_at"), {"e": ctx["event_id"]}).fetchall()
            questions = [{"label": r.label, "options": (r.options if isinstance(r.options, list) else
                                                        (fc.coerce_json(r.options) or []))} for r in qrows]
        except Exception:
            db.rollback()
            questions = None
    event_type = payload.event_type or ctx.get("event_type") or None
    return {
        "event_type": event_type,
        "errors": errors,
        "transcripts": fc.simulate(flow, event_type, questions=questions),
    }


@router.get("/{scope}/{key}")
def get_flow(scope: str, key: str, db: Session = Depends(get_db),
             admin_id: uuid.UUID = Depends(get_admin_user_id)):
    ctx = _check_scope(db, scope, key)
    return _scope_payload(db, scope, key, ctx)


@router.put("/{scope}/{key}")
def save_flow(scope: str, key: str, payload: FlowSaveIn = Body(...), db: Session = Depends(get_db),
              admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Validate and save as a NEW version (the previous stays in history)."""
    ctx = _check_scope(db, scope, key)
    config = fc.normalize_override(payload.config)
    errors = fc.validate_override(config)
    if not errors:
        errors = fc.validate_effective(fc.merge_layers(*_parent_overrides(db, scope, ctx), config))
    if errors:
        raise HTTPException(422, {"message": "validation_failed", "errors": errors})
    current = _active(db, scope, key)
    if payload.expected_version is not None and (current.version if current else 0) != payload.expected_version:
        raise HTTPException(409, "ההגדרות השתנו מאז שנפתחו - יש לרענן ולנסות שוב")
    _save_version(db, scope, key, config, admin_id, payload.note, "conversation_flow.save")
    return _scope_payload(db, scope, key, ctx)


@router.get("/{scope}/{key}/versions")
def list_versions(scope: str, key: str, db: Session = Depends(get_db),
                  admin_id: uuid.UUID = Depends(get_admin_user_id)):
    _check_scope(db, scope, key)
    rows = db.execute(text(
        f"SELECT version, is_active, created_at, created_by, note, config FROM {_T} "
        "WHERE scope = :s AND scope_key = :k ORDER BY version DESC LIMIT 200"),
        {"s": scope, "k": key}).fetchall()
    return {"versions": [
        {"version": r.version, "is_active": r.is_active, "created_at": _iso(r.created_at),
         "created_by": str(r.created_by) if r.created_by else None, "note": r.note,
         "changed_paths": fc.override_paths(fc.coerce_json(r.config) or {}),
         "config": fc.coerce_json(r.config) or {}}
        for r in rows
    ]}


@router.post("/{scope}/{key}/revert/{version}")
def revert_flow(scope: str, key: str, version: int, db: Session = Depends(get_db),
                admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Restore an old version by saving its config as a NEW version (history is
    append-only). version 0 = reset the scope to fully inherited (empty)."""
    ctx = _check_scope(db, scope, key)
    if version == 0:
        config: Dict[str, Any] = {}
    else:
        row = db.execute(text(f"SELECT config FROM {_T} WHERE scope = :s AND scope_key = :k AND version = :v"),
                         {"s": scope, "k": key, "v": version}).first()
        if not row:
            raise HTTPException(404, "version not found")
        config = fc.coerce_json(row.config) or {}
    errors = fc.validate_layers(*_parent_overrides(db, scope, ctx), config)
    if errors:
        raise HTTPException(422, {"message": "validation_failed", "errors": errors})
    _save_version(db, scope, key, config, admin_id, f"שחזור לגרסה {version}" if version else "איפוס לברירת המחדל",
                  "conversation_flow.revert")
    return _scope_payload(db, scope, key, ctx)
