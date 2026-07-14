"""Content-SSOT tests - the Messaging Catalog as the definitive content repository.

Covers the refinements that make the catalog self-describing:
  * variables are AUTO-DERIVED from content + Meta binding (no manual list)
  * preview is UI-only; length_hint is derived
  * the `availability` recommendation matrix (event type × stage)
  * `validate_catalog()` - the 8 structural guards

Run standalone: `python3 shared/domain/messaging/tests/test_validation.py`
"""
import copy
import os
import sys

os.environ.setdefault("MEDIA_S3_URL", "https://cdn.test/")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")))

from shared.domain.messaging import (  # noqa: E402
    BUILTIN_CATALOG, VARIABLES, EVENT_TYPES, FlowStage,
    AVAILABILITY, stage_recommended_for, validate_catalog,
)
from shared.domain.messaging import catalog as _catalog  # noqa: E402
from shared.domain.messaging import validation as _validation  # noqa: E402

_P = []
def check(name, cond):
    _P.append(bool(cond))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")

print("== variables are auto-derived (no manual list) ==")
# The active anchors expose exactly their Meta-binding variables.
check("event_no_pic derives its 4 body vars from the Meta binding",
      BUILTIN_CATALOG["event_no_pic"].variables ==
      ("event_date", "event_time", "venue_name", "host_name"))
check("general_rsvp derives header_image_url from the binding",
      "header_image_url" in BUILTIN_CATALOG["general_rsvp"].variables)
# A draft with placeholder copy and no binding references nothing yet.
check("draft with placeholder copy derives no variables",
      BUILTIN_CATALOG["invitation_funny"].variables == ())
# Extraction reads {{tokens}} from real copy (canonical + legacy Hebrew).
check("extractor reads {{tokens}} from copy in order",
      _catalog._extract_variables(
          {"body": "שלום {{guest_first_name}}, האירוע {{event_name}} ב{{תאריך}}"}, None)
      == ("guest_first_name", "event_name", "event_date"))
check("every derived variable is a known canonical variable",
      all(v in VARIABLES for t in BUILTIN_CATALOG.values() for v in t.variables))

print("== preview is UI-only; length_hint derived ==")
check("length_hint derived: placeholder copy is short",
      BUILTIN_CATALOG["event_no_pic"].preview.length_hint == "short")
check("length_hint derived from real copy length",
      _catalog._derive_length_hint("קצר") == "short"
      and _catalog._derive_length_hint("x" * 300) == "medium"
      and _catalog._derive_length_hint("x" * 600) == "long")

print("== availability recommendation matrix ==")
_STAGES = [s.value for s in FlowStage]
check("every event type has an availability row",
      all(et.value in AVAILABILITY for et in EVENT_TYPES))
check("every row covers all six stages",
      all(set(AVAILABILITY[et.value]) == set(_STAGES) for et in EVENT_TYPES))
check("values are exactly true/optional/false",
      all(v in ("true", "optional", "false")
          for row in AVAILABILITY.values() for v in row.values()))
check("spec examples: birthday.table_assignment=false, corporate.save_the_date=optional",
      stage_recommended_for("birthday", "table_assignment") == "false"
      and stage_recommended_for("corporate", "save_the_date") == "optional")
check("wedding recommends every stage on by default",
      all(stage_recommended_for("wedding", s) == "true" for s in _STAGES))
check("availability is a recommendation, not a lock (unknown combo => optional)",
      stage_recommended_for("nonexistent_type", "invitation") == "optional")

print("== validate_catalog: the shipping catalog is valid ==")
check("shipping catalog has zero validation errors", validate_catalog() == [])

print("== validate_catalog: each guard actually fires ==")
def _with_patched(attr, value, probe):
    """Temporarily patch a catalog-level structure the validator reads, run it,
    restore. Lets us prove each guard triggers without mutating real content."""
    saved = getattr(_validation, attr)
    setattr(_validation, attr, value)
    try:
        errs = validate_catalog()
    finally:
        setattr(_validation, attr, saved)
    return any(probe in e for e in errs)

# 6. recommendation points at a non-existent stage
check("guard: recommendation → unknown stage",
      _with_patched("RECOMMENDATIONS", {"wedding": {"not_a_stage": "elegant"}}, "unknown stage"))
# 5. recommendation names a variant that does not exist
check("guard: recommendation → missing variant",
      _with_patched("RECOMMENDATIONS", {"wedding": {"invitation": "ghost_variant"}}, "does not exist"))
# 6b. availability points at a non-existent stage
check("guard: availability → unknown stage",
      _with_patched("AVAILABILITY", {"wedding": {"not_a_stage": "true"}}, "unknown stage"))
# 4. duplicate Meta template name - template-level checks scan the WHOLE repository
# (ALL_TEMPLATE_LIST), so the guards patch that list.
import dataclasses  # noqa: E402
from shared.domain.messaging.catalog import ALL_TEMPLATE_LIST  # noqa: E402
_clash = dataclasses.replace(BUILTIN_CATALOG["thank_you"],
                             meta_config=dataclasses.replace(BUILTIN_CATALOG["thank_you"].meta_config, name="event_no_pic"))
check("guard: duplicate Meta template name",
      _with_patched("ALL_TEMPLATE_LIST", list(ALL_TEMPLATE_LIST) + [_clash], "duplicate Meta template name"))
# 3. template references an unknown variable
_badvar = dataclasses.replace(BUILTIN_CATALOG["reminder"], key="reminder_badvar",
                              variables=("event_name", "not_a_var"))
check("guard: unknown variable reference",
      _with_patched("ALL_TEMPLATE_LIST", list(ALL_TEMPLATE_LIST) + [_badvar], "unknown variable"))

passed = sum(_P)
print(f"\nRESULT: {passed}/{len(_P)} checks passed")
sys.exit(0 if passed == len(_P) else 1)
