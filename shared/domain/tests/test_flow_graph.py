"""Flow graph (shared/domain/flow_graph.py) - pure tests.

Locks:
  * DEFAULT_GRAPH validates with no errors/warnings, uses the legacy state names
    as node ids and the flow-settings copy byte for byte
  * build_default_graph overlays flow settings (texts, buttons, bounds, toggles)
  * validation: ids, edge references, button limits/labels, variables, fields,
    entry, unreachable / self-loop warnings
  * interpreter: edge matching order, typed-only rsvp, positional/legacy-label
    button ids, skip pass-through, host-question loop, message chaining
  * simulate(): transcript + actions, no I/O

The end-to-end legacy-vs-graph equivalence proof (messages + DB writes) is
webhook-worker/tests/test_flow_graph_equivalence_db.py.

Run: `python3 shared/domain/tests/test_flow_graph.py` or pytest.
"""
import copy
import os
import sys

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, _ROOT)

from shared.domain import flow_config as fc  # noqa: E402
from shared.domain import flow_graph as fg  # noqa: E402

LEGACY_STATES = {"rsvp_invite", "rsvp_count", "rsvp_count_retry", "rsvp_info_question", "note_info", "rsvp_done",
                 "rsvp_update", "rsvp_decline", "rsvp_maybe", "didnt_understand", "question_answer",
                 "question_answer_retry"}


def _node(g, nid):
    return next(n for n in g["nodes"] if n["id"] == nid)


def _codes(res, key="errors"):
    return {i["code"] for i in res[key]}


def test_default_graph_is_clean_and_legacy_compatible():
    res = fg.validate_graph(fg.DEFAULT_GRAPH)
    assert res == {"errors": [], "warnings": []}, res
    assert {n["id"] for n in fg.DEFAULT_GRAPH["nodes"]} == LEGACY_STATES
    assert set(fg.DEFAULT_GRAPH["entry"].values()) == {"rsvp_invite"}
    D = fc.DEFAULT_FLOW
    g = fg.DEFAULT_GRAPH
    assert _node(g, "rsvp_count")["text"] == D["after_confirm"]["ask_party_size"]["text"]
    assert _node(g, "rsvp_count_retry")["text"] == D["after_confirm"]["ask_party_size"]["retry_text"]
    assert _node(g, "rsvp_done")["text"] == D["after_confirm"]["done_message"]["text"]
    assert [b["label"] for b in _node(g, "rsvp_update")["buttons"]] == list(
        D["after_confirm"]["update_menu"]["buttons"].values())
    assert _node(g, "rsvp_count")["number"] == {"min": 1, "max": 50}
    assert not any(n.get("skip") for n in g["nodes"])


def test_overlay_flow_settings():
    flow = fc.FlowConfig(fc.merge_layers({
        "after_confirm": {"ask_party_size": {"enabled": False, "max": 5},
                          "ask_notes": {"buttons": {"no_notes": "הכל טוב"}}},
        "after_decline": {"allow_change_mind": False},
        "didnt_understand": {"text": "סליחה {guest_name}?"},
    }))
    g = fg.build_default_graph(flow)
    assert not fg.validate_graph(g)["errors"]
    assert _node(g, "rsvp_count")["skip"] is True and _node(g, "rsvp_count")["number"]["max"] == 5
    assert _node(g, "rsvp_info_question")["buttons"][0]["label"] == "הכל טוב"
    assert _node(g, "rsvp_decline")["buttons"][0].get("hidden") is True
    assert _node(g, "didnt_understand")["text"] == "סליחה {guest_name}?"


def test_validation_errors():
    g = fg.default_graph()
    g["nodes"].append(copy.deepcopy(g["nodes"][0]))                       # duplicate id
    _node(g, "rsvp_update")["buttons"].append({"id": "x", "label": "רביעי"})  # 4 buttons
    _node(g, "rsvp_done")["buttons"][0]["label"] = "א" * 21                # too long
    _node(g, "rsvp_maybe")["text"] = "היי {nope}"                          # unknown var
    g["edges"].append({"id": "zz", "from": "rsvp_done", "to": "ghost", "when": {"kind": "any_text"}})
    g["edges"].append({"id": "zz", "from": "rsvp_done", "to": None, "when": {"kind": "button", "button_id": "nope"},
                       "actions": [{"type": "set_field", "field": "salary", "value": "1"},
                                   {"type": "set_rsvp", "value": "yes"}]})
    g["entry"]["reminder"] = "ghost"
    res = fg.validate_graph(g)
    codes = _codes(res)
    for c in ("duplicate_id", "too_many_buttons", "too_long", "unknown_var", "missing_node", "unknown_button",
              "unknown_field", "bad_value"):
        assert c in codes, (c, codes)
    assert any(e.get("node_id") == "rsvp_maybe" and e["path"].endswith(".text") for e in res["errors"])
    assert any(e.get("edge_id") == "zz" for e in res["errors"])


