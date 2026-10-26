"""Conversation flow settings (shared/domain/flow_config.py).

Locks:
  * DEFAULT_FLOW reproduces today's webhook-worker copy byte for byte (so
    enabling the layer changes nothing until an admin edits it)
  * validation: unknown fields/vars, WhatsApp button limits, ranges
  * layered field-by-field merge + fail-safe on bad stored rows
  * render / legacy placeholder conversion
  * simulate() honours the toggles

Pure python. Run: `python3 shared/domain/tests/test_flow_config.py` or pytest.
"""
import os
import sys

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, _ROOT)

from shared.domain import flow_config as fc  # noqa: E402
from shared.domain.rsvp import GUEST_COUNT_MAX, GUEST_COUNT_MIN  # noqa: E402



# Frozen copy of the webhook-worker strings BEFORE the flow-settings integration
# (verified byte-equal to states/*.py + flow_manager.py at that point).
_ORIGINAL_TEXTS = {
    'after_confirm.ask_party_size.text': 'יופי! שמחים לדעת שתוכל להגיע ל{{event.name}} של {{event.inviters}} 🥳\nרק כדי שנוכל להתכונן כמו שצריך – כמה אנשים תגיעו? 😊\n\n *הגב בבקשה במספר בלבד*',
    'after_confirm.ask_party_size.retry_text': 'לא הצלחנו להבין כמה תהיו 😅\nנשמח למספר בלבד, בין 1 ל־50 – כולל אותך. למשל: 2',
    'after_confirm.ask_notes.text': 'תודה על העדכון! האם יש משהו שחשוב שנדע? למשל מנה צמחונית/טבעונית או כל הערה מיוחדת – נשמח אם תעדכן כאן ❤️',
    'after_confirm.ask_notes.note_prompt_text': 'בוודאי 😊 נשמח אם תכתוב לנו את ההערה כאן 👇',
    'after_confirm.done_message.text': 'מעולה! רשמנו לפנינו  ✨  \nאם יהיו שינויים, נשמח אם תעדכן כאן או תענה על ההודעה ❤️',
    'after_confirm.update_menu.text': 'נשמח אם תעדכן אותנו מה השתנה לגבי ההגעה שלך ✨  \nאפשר לעדכן את הפרטים דרך הכפתור למטה ❤️',
    'after_decline.text': 'חבל 😢 עדכנו שלא תגיע. אם תתחרט תמיד אפשר לכתוב לנו שוב!',
    'after_maybe.text': 'הכול טוב, לוקחים את הזמן 😊 נזכיר לך שוב קרוב יותר לאירוע.\nברגע שתחליט/י - אפשר לעדכן כאן בכל רגע ❤️',
    'didnt_understand.text': 'לא כל כך הבנו את התשובה 😅 נסו לבחור אחת מהאפשרויות בהודעה למעלה',
    'opt_out.text': "הוסרת מרשימת התפוצה ולא יישלחו אליך הודעות נוספות. כדי לחזור לקבל עדכונים, השב/י 'התחל'.",
}
_ORIGINAL_BUTTONS = {
    'after_confirm.ask_notes.buttons': ['אין שום דבר מיוחד', 'לכתוב לנו הערה'],
    'after_confirm.done_message.buttons': ['לעדכן הגעה'],
    'after_confirm.update_menu.buttons': ['יש הערה שלא ציינו', 'בסוף לא נוכל להגיע', 'נגיע כמות אחרת בסוף'],
    'after_decline.buttons': ['בסוף נוכל להגיע'],
    'after_maybe.buttons': ['בסוף נוכל להגיע', 'לצערי לא נוכל'],
}


def test_defaults_are_valid():
    assert fc.validate_effective(fc.DEFAULT_FLOW) == []
    assert fc.validate_override(fc.DEFAULT_FLOW) == []


def test_default_copy_is_byte_identical_to_original():
    f = fc.default_flow()
    for path, original in _ORIGINAL_TEXTS.items():
        assert f.legacy_text(path) == original, f"default drifted: {path}"
    for path, labels in _ORIGINAL_BUTTONS.items():
        assert f.buttons(path) == labels, f"default buttons drifted: {path}"


def test_states_read_the_flow_settings():
    """Every config path is consumed by webhook-worker (no dead settings)."""
    worker = os.path.join(_ROOT, "webhook-worker")
    if not os.path.isdir(worker):
        return
    src = ""
    for d in (worker, os.path.join(worker, "states")):
        for name in os.listdir(d):
            if name.endswith(".py"):
                with open(os.path.join(d, name), encoding="utf-8") as fh:
                    src += fh.read()
    for path in list(_ORIGINAL_TEXTS) + list(_ORIGINAL_BUTTONS) + [
        "after_confirm.ask_party_size.enabled", "after_confirm.ask_guest_questions.enabled",
        "after_confirm.ask_notes.enabled", "after_decline.allow_change_mind",
        "already_answered.behavior", "already_answered.text",
    ]:
        assert f'"{path}"' in src, f"webhook-worker never reads {path}"


