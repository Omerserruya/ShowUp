"""Publishing-layer tests - checksum/change-detection, Meta create payload,
internal-status workflow, and selection. Pure domain (no DB / no network).

Run standalone: `python3 shared/domain/messaging/tests/test_publishing.py`
"""
import dataclasses
import os
import sys

os.environ.setdefault("MEDIA_S3_URL", "https://cdn.test/")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")))

from shared.domain.messaging import (  # noqa: E402
    BUILTIN_CATALOG, EVENT_CATALOG, compute_checksum, build_create_payload, select_templates,
    published_name, has_placeholder,
    can_transition, default_internal_status, default_meta_status,
    InternalStatus, MetaStatus, PUBLISHABLE_STATUSES,
)

_P = []
def check(name, cond):
    _P.append(bool(cond))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")

print("== checksum + change detection ==")
t = BUILTIN_CATALOG["event_no_pic"]
c1 = compute_checksum(t)
check("checksum is a 64-char sha256 hex", len(c1) == 64 and all(ch in "0123456789abcdef" for ch in c1))
check("checksum is deterministic", compute_checksum(t) == c1)
# editing copy changes the checksum; editing nothing does not
edited = dataclasses.replace(t, body="שלום {{guest_name}}")
check("editing body changes checksum", compute_checksum(edited) != c1)
# distinct templates hash distinctly
check("distinct templates -> distinct checksums",
      len({compute_checksum(x) for x in BUILTIN_CATALOG.values()}) == len(BUILTIN_CATALOG))

print("== Meta create payload (WhatsApp only) ==")
p = build_create_payload(t)
check("create payload has name/language/category/components",
      p["name"] == "event_no_pic" and p["language"] == "he"
      and p["category"] in ("MARKETING", "UTILITY", "AUTHENTICATION") and isinstance(p["components"], list))
check("BODY component present", any(c["type"] == "BODY" for c in p["components"]))
# image variant carries an IMAGE header
img = build_create_payload(BUILTIN_CATALOG["general_rsvp"])
check("with_image template -> IMAGE header",
      any(c["type"] == "HEADER" and c.get("format") == "IMAGE" for c in img["components"]))
# nav-button variant carries a URL button
nav = build_create_payload(BUILTIN_CATALOG["event_remind"])
check("nav template -> URL button",
      any(c["type"] == "BUTTONS" and c["buttons"][0]["type"] == "URL" for c in nav["components"]))
# body param count follows the send mapping when copy has no tokens yet
body_comp = next(c for c in p["components"] if c["type"] == "BODY")
check("body example count matches send-mapping arity (4 for event_no_pic)",
      len(body_comp["example"]["body_text"][0]) == 4)

print("== URL buttons: links live in buttons, not the body ==")
inv = EVENT_CATALOG["invitation_modern__wedding"]
_p = build_create_payload(inv)
_btns = next(c for c in _p["components"] if c["type"] == "BUTTONS")["buttons"]
check("mixed template: 3 quick-reply + 1 URL button",
      [b["type"] for b in _btns] == ["QUICK_REPLY", "QUICK_REPLY", "QUICK_REPLY", "URL"])
_url = next(b for b in _btns if b["type"] == "URL")
check("URL button is a static base + trailing {{1}} (Meta rule)",
      _url["url"].endswith("/i/{{1}}") and _url["url"].startswith("http") and "example" in _url)
check("Navigate button is a direct Waze URL with the variable LAST (Meta-verified)",
      build_create_payload(EVENT_CATALOG["table_info__wedding"])["components"][-1]["buttons"][0]["url"]
      == "https://www.waze.com/ul?navigate=yes&q={{1}}")
check("NO link variable remains in any published body",
      not any("{{invitation_link}}" in t.body or "{{nav_link}}" in t.body for t in select_templates("all")))

print("== internal workflow status (separate from Meta status) ==")
check("draft -> ready_for_review allowed", can_transition("draft", "ready_for_review"))
check("ready_for_review -> approved_internal allowed", can_transition("ready_for_review", "approved_internal"))
check("approved_internal -> published allowed", can_transition("approved_internal", "published"))
check("draft -> published NOT allowed (must be reviewed)", not can_transition("draft", "published"))
check("published -> deprecated allowed", can_transition("published", "deprecated"))
check("unknown status rejected", not can_transition("draft", "banana"))
check("publishable gate = approved_internal/published",
      set(s.value for s in PUBLISHABLE_STATUSES) == {"approved_internal", "published"})

print("== catalog defaults (no DB row) ==")
check("live anchor defaults to published/approved",
      default_internal_status(t) == InternalStatus.PUBLISHED and default_meta_status(t) == MetaStatus.APPROVED)
draft = BUILTIN_CATALOG["invitation_funny"]
check("draft defaults to draft/none",
      default_internal_status(draft) == InternalStatus.DRAFT and default_meta_status(draft) == MetaStatus.NONE)

print("== selection publishes the EFFECTIVE event-type catalog, not the base ==")
check("scope=all -> the event-type catalog (NOT the 21 _shared base)",
      len(select_templates("all")) == len(EVENT_CATALOG) and len(select_templates("all")) > 100)
check("no _shared base / anchor is in the publish set",
      all("__" in t.key for t in select_templates("all")))
check("scope=one resolves an event-type key",
      [x.key for x in select_templates("one", key="event_no_pic__wedding")] == ["event_no_pic__wedding"])
check("scope=one on a base/anchor key -> empty (anchors untouched)",
      select_templates("one", key="event_no_pic") == [])
check("scope=stage=reminder -> 24 (8 event types × 3 variants)",
      len(select_templates("stage", stage="reminder")) == 24)
check("scope=event_type=wedding -> only wedding templates",
      len(select_templates("event_type", event_type="wedding")) > 0
      and all(t.event_types == ("wedding",) for t in select_templates("event_type", event_type="wedding")))

print("== payloads carry real copy + descriptive names, never placeholders ==")
_real = [t for t in select_templates("all") if not has_placeholder(t)]
check("descriptive Meta name {stage}_{variant}__{eventtype}",
      published_name(EVENT_CATALOG["event_no_pic__wedding"]) == "invitation_classic__wedding")
def _body_text(tmpl):
    return next(c["text"] for c in build_create_payload(tmpl)["components"] if c["type"] == "BODY")
_leaks = [t.key for t in _real if "[[" in _body_text(t) or "[[" in build_create_payload(t)["name"]]
check("no authored template's payload body/name contains a placeholder", not _leaks)
check("placeholder templates are detectable (skipped by publish)",
      any(has_placeholder(t) for t in EVENT_CATALOG.values()))

passed = sum(_P)
print(f"\nRESULT: {passed}/{len(_P)} checks passed")
sys.exit(0 if passed == len(_P) else 1)
