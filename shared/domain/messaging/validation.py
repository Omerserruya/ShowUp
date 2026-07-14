"""Catalog validation - guards the Messaging Catalog as the definitive content
repository. Pure, no I/O. Run it in CI, at import (as a warning), or via the
Admin API before writing production copy.

It checks the STRUCTURE the whole platform relies on, so a bad edit fails loudly
here instead of at send time:

  1. Every stage has at least one variant.
  2. Every event type has a default (recommended) variant for every stage.
  3. Every template references only existing (canonical) variables.
  4. Every Meta template name is unique.
  5. Every default/recommended variant actually exists in its stage.
  6. Every recommendation / availability entry points at a real stage.
  7. No duplicated slugs (template keys, or variant ids within a stage).
  8. No orphan variants (a variant with no template).
"""
from __future__ import annotations

from typing import Dict, List

from .stages import FlowStage, canonical_stage
from .variables import VARIABLES
from .event_types import EVENT_TYPES
from .catalog import (
    BUILTIN_CATALOG,
    ALL_TEMPLATE_LIST,
    RECOMMENDATIONS,
    AVAILABILITY,
    VARIANT_NAME_OF,
)


def _stage_ids() -> List[str]:
    return [s.value for s in FlowStage]


def validate_catalog() -> List[str]:
    """Return a list of human-readable problems. Empty list == valid catalog."""
    errors: List[str] = []
    stages = _stage_ids()
    # The engine's variant set comes from the shared base; template-level checks
    # cover the WHOLE repository (base + every event type's owned copy).
    base_templates = list(BUILTIN_CATALOG.values())
    all_templates = list(ALL_TEMPLATE_LIST)

    # Build stage -> {variant_id: [template_key,...]} from the SSOT grouping.
    stage_variants: Dict[str, Dict[str, List[str]]] = {sid: {} for sid in stages}
    for t in base_templates:
        vid = VARIANT_NAME_OF.get(t.key, (None, None))[0]
        sid = t.flow_stage.value
        if vid is None:
            errors.append(f"template '{t.key}' has no variant grouping")
            continue
        stage_variants.setdefault(sid, {}).setdefault(vid, []).append(t.key)

    # 1. Every stage has at least one variant.
    for sid in stages:
        if not stage_variants.get(sid):
            errors.append(f"stage '{sid}' has no variants")

    # 8. No orphan variants (a variant with no template).
    for sid, variants in stage_variants.items():
        for vid, keys in variants.items():
            if not keys:
                errors.append(f"variant '{sid}/{vid}' is orphan (no template)")

    # 7a. No duplicated template slugs anywhere in the repository (base + event
    # types share one key namespace; a collision would silently hide a template).
    seen_keys: Dict[str, int] = {}
    for t in all_templates:
        seen_keys[t.key] = seen_keys.get(t.key, 0) + 1
    for key, n in seen_keys.items():
        if n > 1:
            errors.append(f"duplicated template slug '{key}' ({n}×)")

    # 3. Every template references only existing variables (whole repository).
    for t in all_templates:
        for v in t.variables:
            if v not in VARIABLES:
                errors.append(f"template '{t.key}' references unknown variable '{v}'")

    # 3b. Every quick-reply button carries a KNOWN semantic action (label is free;
    # the action is the business signal the engine consumes).
    from shared.domain.rsvp import CATALOG_BUTTON_ACTIONS
    _URL_VARS = {"invitation_link", "nav_link", "rsvp_link"}
    for t in all_templates:
        for b in t.quick_replies:
            if b.action not in CATALOG_BUTTON_ACTIONS:
                errors.append(
                    f"template '{t.key}' button '{b.label}' has unknown semantic action '{b.action}'")
        # 3c. URL buttons must point at a known link variable, and Meta caps a
        # template at 10 buttons total.
        for b in t.url_buttons:
            if b.url_var not in _URL_VARS:
                errors.append(
                    f"template '{t.key}' URL button '{b.label}' has unknown url_var '{b.url_var}'")
        if len(t.quick_replies) + len(t.url_buttons) > 10:
            errors.append(f"template '{t.key}' has more than 10 buttons")

    # 4. Every Meta template name is unique across the whole repository.
    meta_names: Dict[str, List[str]] = {}
    for t in all_templates:
        name = (t.meta_config.name if t.meta_config else None) or (
            t.meta.template_name if t.meta else None)
        if name:
            meta_names.setdefault(name, []).append(t.key)
    for name, owners in meta_names.items():
        if len(owners) > 1:
            errors.append(f"duplicate Meta template name '{name}' used by {owners}")

    # 6 + 5. Recommendations point at real stages, and each named variant exists.
    for et, rec in RECOMMENDATIONS.items():
        for sid, variant_id in rec.items():
            cs = canonical_stage(sid)
            if not cs:
                errors.append(f"recommendation {et}.{sid} points at unknown stage")
                continue
            if variant_id not in stage_variants.get(cs.value, {}):
                errors.append(
                    f"recommendation {et}.{sid} -> variant '{variant_id}' does not exist")

    # 6b. Availability entries point at real stages.
    for et, row in AVAILABILITY.items():
        for sid in row:
            if not canonical_stage(sid):
                errors.append(f"availability {et}.{sid} points at unknown stage")

    # 2. Every event type has a default (recommended) variant for every stage.
    # Import here to avoid a circular import at module load (stage_definitions
    # imports catalog, which is imported above).
    from .stage_definitions import default_variant_for
    for et in EVENT_TYPES:
        for sid in stages:
            if not default_variant_for(et.value, sid):
                errors.append(f"event type '{et.value}' has no default variant for stage '{sid}'")

    return errors


def assert_valid() -> None:
    """Raise ValueError if the catalog is invalid (for CI / tests / startup)."""
    errors = validate_catalog()
    if errors:
        raise ValueError("Messaging catalog invalid:\n  - " + "\n  - ".join(errors))
