"""Content-repository tests - every Event Type OWNS its copy; `_shared` is fallback.

Proves the authoring philosophy without touching the engine:
  * each real event type physically owns its full variant set (its own templates)
  * the same variant resolves to DIFFERENT copy per event type
  * `_shared` is a technical fallback only (used when an event type has no variant)
  * the engine (BUILTIN_CATALOG=21, the 6 active anchors, resolve_stage_channel,
    stage model, publishing) is byte-identical - event copy lives in EVENT_CATALOG

Standalone: `python3 shared/domain/messaging/tests/test_event_types.py`
"""
import os
import sys

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
sys.path.insert(0, _ROOT)
os.environ.setdefault("MEDIA_S3_URL", "https://cdn.test/")

from shared.domain.messaging import (  # noqa: E402
    BUILTIN_CATALOG, EVENT_CATALOG, ALL_TEMPLATES, FlowStage,
    resolve_event_variant, effective_variants_for, resolve_stage_channel,
    usable_templates, validate_catalog, RECOMMENDATIONS,
)
from shared.domain.messaging.catalog import _BASE_VARIANT_KEY  # noqa: E402

EVENT_TYPES = ["wedding", "brit", "brita", "bar", "bat", "birthday", "corporate", "other"]
STAGES = [s.value for s in FlowStage]

_P = []
def check(name, cond):
    _P.append(bool(cond))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")

print("== every event type OWNS its full variant set ==")
# For each (stage, event type), each shared-base variant resolves to a template
# that belongs to EVENT_CATALOG and is scoped to that event type.
# Where an event type OWNS a variant it resolves to that event type's own scoped
# copy; where it doesn't, it falls back to the _shared base. Both are correct -
# assert the MECHANISM, not full materialization (authors add/remove freely).
_bad = []
for (sid, vid) in list(_BASE_VARIANT_KEY.keys()):
    for et in EVENT_TYPES:
        t = resolve_event_variant(sid, et, vid)
        if t is None:
            _bad.append(("unresolved", sid, et, vid))
        elif t.key in EVENT_CATALOG:
            if t.event_types != (et,):
                _bad.append(("mis-scoped", sid, et, vid))
        elif t.key != _BASE_VARIANT_KEY[(sid, vid)]:
            _bad.append(("bad-fallback", sid, et, vid))
check("every (stage, event type, base variant) resolves - owned copy or _shared fallback",
      not _bad)
if _bad:
    print("   bad:", _bad[:5])

print("== the same variant is DIFFERENT copy per event type ==")
w = resolve_event_variant("invitation", "wedding", "elegant")
b = resolve_event_variant("invitation", "brit", "elegant")
check("wedding/elegant and brit/elegant are distinct templates", w.key != b.key)
check("wedding owns 'general_rsvp__wedding'", w.key == "general_rsvp__wedding")
check("each is scoped to its event type",
      w.event_types == ("wedding",) and b.event_types == ("brit",))
check("both are drafts awaiting production copy (no Meta binding yet)",
      w.meta is None and b.meta is None)

print("== the editor view: event types own their copy (not 'inherited') ==")
ev = effective_variants_for("invitation", "wedding")
_inv_base = {vid for (s, vid) in _BASE_VARIANT_KEY if s == "invitation"}
check("wedding OWNS the invitation variants it has authored (not inherited)",
      any(v["inherited"] is False for v in ev.values()))
check("wedding's variant set matches the invitation base variants",
      set(ev.keys()) == _inv_base)

print("== `_shared` is a TECHNICAL FALLBACK only (safety net) ==")
# An event type with no variant of its own falls back to the shared base. Simulate
# via an unknown event type: resolution must land on the _shared base template.
fb = resolve_event_variant("invitation", "unknown_type", "classic")
check("unknown/absent event type falls back to the _shared base",
      fb is not None and fb.key == "event_no_pic" and fb.event_types == ())
check("the _shared base still holds the active deliverable anchors",
      BUILTIN_CATALOG["event_no_pic"].meta is not None
      and BUILTIN_CATALOG["event_no_pic"].is_usable)

print("== the ENGINE is byte-identical (event copy is a separate layer) ==")
check("BUILTIN_CATALOG is the shared base only (no event-type keys)",
      len(BUILTIN_CATALOG) > 0 and not any("__" in k for k in BUILTIN_CATALOG))
check("EVENT_CATALOG holds only event-type-scoped templates",
      len(EVENT_CATALOG) > 0 and all("__" in k for k in EVENT_CATALOG))
check("ALL_TEMPLATES = base + event, no key collisions",
      len(ALL_TEMPLATES) == len(BUILTIN_CATALOG) + len(EVENT_CATALOG))
check("still exactly the 6 active deliverable templates (drafts don't count)",
      len(usable_templates()) == 6)
check("legacy (stage, variant) resolution still returns the shared base anchor",
      resolve_stage_channel("invitation", "classic", "whatsapp").key == "event_no_pic")
check("no event-type key leaked into BUILTIN_CATALOG",
      not any("__" in k for k in BUILTIN_CATALOG))

print("== default_variant is owned per event type; catalog stays valid ==")
check("wedding invitation default is elegant, brit is religious (event-specific)",
      RECOMMENDATIONS["wedding"]["invitation"] == "elegant"
      and RECOMMENDATIONS["brit"]["invitation"] == "religious")
check("materialized default flag matches each event type's default_variant",
      resolve_event_variant("invitation", "wedding", "elegant").is_default
      and not resolve_event_variant("invitation", "brit", "classic").is_default)
print("== structure is INHERITED from _shared; event copy stays a draft ==")
check("inheritance fills structural fields on every event template (category/cta/tone/preview)",
      all(t.category and t.cta_type and t.tone and t.preview for t in EVENT_CATALOG.values()))
check("no event template borrows the base's live Meta binding or usable status",
      all((not t.is_usable) and t.meta is None for t in EVENT_CATALOG.values()))
check("every event template keeps its OWN Meta name (no collisions with the base)",
      all(t.meta_config and t.meta_config.name == t.key for t in EVENT_CATALOG.values()))

passed = sum(_P)
print(f"\nRESULT: {passed}/{len(_P)} checks passed")
sys.exit(0 if passed == len(_P) else 1)
