"""Quick-reply buttons: the catalog owns {label, action}; the engine gets the action.

The label is presentation (wording / emoji / language / A/B). The action is the
business signal. This locks: parsing, action normalization, semantic resolution
(label-independent) and validation.

Uses a fixture via MESSAGING_CATALOG_PATH so it is independent of the live catalog.
Standalone: `python3 shared/domain/messaging/tests/test_quick_reply.py`
"""
import os
import sys
import tempfile

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
sys.path.insert(0, _ROOT)
os.environ.setdefault("MEDIA_S3_URL", "https://cdn.test/")

_FIXTURE = """\
schema_version: 4
catalog_version: 1
defaults: {waze_url: "https://waze", base_event_type: _shared}
stages:
  invitation:
    title: הזמנה
    description: RSVP
    event_types:
      _shared:
        variants:
          classic:
            name: קלאסי
            templates:
            - key: invite_qr
              category: text_only
              cta_type: quick_reply_confirm
              content:
                title: "[[title]]"
                body: "שלום {{guest_first_name}}"
                header: null
                buttons:
                - {label: "✅ אגיע בשמחה 🎉", action: RSVP_ACCEPTED}
                - {label: "❌ לא אוכל להגיע", action: RSVP_DECLINED}
                - {label: "🤔 עדיין לא בטוח", action: RSVP_MAYBE}
                notes: ""
              metadata: {default: true, tone: warm, lifecycle: draft, version: 1, language: he}
              meta: {name: invite_qr, category: MARKETING}
              meta_mapping: null
"""

_fd, _path = tempfile.mkstemp(suffix=".yaml", prefix="qr_")
with os.fdopen(_fd, "w", encoding="utf-8") as f:
    f.write(_FIXTURE)
os.environ["MESSAGING_CATALOG_PATH"] = _path

from shared.domain.messaging import (  # noqa: E402
    BUILTIN_CATALOG, QuickReplyButton, validate_catalog, build_create_payload)
from shared.domain.rsvp import resolve_rsvp_action, normalize_button_action  # noqa: E402
from shared.domain.enums import RsvpAction  # noqa: E402

_P = []
def check(name, cond):
    _P.append(bool(cond))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")

t = BUILTIN_CATALOG["invite_qr"]

print("== catalog owns {label, action} ==")
check("three quick-reply buttons parsed", len(t.quick_replies) == 3)
check("each is a QuickReplyButton with label + action",
      all(isinstance(b, QuickReplyButton) and b.label and b.action for b in t.quick_replies))
check("author-facing 'RSVP_ACCEPTED' normalized to canonical token",
      t.quick_replies[0].action == "rsvp_accepted")

print("== the engine receives the ACTION, never the label ==")
by_action = {b.action: b for b in t.quick_replies}
check("accepted button -> RsvpAction.CONFIRMED",
      resolve_rsvp_action(button_payload=by_action["rsvp_accepted"].action) == RsvpAction.CONFIRMED)
check("declined button -> RsvpAction.DECLINED",
      resolve_rsvp_action(button_payload=by_action["rsvp_declined"].action) == RsvpAction.DECLINED)
check("maybe button -> RsvpAction.MAYBE",
      resolve_rsvp_action(button_payload=by_action["rsvp_maybe"].action) == RsvpAction.MAYBE)

print("== label is free; changing it does not change the signal ==")
# Same action, wildly different label text - resolution is identical.
check("emoji/wording/language of the label is irrelevant to resolution",
      resolve_rsvp_action(button_payload="rsvp_accepted", text="totally different label 🌸")
      == RsvpAction.CONFIRMED)

print("== resolution priority: payload > id > legacy text ==")
check("payload overrides contradictory legacy text",
      resolve_rsvp_action(button_payload="rsvp_declined", text="ברור שאני בא!") == RsvpAction.DECLINED)
check("legacy text still resolves when no payload/id (backward compatible)",
      resolve_rsvp_action(text="ברור שאני בא!") == RsvpAction.CONFIRMED)

print("== the buttons reach the Meta CREATE payload as QUICK_REPLY ==")
_payload = build_create_payload(t)
_btn_comp = next((c for c in _payload["components"] if c["type"] == "BUTTONS"), None)
check("payload has a BUTTONS component", _btn_comp is not None)
check("all three buttons emitted as QUICK_REPLY",
      _btn_comp and [b["type"] for b in _btn_comp["buttons"]] == ["QUICK_REPLY"] * 3)
check("button TEXT is the label (presentation); action is NOT sent in the shell",
      _btn_comp and [b["text"] for b in _btn_comp["buttons"]] == [b.label for b in t.quick_replies]
      and all("action" not in b for b in _btn_comp["buttons"]))

print("== validation guards the action vocabulary ==")
# (the single-stage fixture intentionally fails structural checks; we only care
# that no button-ACTION errors are raised for valid actions)
check("no button-action errors for valid actions",
      not [e for e in validate_catalog() if "semantic action" in e])
check("normalize rejects an unknown action", normalize_button_action("RSVP_SOMEDAY") is None)
# And an INVALID action IS caught: build a template carrying a bad action token.
import dataclasses  # noqa: E402
from shared.domain.messaging import validation as _val  # noqa: E402
_bad = dataclasses.replace(t, key="invite_bad",
                           quick_replies=(QuickReplyButton(label="x", action="rsvp_someday"),))
_saved = _val.ALL_TEMPLATE_LIST
_val.ALL_TEMPLATE_LIST = list(_saved) + [_bad]
try:
    _hit = any("unknown semantic action 'rsvp_someday'" in e for e in validate_catalog())
finally:
    _val.ALL_TEMPLATE_LIST = _saved
check("validation flags an UNKNOWN button action", _hit)

try:
    os.unlink(_path)
except OSError:
    pass

passed = sum(_P)
print(f"\nRESULT: {passed}/{len(_P)} checks passed")
sys.exit(0 if passed == len(_P) else 1)
