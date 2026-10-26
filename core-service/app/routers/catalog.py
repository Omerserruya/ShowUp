"""Public messaging-catalog API - exposes the shared SSOT
(`shared.domain.messaging`) so the frontend wizard/preview render from the SAME
template definitions the worker delivers. No parallel frontend catalog.

Public (no auth), like /entitlements: this is static, non-sensitive product
metadata. Custom event-scoped templates (DB) are NOT included here; those are
fetched per-event through the authenticated templates API.
"""
from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db

from shared.domain.messaging import (
    BUILTIN_CATALOG, FlowStage, EVENT_TYPES, VARIABLES,
    TemplateCategory, Tone, CtaType, SCHEMA_VERSION, CATALOG_VERSION,
    STAGE_DEFINITIONS, Trigger, AudienceRule, CompletionRule, DEFAULT_VARIANTS,
    AVAILABILITY,
)

router = APIRouter(prefix="/catalog", tags=["catalog"])


def _stage_dto(sd) -> dict:
    return {
        "id": sd.id,
        "title": sd.title,
        "description": sd.description,
        "event_types": list(sd.event_types),
        "trigger": sd.trigger.value,
        "audience_rule": sd.audience_rule.value,
        "completion_rule": sd.completion_rule.value,
        "flow_steps": [s.value for s in sd.flow_steps],
        "next_stages": list(sd.next_stages),
        "variants": [
            {
                "id": v.id, "name": v.name, "description": v.description, "tone": v.tone,
                "event_types": list(v.event_types), "is_default": v.is_default,
                "premium": v.premium, "lifecycle": v.lifecycle,
                "channels": [{"channel": c.channel, "template_key": c.template_key} for c in v.channels],
            }
            for v in sd.variants
        ],
    }


@lru_cache(maxsize=1)
def _sendable_event_types() -> dict[str, tuple[str, ...]]:
    """template key -> the event types it can actually be delivered for.

    `sendable` alone cannot answer "may I offer this template?", because what
    Meta approved is the event-type variant (`<key>__wedding`), not the base
    template. A base can be globally unsendable while its wedding variant is
    live - and the reverse. Consumers that know their event type must filter on
    THIS, or they hide most of the catalog from the user (a wedding really has
    17 usable templates, not the 6 the global flag reports).

    Computed once: the builtin catalog is static, so this is a pure function of
    module state and every request would otherwise redo the same resolution.
    """
    from shared.domain.messaging import resolve_template

    out: dict[str, tuple[str, ...]] = {}
    for key in BUILTIN_CATALOG:
        usable = []
        for et in EVENT_TYPES:
            et_key = et.value if hasattr(et, "value") else str(et)
            resolved = resolve_template(key, event_type=et_key)
            if resolved is not None and resolved.is_usable:
                usable.append(et_key)
        out[key] = tuple(usable)
    return out


def _template_dto(t) -> dict:
    return {
        "id": t.key,
        "title": t.title,               # placeholder until copy is populated
        "body": t.body,                 # placeholder; copy used for preview + free_text
        "description": t.description,
        "flow_stage": t.flow_stage.value,
        "category": t.category.value,
        "tone": t.tone.value,
        "cta_type": t.cta_type.value,
        "channel": t.channel,
        "language": t.language,
        "event_types": list(t.event_types),
        "visibility": t.visibility,
        "lifecycle": t.lifecycle,       # 'active'/'approved' = usable; 'draft' = placeholder
        "is_default": t.is_default,
        "premium": t.premium,
        "priority": t.priority,
        "delivery": t.delivery.value,
        # True only if the template can actually be delivered right now: usable
        # lifecycle AND (for Meta delivery) a real approved Meta mapping. The wizard
        # must gate selection on this, not on `lifecycle` alone - an active template
        # with no meta mapping is not sendable.
        "sendable": t.is_usable,
        # Which event types this template can actually be delivered for. A client
        # that knows its event MUST filter on this rather than on `sendable`,
        # which is blind to the event-type variants Meta actually approved.
        "sendable_event_types": list(_sendable_event_types().get(t.key, ())),
        "variables": list(t.variables),
        "preview": {
            "emoji": t.preview.emoji, "accent": t.preview.accent, "header": t.preview.header,
            "length_hint": t.preview.length_hint, "note": t.preview.note,
        },
        "meta_template": t.meta.template_name if t.meta else None,
        "version": t.version,
        "metadata": t.metadata,
    }


def _custom_template_dtos(db: Session) -> list:
    """Admin-authored (Template Studio) templates whose Meta-APPROVED version is
    in a guest stage group - offered exactly like catalog templates, addressed as
    `custom__<key>`. ADDITIVE: catalog entries are untouched, and a DB problem
    only drops these extras (the static catalog still serves)."""
    try:
        from app.custom_templates_store import approved_guest_catalog_rows
        from shared.domain.messaging.custom_templates import template_from_custom_row
        all_types = [et.value if hasattr(et, "value") else str(et) for et in EVENT_TYPES]
        out = []
        for row in approved_guest_catalog_rows(db):
            t = template_from_custom_row(row)
            if t is None or not t.is_usable:
                continue
            dto = _template_dto(t)
            dto["sendable"] = True
            dto["sendable_event_types"] = list(t.event_types) or all_types
            dto["source"] = "custom"
            out.append(dto)
        return out
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return []


@router.get("")
def get_catalog(db: Session = Depends(get_db)):
    """The full messaging catalog: templates (all variants incl. drafts), the
    dimension vocabularies (stages, categories, tones, CTA types), canonical event
    types and variables - one payload the frontend consumes. Consumers offer only
    `lifecycle in (active, approved)` templates to users."""
    return {
        "schema_version": SCHEMA_VERSION,
        "catalog_version": CATALOG_VERSION,
        # Stage Definitions are the business objects; templates are their variants'
        # channel implementations (kept for direct lookup + backward compatibility).
        "stages": [_stage_dto(sd) for sd in STAGE_DEFINITIONS.values()],
        # Recommended variant per (event_type × stage). A recommendation, not a
        # restriction - every stage supports every event type; any variant is
        # selectable manually.
        "default_variants": DEFAULT_VARIANTS,
        # Which stages are recommended per event type (true / optional / false).
        # The wizard's default enable-state - a recommendation, not a restriction.
        "availability": AVAILABILITY,
        "triggers": [t.value for t in Trigger],
        "audience_rules": [a.value for a in AudienceRule],
        "completion_rules": [c.value for c in CompletionRule],
        "templates": [_template_dto(t) for t in BUILTIN_CATALOG.values()] + _custom_template_dtos(db),
        "flow_stages": [s.value for s in FlowStage],
        "categories": [c.value for c in TemplateCategory],
        "tones": [t.value for t in Tone],
        "cta_types": [c.value for c in CtaType],
        "event_types": [
            {"key": m.key.value, "name_he": m.name_he, "name_en": m.name_en,
             "emoji": m.emoji, "schedule_key": m.schedule_key, "subject_vars": m.subject_vars}
            for m in EVENT_TYPES.values()
        ],
        "variables": [
            {"name": v.name, "scope": v.scope.value, "label_he": v.label_he,
             "sample": v.sample, "send_available": v.send_available,
             "legacy_tokens": list(v.legacy_tokens)}
            for v in VARIABLES.values()
        ],
    }
