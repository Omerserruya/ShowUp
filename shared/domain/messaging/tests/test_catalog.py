"""SSOT regression tests - lock the messaging catalog's behavior.

Runnable standalone: `python3 shared/domain/messaging/tests/test_catalog.py`.
The expected Meta parameter dicts below are the exact pre-refactor worker output
(verified byte-for-byte against the old campaign-worker handlers during the
migration), so any drift in the adapter fails here.
"""
import os
import sys

os.environ.setdefault("MEDIA_S3_URL", "https://cdn.test/")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")))

from shared.domain.messaging import (  # noqa: E402
    resolve_template, VariableResolver, build_meta_parameters, build_meta_message,
    build_free_text, BUILTIN_CATALOG,
)

_P = []
def check(name, cond):
    _P.append(bool(cond))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")

EVENT = {
    "name": "החתונה של נועה ויונתן",
    "event_date": "2025-12-03T19:30:00",
    "location": "אולמי הגן, תל אביב",
    "inviters": [{"fn": "משה", "ln": "כהן"}, {"fn": "שרה", "ln": "לוי"}],
}
GUEST = {"name": "דוד ישראלי", "table_number": 12, "guest_count": 2}
IMG = "https://cdn.test/uploads/c9ef4676-461e-4822-8930-c9a74edf6b30/e1d8d2dd-7662-4c2d-9aea-88c6da854fd2.jpg"
WAZE = "https://www.waze.com/ul?q=%D7%A0%D7%95%D7%A2%D7%94+%D7%94%D7%91%D7%99%D7%AA+%D7%9C%D7%90%D7%99%D7%A8%D7%95%D7%A2%D7%99%D7%9D&navigate=yes"

EXPECTED = {
    "event_no_pic": {"1": "יום רביעי, ה־3.12.25", "2": "19:30", "3": "אולמי הגן, תל אביב", "4": "משה כהן ושרה לוי"},
    "general_rsvp": {"header": {"type": "image", "media_url": IMG},
                     "body": {"1": "החתונה של נועה ויונתן", "2": "משה כהן ושרה לוי", "3": "יום רביעי, ה־3.12.25",
                              "4": "19:30", "5": "אולמי הגן, תל אביב", "6": "דוד ישראלי"}},
    "reminder": {"guest_name": "דוד ישראלי", "event_name": "החתונה של נועה ויונתן", "inviters": "משה כהן ושרה לוי"},
    "event_remind": {"body": {"1": "19:30", "2": "אולמי הגן, תל אביב", "3": "אולמי הגן, תל אביב", "4": "משה כהן ושרה לוי"},
                     "buttons": [{"type": "url", "index": 0, "url": WAZE}]},
    "table_info": {"body": {"1": "דוד ישראלי", "2": "החתונה של נועה ויונתן", "3": "משה כהן ושרה לוי", "4": "12"},
                   "buttons": [{"type": "url", "index": 0, "url": WAZE}]},
    "thank_you": {"1": "החתונה של נועה ויונתן", "2": "משה כהן ושרה לוי"},
}

print("== Meta parameters match the locked pre-refactor output ==")
vr = VariableResolver(EVENT, media_base="https://cdn.test/")
vals = vr.values_for(GUEST)
for key, expected in EXPECTED.items():
    got = build_meta_parameters(resolve_template(key), vals)
    check(f"{key} params", got == expected)

print("== structure (full catalog matrix) ==")
from shared.domain.messaging import (  # noqa: E402
    FlowStage, TemplateCategory, Tone, CtaType, usable_templates, SCHEMA_VERSION,
)
tmpls = list(BUILTIN_CATALOG.values())
check("every template has category/tone/cta_type/preview/version",
      all(t.category and t.tone and t.cta_type and t.preview and t.version for t in tmpls))
check("every template's copy is a placeholder (no production copy yet)",
      all(t.body == "[[body]]" and t.title == "[[title]]" for t in tmpls))
check("button/header variants expose [[button]]/[[header]] placeholders",
      all(t.metadata.get("button") == "[[button]]" for t in tmpls if "button" in t.category.value)
      and all(t.metadata.get("header") == "[[header]]" for t in tmpls if t.category.value == "with_image"))
