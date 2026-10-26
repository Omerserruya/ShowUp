"""Template Studio (custom_templates) tests - validation, positional mapping,
Meta payloads, the resolver/adapter bridge, and proof that EXISTING catalog
templates deliver byte-identically.

Pytest-collectable, and runnable standalone:
    python3 shared/domain/messaging/tests/test_custom_templates.py
"""
import json
import os
import sys

os.environ.setdefault("MEDIA_S3_URL", "https://cdn.test/")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")))

from shared.domain.messaging import (  # noqa: E402
    ALL_TEMPLATES, BUILTIN_CATALOG, VariableResolver, build_meta_message, build_meta_parameters,
    resolve_template,
)
from shared.domain.messaging.catalog import MetaShape  # noqa: E402
from shared.domain.messaging import custom_templates as ct  # noqa: E402
from shared.domain.messaging.meta_adapter import _slot_value, _button_suffix  # noqa: E402

EVENT = {
    "id": "00000000-0000-0000-0000-000000000001",
    "name": "החתונה של נועה ויונתן", "event_date": "2026-12-03T19:30:00",
    "location": "אולמי הגן, תל אביב", "event_type": "wedding",
    "inviters": [{"fn": "משה", "ln": "כהן"}], "public_slug": "noa",
    "subjects": {"p1": "נועה", "p2": "יונתן", "role1": "bride", "role2": "groom"},
}
GUEST = {"name": "דוד ישראלי", "table_number": 12, "guest_count": 2}


def _doc(**over):
    d = {
        "name": "garden_invite", "title": "הזמנה לגן", "group": "invitation", "language": "he",
        "category": "MARKETING", "header": {"type": "none"},
        "body": "היי {{guest_name}}, מוזמנים ל{{event_name}} ב{{event_date}}. נשמח לראותכם!",
        "footer": "נשלח באמצעות ShowUp",
        "buttons": [{"type": "QUICK_REPLY", "text": "מגיעים!", "action": "rsvp_accepted"},
                    {"type": "QUICK_REPLY", "text": "לא נוכל", "action": "rsvp_declined"}],
    }
    d.update(over)
    return d


def _codes(res, kind="errors"):
    return {i["code"] for i in res[kind]}


# --------------------------------------------------------------------------- validation

def test_valid_doc_has_no_errors():
    assert ct.validate_doc(_doc())["errors"] == []


def test_name_rules():
    assert "invalid" in _codes(ct.validate_doc(_doc(name="Garden-Invite")))
    assert "required" in _codes(ct.validate_doc(_doc(name="")))
    assert "too_long" in _codes(ct.validate_doc(_doc(name="a" * 81)))
    assert "reserved" in _codes(ct.validate_doc(_doc(name="a__b")))
    assert "taken" in _codes(ct.validate_doc(_doc(), reserved_names={"garden_invite"}))


def test_body_variable_position_rules():
    assert "var_at_start" in _codes(ct.validate_doc(_doc(body="{{guest_name}} שלום לך, מה נשמע?")))
    assert "var_at_end" in _codes(ct.validate_doc(_doc(body="שלום רב וברוכים הבאים {{guest_name}}")))
    assert "adjacent_vars" in _codes(ct.validate_doc(_doc(body="שלום {{guest_name}} {{event_name}} מחכים לך מאוד.")))
    assert "unknown_var" in _codes(ct.validate_doc(_doc(body="שלום {{nope_var}} מחכים לך.")))
    assert "invalid_var" in _codes(ct.validate_doc(_doc(body="שלום {{1}} מחכים לך.")))
    assert "media_var" in _codes(ct.validate_doc(_doc(body="שלום {{cover_image}} מחכים לך.")))
    assert "required" in _codes(ct.validate_doc(_doc(body="  ")))
    assert "too_long" in _codes(ct.validate_doc(_doc(body="א" * 1025)))


def test_legacy_hebrew_tokens_are_canonicalized():
    d = ct.normalize_doc(_doc(body="שלום {{שם}}, נתראה ב{{ תאריך }}!"))
    assert d["body"] == "שלום {{guest_name}}, נתראה ב{{event_date}}!"


