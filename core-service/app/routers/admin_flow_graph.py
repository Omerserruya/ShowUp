"""Admin: guest WhatsApp conversation GRAPH (visual automation builder).

Storage: flow_graphs (migrations.ensure_flow_graphs) - one row per saved
VERSION of a scope's graph, one active row per (scope, scope_key); `enabled` on
the active row is the feature flag. Schema, validation, the default graph and
the interpreter/simulator live in shared/domain/flow_graph.py so webhook-worker
runs exactly what is saved here.

Scopes: global/default -> event_type/<type> -> event/<uuid>. At runtime the
most specific ENABLED graph wins; with none enabled the legacy state machine
runs. A scope that never saved a graph shows DEFAULT_GRAPH with that scope's
conversation flow settings (admin_flows) overlaid - i.e. what runs today.
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
from app.routers.admin_flows import _check_scope, _active_override, _parent_overrides
from shared.auth.admin import get_admin_user_id
from shared.domain import flow_config as fc
from shared.domain import flow_graph as fg
from shared.domain.enums import ActorType

router = APIRouter(prefix="/admin/flow-graph", tags=["admin-flow-graph"])

_T = fg.TABLE


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _iso(v: Any) -> Optional[str]:
    return v.isoformat() if hasattr(v, "isoformat") else (str(v) if v else None)


def _active(db: Session, scope: str, key: str) -> Optional[Any]:
    return db.execute(
        text(f"SELECT id, graph, version, enabled, created_at, created_by, note FROM {_T} "
             "WHERE scope = :s AND scope_key = :k AND is_active"),
        {"s": scope, "k": key},
    ).first()


def _effective_flow(db: Session, scope: str, key: str, ctx: Dict[str, Any]) -> fc.FlowConfig:
    """The scope's conversation flow settings (texts/toggles) as they run today."""
    merged = fc.merge_layers(*_parent_overrides(db, scope, ctx), _active_override(db, scope, key))
    return fc.FlowConfig(merged) if not fc.validate_effective(merged) else fc.default_flow()


def _default_for(db: Session, scope: str, key: str, ctx: Dict[str, Any]) -> Dict[str, Any]:
    return fg.build_default_graph(_effective_flow(db, scope, key, ctx))