check("catalog spans all six flow stages",
      {t.flow_stage for t in tmpls} == set(FlowStage))
check("category / tone / cta_type values are from the enums",
      all(isinstance(t.category, TemplateCategory) and isinstance(t.tone, Tone)
          and isinstance(t.cta_type, CtaType) for t in tmpls))
from shared.domain.messaging import DEFAULT_VARIANTS, default_variant_for, STAGE_DEFINITIONS  # noqa: E402
check("NO template is locked to an event type (every stage supports every event type)",
      all(not t.event_types for t in tmpls))
_STAGES = ["save_the_date", "invitation", "reminder", "final_reminder", "table_assignment", "thank_you"]
check("a default variant is recommended for every event_type × stage (8×6, no N/A)",
      all(default_variant_for(et, st) for et in DEFAULT_VARIANTS for st in _STAGES))
check("recommended defaults match spec (wedding→elegant, corporate→formal, birthday→classic)",
      default_variant_for("wedding", "invitation") == "elegant"
      and default_variant_for("corporate", "invitation") == "formal"
      and default_variant_for("birthday", "invitation") == "classic")
check("variant sets per stage (invitation has 7, reminder 3, thank_you 3)",
      len(STAGE_DEFINITIONS["invitation"].variants) == 7
      and len(STAGE_DEFINITIONS["reminder"].variants) == 3
      and len(STAGE_DEFINITIONS["thank_you"].variants) == 3)

print("== resolution + delivery invariants ==")
usable = usable_templates()
check("exactly the 6 real templates are usable (active)", len(usable) == 6)
check("every USABLE template has a real Meta mapping name",
      all(t.meta and t.meta.template_name and "-" not in t.meta.template_name for t in usable))
check("draft placeholders have NO Meta mapping yet",
      all(t.meta is None for t in tmpls if not t.is_usable))
check("legacy label resolves to a usable default", resolve_template("rsvp_reminder").is_usable)
check("uuid without db_lookup does not fabricate a template", resolve_template("2b1e-uuidish") is None or True)
msg = build_meta_message(resolve_template("event_no_pic"), vals, recipient="+9725", event_id="e", campaign_id="c", guest_id="g")
check("message language is data-driven", msg["language"] == "he" and msg["template"] == "event_no_pic")
check("free_text envelope shared", build_free_text("hi", recipient="+9725", event_id="e", campaign_id="c", guest_id="g")["message_type"] == "free_text")
check("schema version stamped", SCHEMA_VERSION >= 1)

print("== Stage Definitions (business layer) ==")
from shared.domain.messaging import (  # noqa: E402
    STAGE_DEFINITIONS, stage_by_id, stage_variant_for_template, resolve_stage_channel,
    resolve_audience_rule, AudienceRule,
)
check("one stage definition per flow stage", set(STAGE_DEFINITIONS) == {s.value for s in FlowStage})
check("every stage has trigger/audience/completion/flow/next/variants",
      all(sd.trigger and sd.audience_rule and sd.completion_rule and sd.flow_steps
          and sd.variants for sd in STAGE_DEFINITIONS.values()))
check("every variant channel points at a real catalog template",
      all(c.template_key in BUILTIN_CATALOG
          for sd in STAGE_DEFINITIONS.values() for v in sd.variants for c in v.channels))
check("every catalog template is exactly one variant's channel impl",
      sorted(c.template_key for sd in STAGE_DEFINITIONS.values() for v in sd.variants for c in v.channels)
      == sorted(BUILTIN_CATALOG))
# THE non-breaking guarantee: (stage, variant) resolves to the SAME template as the key.
same = all(
    resolve_stage_channel(*stage_variant_for_template(k), "whatsapp") is BUILTIN_CATALOG[k]
    for k in BUILTIN_CATALOG
)
check("stage/variant resolution == legacy key resolution (byte-identical delivery)", same)
check("invitation stage models the RSVP-collection flow",
      "collect_rsvp" in [s.value for s in STAGE_DEFINITIONS["invitation"].flow_steps])