def test_custom_vars_allowed_only_for_flow_and_host_with_sample():
    body = "שלום {{owner_name}}, האירוע {{event_name}} מוכן."
    assert "unknown_var" in _codes(ct.validate_doc(_doc(body=body)))
    host = ct.validate_doc(_doc(group="host", body=body, buttons=[]))
    assert "missing_sample" in _codes(host)
    ok = ct.validate_doc(_doc(group="host", body=body, buttons=[], samples={"owner_name": "דנה"}))
    assert ok["errors"] == [] and "custom_var" in _codes(ok, "warnings")


def test_header_footer_button_rules():
    assert "too_many_vars" in _codes(ct.validate_doc(_doc(header={"type": "text", "text": "{{guest_name}} ו{{event_name}}"})))
    assert "too_long" in _codes(ct.validate_doc(_doc(header={"type": "text", "text": "א" * 61})))
    assert "image_url" in _codes(ct.validate_doc(_doc(header={"type": "image", "url": ""})))
    assert "vars" in _codes(ct.validate_doc(_doc(footer="תודה {{guest_name}}")))
    assert "too_long" in _codes(ct.validate_doc(_doc(footer="א" * 61)))
    four = [{"type": "QUICK_REPLY", "text": f"כפתור {i}"} for i in range(4)]
    assert "too_many" in _codes(ct.validate_doc(_doc(buttons=four)))
    mixed = [{"type": "QUICK_REPLY", "text": "כן"}, {"type": "URL", "text": "קישור", "url_var": "invitation_link"}]
    assert "mixed" in _codes(ct.validate_doc(_doc(buttons=mixed)))
    assert "too_long" in _codes(ct.validate_doc(_doc(buttons=[{"type": "QUICK_REPLY", "text": "א" * 26}])))
    assert "url" in _codes(ct.validate_doc(_doc(buttons=[{"type": "URL", "text": "אתר", "url": "http://x.com"}])))
    three_urls = [{"type": "URL", "text": f"ק{i}", "url": "https://x.com"} for i in range(3)]
    assert "too_many" in _codes(ct.validate_doc(_doc(buttons=three_urls)))
    assert "duplicate" in _codes(ct.validate_doc(_doc(buttons=[{"type": "QUICK_REPLY", "text": "כן"}] * 2)))


def test_group_category_language_event_types():
    assert "invalid" in _codes(ct.validate_doc(_doc(group="nope")))
    assert "invalid" in _codes(ct.validate_doc(_doc(category="AUTHENTICATION")))
    assert "invalid" in _codes(ct.validate_doc(_doc(language="hebrew")))
    assert "invalid" in _codes(ct.validate_doc(_doc(event_types=["wedding", "nope"])))


# --------------------------------------------------------------------------- payloads

def test_positional_mapping_first_appearance_order():
    numbered, order = ct.to_positional("א {{event_date}} ב {{guest_name}} ג {{event_date}}.")
    assert numbered == "א {{1}} ב {{2}} ג {{1}}." and order == ["event_date", "guest_name"]


def test_create_payload_shape():
    d = _doc(header={"type": "text", "text": "שלום {{guest_first_name}}"})
    p = ct.build_create_payload(d)
    assert p["name"] == "garden_invite" and p["language"] == "he" and p["category"] == "MARKETING"
    comps = {c["type"]: c for c in p["components"]}
    assert comps["HEADER"] == {"type": "HEADER", "format": "TEXT", "text": "שלום {{1}}",
                               "example": {"header_text": ["דוד"]}}
    assert comps["BODY"]["text"] == "היי {{1}}, מוזמנים ל{{2}} ב{{3}}. נשמח לראותכם!"
    assert comps["BODY"]["example"] == {"body_text": [["דוד כהן", "החתונה שלנו", "יום שלישי, ה־3.12.25"]]}
    assert comps["FOOTER"] == {"type": "FOOTER", "text": "נשלח באמצעות ShowUp"}
    assert comps["BUTTONS"]["buttons"] == [{"type": "QUICK_REPLY", "text": "מגיעים!"},
                                           {"type": "QUICK_REPLY", "text": "לא נוכל"}]
    # a versioned name override (resubmitting an approved template)
    assert ct.build_create_payload(d, name="garden_invite_v2")["name"] == "garden_invite_v2"