def test_default_retry_text_matches_fstring():
    f = fc.default_flow()
    expected = ("לא הצלחנו להבין כמה תהיו 😅\n"
                f"נשמח למספר בלבד, בין 1 ל־{GUEST_COUNT_MAX} – כולל אותך. למשל: 2")
    assert f.legacy_text("after_confirm.ask_party_size.retry_text") == expected
    assert f.party_min == GUEST_COUNT_MIN and f.party_max == GUEST_COUNT_MAX


def test_legacy_conversion_and_render():
    t = "היי {guest_name}, ל{event_name} של {host_name} ב{event_date} {event_time} ב{venue}"
    assert fc.to_legacy_placeholders(t) == (
        "היי {{guest.name}}, ל{{event.name}} של {{event.inviters}} ב{{event.date}} {{event.time}} ב{{event.location}}"
    )
    assert fc.render("שלום {guest_name} ל{event_name}", {"guest_name": "דנה"}) == "שלום דנה להאירוע"
    assert fc.render("{unknown} x", {}) == "{unknown} x"
    assert fc.variables_in("a {event_name} {{event.name}} {x}") == ["event_name", "x"]


def test_unknown_variable_rejected():
    errs = fc.validate_override({"after_decline": {"text": "חבל {guest} 😢"}})
    assert errs and errs[0]["code"] == "unknown_var"
    # count vars only in party-size texts
    assert fc.validate_override({"after_decline": {"text": "עד {max_count}"}})
    assert not fc.validate_override({"after_confirm": {"ask_party_size": {"text": "עד {max_count} אנשים"}}})
    # opt-out has no event context
    assert fc.validate_override({"opt_out": {"text": "הוסרת מ{event_name}"}})


def test_unknown_field_and_types():
    assert fc.validate_override({"after_decline": {"colour": "red"}})[0]["code"] == "unknown_field"
    assert fc.validate_override({"after_decline": {"allow_change_mind": "yes"}})[0]["code"] == "type"
    assert fc.validate_override({"after_confirm": {"ask_party_size": {"max": 0}}})[0]["code"] == "range"
    assert fc.validate_override({"after_confirm": {"ask_party_size": {"max": True}}})[0]["code"] == "type"
    assert fc.validate_override({"didnt_understand": {"text": "   "}})[0]["code"] == "empty"
    assert fc.validate_override({"already_answered": {"behavior": "explode"}})[0]["code"] == "enum"
    assert fc.validate_override("nope")[0]["code"] == "type"


def test_button_limits():
    long_label = "א" * (fc.WA_BUTTON_LABEL_MAX + 1)
    errs = fc.validate_override({"after_decline": {"buttons": {"change_mind": long_label}}})
    assert errs[0]["code"] == "too_long"
    assert not fc.validate_override({"after_decline": {"buttons": {"change_mind": "א" * fc.WA_BUTTON_LABEL_MAX}}})
    assert fc.validate_override({"after_maybe": {"buttons": {"fourth": "x"}}})[0]["code"] == "unknown_key"
    assert fc.validate_override({"after_maybe": {"buttons": {"confirm": ""}}})[0]["code"] == "empty"
    assert fc.validate_override({"after_maybe": {"buttons": {"confirm": "{guest_name}"}}})
    # duplicates within one message
    errs = fc.validate_layers({"after_maybe": {"buttons": {"confirm": "לצערי לא נוכל"}}})
    assert any(e["code"] == "duplicate" for e in errs)
    for spec in fc.SCHEMA.values():
        if spec["kind"] == "buttons":
            assert len(spec["keys"]) <= fc.WA_MAX_BUTTONS


def test_min_greater_than_max():
    errs = fc.validate_layers({"after_confirm": {"ask_party_size": {"min": 10, "max": 5}}})
    assert any(e["code"] == "range" for e in errs)


def test_layered_merge_field_by_field():
    g = {"after_decline": {"text": "גלובלי"}, "after_maybe": {"remind": False}}
    t = {"after_decline": {"buttons": {"change_mind": "בעצם באים"}}}
    e = {"after_decline": {"text": "לאירוע הזה"}}
    flow = fc.build_flow(g, t, e)
    assert flow.get("after_decline.text") == "לאירוע הזה"
    assert flow.button("after_decline.buttons", "change_mind") == "בעצם באים"
    assert flow.get("after_maybe.remind") is False
    # untouched fields inherit the default
    assert flow.get("after_maybe.text") == fc.DEFAULT_FLOW["after_maybe"]["text"]
    # type layer can restore the default over a global change
    flow2 = fc.build_flow({"after_decline": {"allow_change_mind": False}},
                          {"after_decline": {"allow_change_mind": True}})
    assert flow2.enabled("after_decline.allow_change_mind")