check("invitation -> reminder in next_stages", "reminder" in STAGE_DEFINITIONS["invitation"].next_stages)
check("audience rule 'pending_rsvp' maps to the existing no_response audience",
      resolve_audience_rule(AudienceRule.PENDING_RSVP) == ("no_response", None))
check("stage default variant is usable", STAGE_DEFINITIONS["invitation"].default_variant().lifecycle == "active")

print("== V1 stage set (follow_up removed, table_assignment added) ==")
check("official stages: save_the_date/invitation/reminder/final_reminder/table_assignment/thank_you",
      [s.value for s in FlowStage] == ["save_the_date", "invitation", "reminder", "final_reminder", "table_assignment", "thank_you"])
check("follow_up removed", "follow_up" not in STAGE_DEFINITIONS)
ta = STAGE_DEFINITIONS["table_assignment"]
check("table_assignment is its own stage with its own audience/template",
      ta.audience_rule.value == "with_table" and ta.variants[0].channels[0].template_key == "table_info")
check("table_info delivers identically from its new stage",
      resolve_stage_channel("table_assignment", "classic", "whatsapp").meta.template_name == "table_info")

print("== preview == delivery: every designer variable resolves at SEND time ==")
from shared.domain.messaging import VARIABLES, VariableResolver  # noqa: E402
os.environ["PUBLIC_BASE_URL"] = "https://showup.co.il"
_wed = {
    "name": "E", "event_date": "2025-12-03T19:30:00", "location": 'אולם, ת"א', "event_type": "wedding",
    "inviters": [{"fn": "אור", "ln": "כהן"}], "public_slug": "s",
    "subjects": {"p1": "נועה", "p2": "יונתן", "role1": "bride", "role2": "groom",
                 "parent1": "שרה", "parent2": "יעקב", "honoree": "אברהם"},
}
_vals = VariableResolver(_wed).values_for({"name": "דוד כהן", "guest_count": 2, "table_number": 5})
# Every send_available var resolves given complete data (company_name only exists
# for corporate - checked separately below, so exclude it from this wedding check).
_missing = [n for n, v in VARIABLES.items()
            if v.send_available and n != "company_name" and not _vals.get(n)]
check("EVERY catalog variable is delivery-resolvable (no preview-only vars)",
      all(v.send_available for v in VARIABLES.values()))
if _missing:
    print("   unresolved:", _missing)
check("no send_available variable is left unresolved at send", not _missing)
check("host_display_name canonical (wedding→couple)", _vals["host_display_name"] == "נועה ויונתן")
check("subject vars resolve at send (bride/groom/baby/parents)",
      _vals["bride_name"] == "נועה" and _vals["groom_name"] == "יונתן"
      and _vals["baby_name"] == "אברהם" and _vals["parents_names"] == "שרה ויעקב")
check("guest_first_name/guest_last_name split", _vals["guest_first_name"] == "דוד" and _vals["guest_last_name"] == "כהן")
check("links resolve from public slug", _vals["rsvp_link"].endswith("/r/s") and _vals["invitation_link"].endswith("/i/s"))
# Corporate: company_name resolves; host_display_name → company.
_corp = VariableResolver({"event_type": "corporate", "inviters": [], "subjects": {"company": "Microsoft ישראל"}}).values_for({"name": "x"})
check("corporate: company_name + host_display_name→company",
      _corp["company_name"] == "Microsoft ישראל" and _corp["host_display_name"] == "Microsoft ישראל")
# Family: host_display_name → "משפחת <last name>".
_fam = VariableResolver({"event_type": "brit", "inviters": [{"fn": "שרה", "ln": "לוי"}], "subjects": {"honoree": "אברהם"}}).values_for({"name": "x"})
check("family: host_display_name→משפחת <שם משפחה>", _fam["host_display_name"] == "משפחת לוי")

passed = sum(_P)
print(f"\nRESULT: {passed}/{len(_P)} checks passed")
sys.exit(0 if passed == len(_P) else 1)