def test_image_header_and_url_buttons_payload():
    d = _doc(header={"type": "image", "url": "https://cdn.x/a.jpg"}, buttons=[
        {"type": "URL", "text": "להזמנה", "url_var": "invitation_link"},
        {"type": "URL", "text": "האתר", "url": "https://showup.co.il"}])
    p = ct.build_create_payload(d, header_handle="H123")
    assert p["components"][0] == {"type": "HEADER", "format": "IMAGE", "example": {"header_handle": ["H123"]}}
    btns = p["components"][-1]["buttons"]
    assert btns[0]["url"].endswith("/i/{{1}}") and btns[0]["example"][0].endswith("/i/demo")
    assert btns[1] == {"type": "URL", "text": "האתר", "url": "https://showup.co.il"}
    assert ct.build_create_payload(d)["components"][0]["example"]["header_handle"] == [ct.HEADER_HANDLE_PLACEHOLDER]
    assert ct.needs_header_handle(d) and not ct.needs_header_handle(_doc())
    assert set(ct.build_edit_payload(d)) == {"components", "category"}


def test_no_vars_body_has_no_example():
    p = ct.build_create_payload(_doc(body="תודה שהגעתם, היה מרגש!"))
    body = next(c for c in p["components"] if c["type"] == "BODY")
    assert "example" not in body


def test_param_hints_and_render():
    hints = ct.param_hints(_doc())
    assert [h["var"] for h in hints] == ["guest_name", "event_name", "event_date"]
    assert hints[0]["suggested"] == "{guest_name}" and hints[0]["label_he"] == "שם האורח"
    r = ct.render(_doc(header={"type": "text", "text": "שלום {{guest_first_name}}"}))
    assert r["header_text"] == "שלום דוד" and "דוד כהן" in r["body"] and r["buttons"][0]["text"] == "מגיעים!"


def test_suggest_name():
    assert ct.suggest_name("Summer Party!") == "summer_party"
    assert ct.suggest_name("הזמנה", taken={"template"}) == "template_2"


# --------------------------------------------------------------------------- send bridge

def _row(doc, *, live_status="approved", meta_name="garden_invite"):
    return {"key": doc["name"], "doc": doc, "version": 1,
            "live": {"status": live_status, "meta_name": meta_name, "doc": doc, "version": 1}}


def test_custom_ref_resolves_via_db_lookup_only():
    d = _doc()
    seen = []

    def lookup(ref):
        seen.append(ref)
        return _row(d)

    t = resolve_template("custom__garden_invite", db_lookup=lookup, event_type="wedding")
    assert seen == ["custom__garden_invite"]
    assert t.key == "custom__garden_invite" and t.is_usable and t.meta.template_name == "garden_invite"
    assert t.flow_stage.value == "invitation"
    # no lookup / missing row -> None (never a stage-default fallback)
    assert resolve_template("custom__garden_invite", flow_stage="invitation") is None
    assert resolve_template("custom__garden_invite", flow_stage="invitation", db_lookup=lambda r: None) is None


def test_only_approved_guest_stage_live_is_deliverable():
    d = _doc()
    assert not ct.template_from_custom_row(_row(d, live_status="pending")).is_usable
    assert not ct.template_from_custom_row({"key": "x", "doc": d, "live": None}).is_usable
    flow = _doc(group="flow")
    assert not ct.template_from_custom_row(_row(flow)).is_usable
    # JSON-string columns (psycopg2 without jsonb adaptation) are tolerated
    r = _row(d)
    r["live"] = json.dumps(r["live"], ensure_ascii=False)
    assert ct.template_from_custom_row(r).is_usable


def test_custom_template_delivery_payload():
    d = _doc(header={"type": "text", "text": "שלום {{guest_first_name}}"},
             buttons=[{"type": "URL", "text": "להזמנה", "url_var": "invitation_link"}])
    t = ct.template_from_custom_row(_row(d))
    vals = VariableResolver(EVENT, public_base="https://app.test").values_for(GUEST)
    msg = build_meta_message(t, vals, recipient="+972501234567", event_id="e", campaign_id="c", guest_id="g")
    assert msg["template"] == "garden_invite" and msg["language"] == "he"
    assert msg["parameters"]["header"] == {"type": "text", "text": "דוד"}
    assert msg["parameters"]["body"] == {"1": "דוד ישראלי", "2": "החתונה של נועה ויונתן", "3": "יום חמישי, ה־3.12.26"}
    assert msg["parameters"]["buttons"] == [{"type": "url", "index": 0, "url": "noa"}]