def test_bad_stored_layer_is_ignored():
    flow = fc.build_flow({"after_decline": {"text": "{bogus}"}}, {"after_maybe": {"remind": False}})
    assert flow.get("after_decline.text") == fc.DEFAULT_FLOW["after_decline"]["text"]
    assert flow.get("after_maybe.remind") is False


def test_flow_from_rows_and_cache():
    rows = [
        {"scope": "event_type", "scope_key": "wedding", "config": '{"after_maybe": {"remind": false}}', "version": 3},
        {"scope": "global", "scope_key": "default", "config": {"after_decline": {"text": "חבל!"}}, "version": 2},
    ]
    flow = fc.flow_from_rows(rows)
    assert flow.get("after_decline.text") == "חבל!"
    assert flow.get("after_maybe.remind") is False
    assert [x["scope"] for x in flow.layers] == ["global", "event_type"]

    class _Res:
        def __init__(self, rows):
            self._rows = rows

        def fetchall(self):
            return self._rows

    class _Conn:
        calls = 0

        def execute(self, stmt, params):
            _Conn.calls += 1
            assert params == {"etype": "wedding", "eid": "e1"}
            return _Res(rows)

    fc.invalidate_cache()
    c = _Conn()
    f1 = fc.resolve_flow(c, "Wedding", "e1")
    f2 = fc.resolve_flow(c, "wedding", "e1")
    assert f1 is f2 and _Conn.calls == 1
    fc.invalidate_cache()


def test_resolve_never_raises():
    class _Broken:
        def execute(self, *a, **k):
            raise RuntimeError("relation does not exist")

        def rollback(self):
            pass

    try:
        import sqlalchemy  # noqa: F401
    except ImportError:
        pass  # resolve_flow's lazy import fails -> still defaults
    flow = fc.resolve_flow(_Broken(), "bar", None, use_cache=False)
    assert flow.data == fc.DEFAULT_FLOW


def test_normalize_and_reset():
    o = fc.normalize_override({"after_maybe": {"buttons": {"confirm": "  נגיע  "}}})
    assert o == {"after_maybe": {"buttons": {"confirm": "נגיע"}}}
    assert fc.reset_field(o, "after_maybe.buttons.confirm") == {}
    assert "after_maybe.buttons.confirm" in fc.override_paths(o)


def test_simulate_default_paths():
    tr = fc.simulate(fc.default_flow(), "wedding")
    steps = [t.get("step") for t in tr["confirm"] if t["from"] == "bot"]
    assert steps == ["invite", "ask_party_size", "ask_party_size_retry", "guest_question",
                     "ask_notes", "note_prompt", "done"]
    assert "החתונה" in tr["confirm"][2]["text"] and "נועה ואורי" in tr["confirm"][2]["text"]
    assert tr["decline"][2]["buttons"] == ["בסוף נוכל להגיע"]
    assert tr["maybe"][2]["buttons"] == ["בסוף נוכל להגיע", "לצערי לא נוכל"]
    assert tr["opt_out"][-1]["text"] == fc.DEFAULT_FLOW["opt_out"]["text"]


def test_simulate_honours_toggles():
    flow = fc.build_flow({
        "after_confirm": {"ask_party_size": {"enabled": False}, "ask_notes": {"enabled": False},
                          "ask_guest_questions": {"enabled": False}},
        "after_decline": {"allow_change_mind": False},
        "already_answered": {"behavior": "acknowledge"},
    })
    tr = fc.simulate(flow, "bar")
    assert [t.get("step") for t in tr["confirm"] if t["from"] == "bot"] == ["invite", "done"]
    assert tr["decline"][-1]["buttons"] == []
    assert tr["already_answered"][-1]["step"] == "already_answered"


def test_aresolve_flow_for_event():
    import asyncio

    class _Res:
        def __init__(self, rows):
            self._rows = rows

        def first(self):
            return self._rows[0] if self._rows else None

        def fetchall(self):
            return self._rows

    class _Session:
        def __init__(self):
            self.calls = []

        async def execute(self, stmt, params):
            self.calls.append(params)
            if "etype" not in params:
                return _Res([("bar",)])
            assert params == {"etype": "bar", "eid": "ev-1"}
            return _Res([{"scope": "event_type", "scope_key": "bar", "version": 1,
                          "config": {"after_decline": {"text": "חבל"}}}])

    fc.invalidate_cache()
    s = _Session()
    f = asyncio.run(fc.aresolve_flow_for_event(s, "ev-1"))
    assert f.get("after_decline.text") == "חבל"
    asyncio.run(fc.aresolve_flow_for_event(s, "ev-1"))
    assert len(s.calls) == 2  # second call served from cache
    fc.invalidate_cache()


if __name__ == "__main__":
    n = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            n += 1
    print(f"OK - {n} tests")