def _live_for(db: Session, ctx: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Which enabled graph a conversation in this context would run (None = legacy)."""
    try:
        rows = db.execute(text(fg.ACTIVE_ENABLED_SQL),
                          {"etype": ctx.get("event_type") or "", "eid": ctx.get("event_id") or ""}).fetchall()
    except Exception:
        db.rollback()
        return None
    picked = fg.pick_graph(rows)
    return {"scope": picked.scope, "scope_key": picked.scope_key, "version": picked.version} if picked else None


def _scope_payload(db: Session, scope: str, key: str, ctx: Dict[str, Any]) -> Dict[str, Any]:
    row = _active(db, scope, key)
    graph = fg.coerce_json(row.graph) if row else None
    is_default = graph is None
    if graph is None:
        graph = _default_for(db, scope, key, ctx)
    return {
        "scope": scope,
        "scope_key": key,
        "context": ctx,
        "graph": graph,
        "version": row.version if row else None,
        "enabled": bool(row.enabled) if row else False,
        "is_default": is_default,
        "updated_at": _iso(row.created_at) if row else None,
        "updated_by": str(row.created_by) if row and row.created_by else None,
        "note": row.note if row else None,
        "validation": fg.validate_graph(graph),
        "live": _live_for(db, ctx),
    }


def _validated(graph: Any) -> Dict[str, Any]:
    res = fg.validate_graph(graph)
    if res["errors"]:
        raise HTTPException(422, {"message": "validation_failed", "errors": res["errors"],
                                  "warnings": res["warnings"]})
    return res


def _save_version(db: Session, scope: str, key: str, graph: Dict[str, Any], *, enabled: bool,
                  admin_id: uuid.UUID, note: Optional[str], action: str) -> int:
    try:
        db.execute(text(f"UPDATE {_T} SET is_active = false WHERE scope = :s AND scope_key = :k AND is_active"),
                   {"s": scope, "k": key})
        version = db.execute(
            text(f"""
                INSERT INTO {_T} (scope, scope_key, graph, version, is_active, enabled, note, created_by)
                SELECT :s, :k, CAST(:g AS jsonb), COALESCE(MAX(version), 0) + 1, true, :en, :note, :by
                FROM {_T} WHERE scope = :s AND scope_key = :k
                RETURNING version
            """),
            {"s": scope, "k": key, "g": json.dumps(graph, ensure_ascii=False), "en": enabled, "note": note,
             "by": str(admin_id)},
        ).scalar_one()
        record_audit(db, actor_type=ActorType.USER, actor_id=admin_id, action=action, entity_type="flow_graph",
                     data={"scope": scope, "scope_key": key, "version": version, "enabled": enabled,
                           "nodes": len(graph.get("nodes") or []), "edges": len(graph.get("edges") or [])},
                     commit=False)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "הגרף נשמר במקביל על ידי מישהו אחר - יש לרענן ולנסות שוב")
    fg.invalidate_cache()
    return int(version)


def _scope_label(scope: str, key: str, event_name: Optional[str], type_labels: Dict[str, str]) -> str:
    if scope == fg.SCOPE_GLOBAL:
        return "ברירת מחדל"
    if scope == fg.SCOPE_EVENT_TYPE:
        return type_labels.get(key, key)
    return event_name or key


# ---------------------------------------------------------------------------
# endpoints (static paths first)
# ---------------------------------------------------------------------------

@router.get("")
def list_graphs(db: Session = Depends(get_db), admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Every scope (global + event types + events that saved a graph) with its
    active version and enabled state."""
    rows = db.execute(text(
        f"SELECT g.scope, g.scope_key, g.version, g.enabled, g.created_at, g.graph, e.name AS event_name "
        f"FROM {_T} g LEFT JOIN events e ON g.scope = 'event' AND CAST(e.id AS text) = g.scope_key "
        "WHERE g.is_active"
    )).fetchall()
    active = {(r.scope, r.scope_key): r for r in rows}
    try:
        from shared.domain.messaging.event_types import EVENT_TYPES, event_type_of
        type_labels = {k: (EVENT_TYPES[event_type_of(k)].name_he if event_type_of(k) in EVENT_TYPES else k)
                       for k in fg.EVENT_TYPE_KEYS}
    except Exception:
        type_labels = {k: k for k in fg.EVENT_TYPE_KEYS}

    def entry(scope: str, key: str, event_name: Optional[str] = None) -> Dict[str, Any]:
        r = active.get((scope, key))
        g = (fg.coerce_json(r.graph) or {}) if r else {}
        return {"scope": scope, "scope_key": key, "label": _scope_label(scope, key, event_name, type_labels),
                "has_graph": r is not None, "version": r.version if r else None,
                "enabled": bool(r.enabled) if r else False, "updated_at": _iso(r.created_at) if r else None,
                "node_count": len(g.get("nodes") or []) if r else None}

    scopes = [entry(fg.SCOPE_GLOBAL, fg.GLOBAL_KEY)]
    scopes += [entry(fg.SCOPE_EVENT_TYPE, k) for k in fg.EVENT_TYPE_KEYS]
    scopes += [entry(fg.SCOPE_EVENT, r.scope_key, r.event_name) for r in rows if r.scope == fg.SCOPE_EVENT]
    return {"scopes": scopes,
            "resolution": "event -> event_type -> global; the most specific ENABLED graph runs; none -> legacy"}


@router.get("/meta")
def graph_meta(db: Session = Depends(get_db), admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Vocabulary for the editor: node/edge kinds, actions, fields, variables,
    entry stages, limits, plus custom field keys used across events."""
    out = fg.meta()
    try:
        rows = db.execute(text(
            "SELECT key, MAX(label) AS label, COUNT(DISTINCT event_id) AS events, BOOL_OR(ask_in_rsvp) AS asked "
            "FROM event_field_defs GROUP BY key ORDER BY COUNT(DISTINCT event_id) DESC, key LIMIT 300"
        )).fetchall()
        out["custom_fields"] = [{"field": f"{fg.CUSTOM_FIELD_PREFIX}{r.key}", "key": r.key, "label": r.label,
                                 "events": int(r.events), "ask_in_rsvp": bool(r.asked)} for r in rows]
    except Exception:
        db.rollback()
        out["custom_fields"] = []
    out["default_graph"] = fg.DEFAULT_GRAPH
    return out


class ValidateIn(BaseModel):
    graph: Dict[str, Any]


@router.post("/validate")
def validate(payload: ValidateIn = Body(...), admin_id: uuid.UUID = Depends(get_admin_user_id)):
    res = fg.validate_graph(payload.graph)
    return {"valid": not res["errors"], **res}


class SimulateIn(BaseModel):
    graph: Optional[Dict[str, Any]] = Field(None, description="draft graph; omitted -> the scope's graph")
    scope: Optional[str] = None
    scope_key: Optional[str] = None
    event_type: Optional[str] = None
    stage: Optional[str] = Field(None, description="entry stage (default invitation)")
    inputs: List[Dict[str, Any]] = Field(default_factory=list)


@router.post("/simulate")
def simulate(payload: SimulateIn = Body(...), db: Session = Depends(get_db),
             admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Transcript of bot/guest turns + the actions that WOULD run. No DB writes."""
    ctx: Dict[str, Any] = {}
    graph = payload.graph
    if payload.scope or graph is None:
        scope = payload.scope or (fg.SCOPE_EVENT_TYPE if payload.event_type in fg.EVENT_TYPE_KEYS else fg.SCOPE_GLOBAL)
        key = payload.scope_key or (payload.event_type if scope == fg.SCOPE_EVENT_TYPE else fg.GLOBAL_KEY)
        ctx = _check_scope(db, scope, key)
        if graph is None:
            graph = _scope_payload(db, scope, key, ctx)["graph"]
    res = fg.validate_graph(graph)
    if res["errors"]:
        return {"errors": res["errors"], "warnings": res["warnings"], "turns": [], "transcript": [],
                "actions": [], "final_node": None}
    questions = None
    if ctx.get("event_id"):
        try:
            qrows = db.execute(text(
                "SELECT id::text AS id, label, options FROM event_field_defs WHERE event_id = CAST(:e AS uuid) "
                "AND ask_in_rsvp AND data_type = 'enum' ORDER BY sort_order, created_at"),
                {"e": ctx["event_id"]}).fetchall()
            questions = [{"id": r.id, "label": r.label,
                          "options": r.options if isinstance(r.options, list) else
                          (json.loads(r.options) if isinstance(r.options, str) else [])} for r in qrows]
        except Exception:
            db.rollback()
            questions = None
    stage = payload.stage if payload.stage in fg.ENTRY_STAGES else "invitation"
    out = fg.simulate(graph, payload.inputs, event_type=payload.event_type or ctx.get("event_type") or None,
                      questions=questions, stage=stage)
    return {"errors": [], "warnings": res["warnings"], **out}


@router.get("/{scope}/{key}")
def get_graph(scope: str, key: str, db: Session = Depends(get_db),
              admin_id: uuid.UUID = Depends(get_admin_user_id)):
    ctx = _check_scope(db, scope, key)
    return _scope_payload(db, scope, key, ctx)


class GraphSaveIn(BaseModel):
    graph: Dict[str, Any]
    note: Optional[str] = Field(None, max_length=300)
    expected_version: Optional[int] = Field(
        None, description="optimistic concurrency: the version the edit started from; null = never saved")
    enabled: Optional[bool] = Field(None, description="omitted -> keep the scope's current state (new scope: off)")


@router.put("/{scope}/{key}")
def save_graph(scope: str, key: str, payload: GraphSaveIn = Body(...), db: Session = Depends(get_db),
               admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Validate and save as a NEW version (history is append-only)."""
    ctx = _check_scope(db, scope, key)
    _validated(payload.graph)
    current = _active(db, scope, key)
    fields_set = getattr(payload, "model_fields_set", None) or getattr(payload, "__fields_set__", set())
    if "expected_version" in fields_set and (current.version if current else None) != payload.expected_version:
        raise HTTPException(409, "הגרף השתנה מאז שנפתח - יש לרענן ולנסות שוב")
    enabled = payload.enabled if payload.enabled is not None else (bool(current.enabled) if current else False)
    _save_version(db, scope, key, payload.graph, enabled=enabled, admin_id=admin_id, note=payload.note,
                  action="flow_graph.save")
    return _scope_payload(db, scope, key, ctx)


class EnableIn(BaseModel):
    enabled: bool


@router.post("/{scope}/{key}/enable")
def enable_graph(scope: str, key: str, payload: EnableIn = Body(...), db: Session = Depends(get_db),
                 admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Turn the scope's graph on/off (the last saved version). Enabling a scope
    that never saved a graph first saves the default graph (with the scope's
    flow settings overlaid) as version 1."""
    ctx = _check_scope(db, scope, key)
    current = _active(db, scope, key)
    if current is None:
        if not payload.enabled:
            return _scope_payload(db, scope, key, ctx)
        graph = _default_for(db, scope, key, ctx)
        _validated(graph)
        _save_version(db, scope, key, graph, enabled=True, admin_id=admin_id, note="ברירת מחדל",
                      action="flow_graph.enable")
        return _scope_payload(db, scope, key, ctx)
    if payload.enabled:
        _validated(fg.coerce_json(current.graph))
    db.execute(text(f"UPDATE {_T} SET enabled = :en WHERE id = :id"), {"en": payload.enabled, "id": current.id})
    record_audit(db, actor_type=ActorType.USER, actor_id=admin_id,
                 action="flow_graph.enable" if payload.enabled else "flow_graph.disable", entity_type="flow_graph",
                 data={"scope": scope, "scope_key": key, "version": current.version, "enabled": payload.enabled},
                 commit=False)
    db.commit()
    fg.invalidate_cache()
    return _scope_payload(db, scope, key, ctx)


@router.get("/{scope}/{key}/versions")
def list_versions(scope: str, key: str, db: Session = Depends(get_db),
                  admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Bare array, newest first."""
    _check_scope(db, scope, key)
    rows = db.execute(text(
        f"SELECT version, is_active, enabled, created_at, created_by, note, graph FROM {_T} "
        "WHERE scope = :s AND scope_key = :k ORDER BY version DESC LIMIT 200"),
        {"s": scope, "k": key}).fetchall()
    out = []
    for r in rows:
        g = fg.coerce_json(r.graph) or {}
        out.append({"version": r.version, "is_active": r.is_active, "enabled": bool(r.enabled) and r.is_active,
                    "created_at": _iso(r.created_at), "created_by": str(r.created_by) if r.created_by else None,
                    "note": r.note, "node_count": len(g.get("nodes") or []), "graph": g})
    return out


@router.post("/{scope}/{key}/revert/{version}")
def revert_graph(scope: str, key: str, version: int, db: Session = Depends(get_db),
                 admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Restore an old version by saving it as a NEW version (keeps the scope's
    enabled state). version 0 = the default graph for this scope."""
    ctx = _check_scope(db, scope, key)
    if version == 0:
        graph = _default_for(db, scope, key, ctx)
    else:
        row = db.execute(text(f"SELECT graph FROM {_T} WHERE scope = :s AND scope_key = :k AND version = :v"),
                         {"s": scope, "k": key, "v": version}).first()
        if not row:
            raise HTTPException(404, "version not found")
        graph = fg.coerce_json(row.graph) or {}
    _validated(graph)
    current = _active(db, scope, key)
    _save_version(db, scope, key, graph, enabled=bool(current.enabled) if current else False, admin_id=admin_id,
                  note=f"שחזור לגרסה {version}" if version else "איפוס לברירת המחדל", action="flow_graph.revert")
    return _scope_payload(db, scope, key, ctx)