def test_custom_image_header_event_vs_fixed():
    d = _doc(header={"type": "image", "url": "https://cdn.x/sample.jpg", "source": "event"})
    vals = VariableResolver({**EVENT, "wa_image_url": "https://cdn.x/event.jpg"}).values_for(GUEST)
    p = build_meta_parameters(ct.template_from_custom_row(_row(d)), vals)
    assert p["header"] == {"type": "image", "media_url": "https://cdn.x/event.jpg"}
    d2 = _doc(header={"type": "image", "url": "https://cdn.x/sample.jpg", "source": "fixed"})
    p2 = build_meta_parameters(ct.template_from_custom_row(_row(d2)), vals)
    assert p2["header"]["media_url"] == "https://cdn.x/sample.jpg"


# --------------------------------------------------------------------------- byte-identical existing delivery

def _frozen_build_meta_parameters(template, values):
    """VERBATIM copy of meta_adapter.build_meta_parameters BEFORE Template
    Studio (commit 6fff368). Existing templates must still produce exactly this."""
    meta = template.meta
    if meta.shape == MetaShape.POSITIONAL_FLAT:
        return {str(i + 1): _slot_value(s, values) for i, s in enumerate(meta.body)}
    if meta.shape == MetaShape.NAMED_FLAT:
        return {s.key: _slot_value(s, values) for s in meta.body}
    out = {}
    if meta.header_image_var:
        out["header"] = {"type": "image", "media_url": values.get(meta.header_image_var, "")}
    out["body"] = {str(i + 1): _slot_value(s, values) for i, s in enumerate(meta.body)}
    if meta.buttons:
        qr_offset = min(len(template.quick_replies or ()), 3)
        out["buttons"] = [
            {"type": b.type, "index": qr_offset + b.index, "url": _button_suffix(values.get(b.var) or b.default)}
            for b in meta.buttons
        ]
    return out


def test_existing_templates_deliver_byte_identically():
    resolver = VariableResolver({**EVENT, "wa_image_url": "https://cdn.x/e.jpg"}, public_base="https://app.test")
    guests = [GUEST, {"name": ""}, {}]
    checked = 0
    for t in ALL_TEMPLATES.values():
        if t.meta is None:
            continue
        for g in guests:
            vals = resolver.values_for(g)
            new = json.dumps(build_meta_parameters(t, vals), sort_keys=True, ensure_ascii=False)
            old = json.dumps(_frozen_build_meta_parameters(t, vals), sort_keys=True, ensure_ascii=False)
            assert new == old, t.key
            checked += 1
    assert checked > 0


def test_no_catalog_key_or_meta_name_collides_with_custom_prefix():
    for t in ALL_TEMPLATES.values():
        assert not t.key.startswith(ct.CUSTOM_REF_PREFIX)
        assert not (t.meta and t.meta.template_name.startswith(ct.CUSTOM_REF_PREFIX))
    # catalog refs still resolve exactly as before even when a db_lookup is wired
    calls = []
    for key in BUILTIN_CATALOG:
        a = resolve_template(key, event_type="wedding")
        b = resolve_template(key, event_type="wedding", db_lookup=lambda r: calls.append(r))
        assert a is b
    assert calls == []


def test_doc_from_catalog_template_is_valid_draft():
    usable = [t for t in ALL_TEMPLATES.values() if t.is_usable and "[[" not in (t.body or "")]
    assert usable
    d = ct.doc_from_catalog_template(usable[0], name="copy_of_catalog")
    assert d["name"] == "copy_of_catalog" and d["group"] == usable[0].flow_stage.value
    assert d["body"] == ct.normalize_doc({"body": usable[0].body})["body"]


if __name__ == "__main__":
    fns = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = 0
    for n, f in fns:
        try:
            f()
            print(f"  [PASS] {n}")
        except Exception as exc:  # pragma: no cover
            failed += 1
            print(f"  [FAIL] {n}: {exc!r}")
    print(f"\nRESULT: {len(fns) - failed}/{len(fns)} checks passed")
    sys.exit(1 if failed else 0)