def test_validation_edges_required_and_warnings():
    g = fg.default_graph()
    g["edges"] = [e for e in g["edges"] if e["from"] != "rsvp_maybe"]
    res = fg.validate_graph(g)
    assert any(e["code"] == "no_edges" and e["node_id"] == "rsvp_maybe" for e in res["errors"])

    g = fg.default_graph()
    g["nodes"].append({"id": "orphan", "type": "message", "title": "x", "text": "hi", "input": "none", "buttons": []})
    g["edges"].append({"id": "loop", "from": "orphan", "to": "orphan", "when": {"kind": "any_text"}})
    res = fg.validate_graph(g)
    assert not res["errors"], res
    assert {"unreachable", "self_loop"} <= _codes(res, "warnings")

    g = fg.default_graph()
    g["entry"] = {}
    assert "no_entry" in _codes(fg.validate_graph(g))
    assert "custom:shuttle" and fg.is_known_field("custom:shuttle") and not fg.is_known_field("custom:")


def _step(g, node, *, text="", button_id=None, action=None, reply_kind=None, questions=None):
    G = fg.Graph(g)
    ctx = fg.Ctx(questions=copy.deepcopy(questions or []))
    ib = fg.Inbound(text=text, button_id=button_id, action=action, reply_kind=reply_kind)
    return fg.step(G, fg.start_node(G, node, ib), ib, ctx, fg.Graph(fg.DEFAULT_GRAPH))


def test_interpreter_routing():
    g = fg.DEFAULT_GRAPH
    r = _step(g, "rsvp_invite", text="ברור שאגיע!", action="confirmed", reply_kind="template_button")
    assert r.node_id == "rsvp_count" and [e["value"] for e in r.effects] == ["confirmed"]
    assert r.sends[0]["kind"] == "text"
    # template RSVP tap from anywhere restarts at the entry
    assert _step(g, "rsvp_done", text="x", action="declined", reply_kind="template_button").node_id == "rsvp_decline"
    # typed decline at count = change of heart; a BUTTON with decline meaning at done does not
    assert _step(g, "rsvp_count", text="לא נגיע", action="declined").node_id == "rsvp_decline"
    r = _step(g, "rsvp_done", text="x", button_id="rsvp_invite__btn_2", action="declined", reply_kind="button_reply")
    assert r.node_id == "rsvp_done"
    # number / invalid
    r = _step(g, "rsvp_count", text="3")
    assert r.node_id == "rsvp_info_question" and r.effects[0] == {
        "type": "set_field", "edge_id": r.effects[0]["edge_id"], "node_id": "rsvp_count", "field": "guest_count",
        "raw": "{answer}", "value": "3"}
    assert _step(g, "rsvp_count", text="77").node_id == "rsvp_count_retry"
    # positional id, raw id, current label, legacy default label
    assert _step(g, "rsvp_done", button_id="rsvp_done__BTN_1").node_id == "rsvp_update"
    assert _step(g, "rsvp_update", button_id="decline").node_id == "rsvp_decline"
    renamed = fg.build_default_graph(fc.FlowConfig(fc.merge_layers(
        {"after_maybe": {"buttons": {"confirm": "בעצם כן"}}})))
    assert _step(renamed, "rsvp_maybe", text="בעצם כן").node_id == "rsvp_count"
    assert _step(renamed, "rsvp_maybe", text="בסוף נוכל להגיע").node_id == "rsvp_count"
    # unknown state -> entry
    assert _step(g, "some_old_state", text="מה?").node_id == "didnt_understand"
    # didn't understand -> re-sends the invitation template
    r = _step(g, "didnt_understand", text="???")
    assert r.node_id == "rsvp_invite" and r.sends[0]["kind"] == "template" and r.sends[0]["template"] == "event_no_pic"


def test_skip_and_question_loop():
    Q = [{"id": "f1", "label": "הסעה?", "options": ["כן", "לא"]}, {"id": "f2", "label": "מנה?", "options": ["א", "ב"]}]
    off = fg.build_default_graph(fc.FlowConfig(fc.merge_layers(
        {"after_confirm": {"ask_party_size": {"enabled": False}, "ask_notes": {"enabled": False}}})))
    r = _step(off, "rsvp_invite", action="confirmed", reply_kind="template_button")
    assert r.node_id == "rsvp_done"
    r = _step(off, "rsvp_invite", action="confirmed", reply_kind="template_button", questions=Q)
    assert r.node_id == "question_answer" and r.sends[0]["question"]["id"] == "f1"
    g = fg.DEFAULT_GRAPH
    r = _step(g, "question_answer", text="כן", questions=Q)
    assert r.effects[0]["type"] == "store_answer" and r.node_id == "question_answer" \
        and r.sends[0]["question"]["id"] == "f2"
    r = _step(g, "question_answer", text="???", questions=Q)
    assert r.node_id == "question_answer_retry" and not r.effects
    r = _step(g, "question_answer_retry", text="???", questions=Q)
    assert r.effects[0] == {"type": "store_answer", "field_id": "f1", "value": None, "node_id": "question_answer_retry"}
    assert r.node_id == "question_answer" and r.sends[0]["text"] == _node(g, "question_answer")["text"]
    r = _step(g, "question_answer", text="ב", questions=Q[1:])
    assert r.node_id == "rsvp_info_question"


def test_message_chaining_and_list():
    g = {"schema_version": 1, "entry": {"default": "a"},
         "nodes": [{"id": "a", "type": "template", "input": "none", "buttons": []},
                   {"id": "m", "type": "message", "text": "שלום", "input": "none", "buttons": []},
                   {"id": "l", "type": "question", "text": "בחר", "input": "list",
                    "buttons": [{"id": f"o{i}", "label": f"אפשרות {i}"} for i in range(5)]}],
         "edges": [{"id": "1", "from": "a", "to": "m", "when": {"kind": "any_text"}},
                   {"id": "2", "from": "m", "to": "l", "when": {"kind": "done"}},
                   {"id": "3", "from": "l", "to": None, "when": {"kind": "button", "button_id": "o3"},
                    "actions": [{"type": "add_tag", "tag": "x"}]}]}
    assert not fg.validate_graph(g)["errors"]
    r = _step(g, "a", text="hi")
    assert [s["kind"] for s in r.sends] == ["text", "list"] and r.node_id == "l"
    r = _step(g, "l", button_id="l__BTN_4")
    assert r.node_id == "l" and r.effects[0]["tag"] == "x" and not r.sends


def test_simulate():
    out = fg.simulate(fg.DEFAULT_GRAPH, [
        {"kind": "button", "button_id": "rsvp_accepted"}, {"kind": "text", "text": "2"},
        {"kind": "button", "button_id": "0"}, {"kind": "button", "button_id": "no_notes"}], event_type="wedding")
    bots = [t for t in out["turns"] if t["from"] == "bot"]
    assert [t["node_id"] for t in bots] == ["rsvp_invite", "rsvp_count", "question_answer", "rsvp_info_question",
                                            "rsvp_done"]
    assert "החתונה" in bots[1]["text"] and "נועה ואורי" in bots[1]["text"]
    assert bots[-1]["buttons"] == [{"id": "update", "label": "לעדכן הגעה"}]
    assert out["final_node"] == "rsvp_done"
    assert [a["type"] for a in out["actions"]] == ["set_rsvp", "set_field", "set_rsvp", "store_answer"]


def test_meta():
    m = fg.meta()
    assert {k["kind"] for k in m["edge_kinds"]} == set(fg.EDGE_KINDS)
    assert {"answer", "party_size", "guest_name"} <= {v["name"] for v in m["variables"]}
    assert {s["stage"] for s in m["entry_stages"]} == set(fg.ENTRY_STAGES)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for f in fns:
        f()
        print("PASS", f.__name__)
    print(f"RESULT: {len(fns)}/{len(fns)} passed")
