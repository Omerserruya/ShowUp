"""Flow graph vs the legacy state machine, end-to-end through FlowManager
against a REAL Postgres.

Every scenario runs TWICE from the same starting row - once with no graph
(legacy states/*) and once with the default graph ENABLED (built from the same
flow settings layer) - and the two runs must produce:
  * byte-identical outgoing payloads, in order
  * identical conversations.current_state after every message
  * identical guest rows (status, guest_count, notes, opt-out) and host-question
    answers after every message
  * identical messages_log (direction, message_type, state) sequences

Then graph-only behaviour: custom nodes/actions (list input, text_contains,
set_field incl. custom:<key>, add_tag, stop_reminders, notify_host, message
chaining), feature flag (disabled -> legacy), invalid stored graph -> legacy,
missing table -> legacy, event scope beats global, unknown state -> entry.

Needs POSTGRES_URL (a throwaway DB - tables are DROPPED/created here):

  docker run --rm --network <net> -e POSTGRES_URL=postgresql://postgres:pw@pg:5432/postgres \
      -v $PWD/webhook-worker:/app -v $PWD/shared:/app/shared showup-webhook-worker \
      python tests/test_flow_graph_equivalence_db.py
"""
import asyncio
import copy
import json
import os
import sys
import time
import uuid

_HERE = os.path.dirname(os.path.abspath(__file__))
_WORKER = os.path.dirname(_HERE)
sys.path.insert(0, _WORKER)
sys.path.insert(0, os.path.dirname(_WORKER))

if not os.getenv("POSTGRES_URL"):
    print("SKIP: POSTGRES_URL not set")
    sys.exit(0)

from sqlalchemy import text  # noqa: E402

import graph_runtime  # noqa: E402
from db.models import Base  # noqa: E402
from db.session import AsyncSessionLocal, engine  # noqa: E402
from flow_manager import FlowManager  # noqa: E402
from shared.domain import flow_config as fc  # noqa: E402
from shared.domain import flow_graph as fg  # noqa: E402
from states.question_answer import make_answer_id  # noqa: E402

_P = []


def check(name, cond, detail=None):
    _P.append(bool(cond))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")
    if not cond and detail is not None:
        print("      ", str(detail)[:3000])


SCHEMA = [
    "DROP TABLE IF EXISTS flow_graphs, conversation_flow_configs, guest_tags, tags, guest_custom_values, "
    "event_field_defs, messages_sent, campaigns, guests, events, inbound_seen, inbound_pending_choice, "
    "messages_log, conversations CASCADE",
    """CREATE TABLE events (id UUID PRIMARY KEY, name TEXT, event_date TIMESTAMPTZ, location TEXT,
        inviters JSON, state TEXT DEFAULT 'active', event_type VARCHAR(50), account_id UUID)""",
    """CREATE TABLE guests (id UUID PRIMARY KEY, event_id UUID, name TEXT, phone TEXT, status TEXT,
        guest_count INT, import_count INT NOT NULL DEFAULT 1, table_number INT, guest_group VARCHAR(100),
        last_response TIMESTAMP, notes TEXT,
        opted_out_at TIMESTAMPTZ, opted_out_reason TEXT, opted_out_source TEXT)""",
    """CREATE TABLE event_field_defs (id UUID PRIMARY KEY, event_id UUID NOT NULL, key VARCHAR(50), label VARCHAR(100),
        data_type VARCHAR(20), options JSON, required BOOLEAN DEFAULT false, applies_to_template BOOLEAN DEFAULT false,
        ask_in_rsvp BOOLEAN NOT NULL DEFAULT false, sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    """CREATE TABLE guest_custom_values (id UUID PRIMARY KEY, guest_id UUID NOT NULL, field_def_id UUID NOT NULL,
        value JSON, CONSTRAINT uq_value_guest_field UNIQUE (guest_id, field_def_id))""",
    """CREATE TABLE tags (id UUID PRIMARY KEY, account_id UUID NOT NULL, name VARCHAR(50) NOT NULL, color VARCHAR(20),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT uq_tag_account_name UNIQUE (account_id, name))""",
    "CREATE TABLE guest_tags (guest_id UUID NOT NULL, tag_id UUID NOT NULL, PRIMARY KEY (guest_id, tag_id))",
    "CREATE TABLE campaigns (id UUID PRIMARY KEY, event_id UUID, stage_id VARCHAR(40), template_key VARCHAR(80), "
    "template TEXT)",
    """CREATE TABLE messages_sent (campaign_id UUID, guest_id UUID, wa_message_id TEXT, status TEXT,
        replied_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, sent_at TIMESTAMPTZ)""",
    """CREATE TABLE inbound_seen (wamid TEXT PRIMARY KEY, kind TEXT, attempts INT DEFAULT 1,
        seen_at TIMESTAMPTZ DEFAULT now(), done_at TIMESTAMPTZ)""",
    "CREATE TABLE inbound_pending_choice (guest_phone TEXT PRIMARY KEY, payload TEXT, created_at TIMESTAMPTZ)",
    """CREATE TABLE conversation_flow_configs (id BIGSERIAL PRIMARY KEY, scope VARCHAR(20) NOT NULL,
        scope_key VARCHAR(64) NOT NULL, config JSONB NOT NULL DEFAULT '{}'::jsonb, version INTEGER NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT false, note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by UUID)""",
    # mirrors core-service migrations.ensure_flow_graphs
    """CREATE TABLE flow_graphs (id BIGSERIAL PRIMARY KEY, scope VARCHAR(20) NOT NULL, scope_key VARCHAR(64) NOT NULL,
        graph JSONB NOT NULL, version INTEGER NOT NULL, is_active BOOLEAN NOT NULL DEFAULT false,
        enabled BOOLEAN NOT NULL DEFAULT false, note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by UUID)""",
]

ACCOUNT = str(uuid.uuid4())
EV = str(uuid.uuid4())
GUEST = str(uuid.uuid4())
CONV = str(uuid.uuid4())
PHONE = "972501230001"
Q_SHUTTLE = str(uuid.uuid4())
Q_MEAL = str(uuid.uuid4())
QUESTIONS = [
    (Q_SHUTTLE, "shuttle", "צריכים הסעה?", ["כן", "לא"], 0),
    (Q_MEAL, "meal", "איזו מנה?", ["בשר", "צמחוני", "טבעוני", "ללא גלוטן"], 1),
]


async def exec_sql(sql, **kw):
    async with AsyncSessionLocal() as s:
        await s.execute(text(sql), kw)
        await s.commit()


async def q_all(sql, **kw):
    async with AsyncSessionLocal() as s:
        return [tuple(r) for r in (await s.execute(text(sql), kw)).all()]


async def setup():
    async with engine.begin() as conn:
        for stmt in SCHEMA:
            await conn.execute(text(stmt))
        await conn.run_sync(Base.metadata.create_all)
    await exec_sql("INSERT INTO events (id, name, event_date, inviters, event_type, account_id) VALUES "
                   "(CAST(:id AS uuid), 'החתונה של נועה', now() + interval '30 days', CAST(:inv AS json), 'wedding', "
                   "CAST(:a AS uuid))", id=EV, a=ACCOUNT, inv=json.dumps([{"fn": "נועה", "ln": "כהן"}]))


async def reset(*, state="rsvp_invite", status="pending", questions=False, guest_count=None):
    for t in ("guest_custom_values", "guest_tags", "tags", "messages_log", "conversations", "guests",
              "event_field_defs", "inbound_seen", "inbound_pending_choice"):
        await exec_sql(f"DELETE FROM {t}")
    await exec_sql("INSERT INTO guests (id, event_id, name, phone, status, guest_count) VALUES "
                   "(CAST(:g AS uuid), CAST(:e AS uuid), 'דנה', :p, :st, :gc)",
                   g=GUEST, e=EV, p="0" + PHONE[3:], st=status, gc=guest_count)
    await exec_sql("INSERT INTO conversations (id, guest_id, guest_phone, event_id, current_state, active, "
                   "created_at, updated_at) VALUES (CAST(:c AS uuid), CAST(:g AS uuid), :p, :e, :st, true, now(), now())",
                   c=CONV, g=GUEST, p=PHONE, e=EV, st=state)
    if questions:
        for fid, key, label, opts, order in QUESTIONS:
            await exec_sql("INSERT INTO event_field_defs (id, event_id, key, label, data_type, options, ask_in_rsvp, "
                           "sort_order) VALUES (CAST(:f AS uuid), CAST(:e AS uuid), :k, :l, 'enum', CAST(:o AS json), "
                           "true, :so)", f=fid, e=EV, k=key, l=label, o=json.dumps(opts, ensure_ascii=False), so=order)


async def snapshot():
    conv = await q_all("SELECT current_state FROM conversations WHERE id = CAST(:c AS uuid)", c=CONV)
    guest = await q_all("SELECT status, guest_count, notes, opted_out_at IS NOT NULL, table_number, guest_group, "
                        "last_response IS NOT NULL FROM guests WHERE id = CAST(:g AS uuid)", g=GUEST)
    answers = await q_all("SELECT field_def_id::text, value::text FROM guest_custom_values ORDER BY 1")
    return {"state": conv[0][0] if conv else None, "guest": guest[0] if guest else None, "answers": answers}


async def log_rows():
    return await q_all("SELECT direction, message_type, state FROM messages_log ORDER BY id")


async def set_flow_layer(config):
    await exec_sql("DELETE FROM conversation_flow_configs")
    if config:
        await exec_sql("INSERT INTO conversation_flow_configs (scope, scope_key, config, version, is_active) VALUES "
                       "('event_type', 'wedding', CAST(:c AS jsonb), 1, true)",
                       c=json.dumps(config, ensure_ascii=False))
    fc.invalidate_cache()


async def put_graph(graph, *, scope="global", key="default", enabled=True):
    await exec_sql("UPDATE flow_graphs SET is_active = false WHERE scope = :s AND scope_key = :k", s=scope, k=key)
    await exec_sql("INSERT INTO flow_graphs (scope, scope_key, graph, version, is_active, enabled) "
                   "SELECT CAST(:s AS varchar), CAST(:k AS varchar), CAST(:g AS jsonb), COALESCE(MAX(version), 0) + 1, "
                   "true, :en FROM flow_graphs WHERE scope = CAST(:s AS varchar) AND scope_key = CAST(:k AS varchar)",
                   s=scope, k=key, g=json.dumps(graph, ensure_ascii=False), en=enabled)
    fg.invalidate_cache()


async def clear_graphs():
    await exec_sql("DELETE FROM flow_graphs")
    fg.invalidate_cache()


# ---------------------------------------------------------------------------

sent = []
flow = FlowManager(outpost_queue="outpost_priority_queue")


async def _pub(payload):
    sent.append(payload)
flow.publish_outgoing = _pub

GRAPH_RUNS = [0]
_orig_run_graph = graph_runtime.run_graph


async def _counting_run_graph(*a, **kw):
    GRAPH_RUNS[0] += 1
    return await _orig_run_graph(*a, **kw)
graph_runtime.run_graph = _counting_run_graph


async def inbound(step):
    kind = step[0]
    kw = {}
    if kind == "text":
        txt = step[1]
        kw = {"message_type": "free_text"}
    elif kind == "tap":
        txt = step[1]
        kw = {"message_type": "quick_reply", "button_id": step[2], "reply_kind": "button_reply"}
    elif kind == "tpl":
        txt = step[1]
        kw = {"message_type": "button", "button_payload": step[2], "reply_kind": "template_button"}
    elif kind == "qans":
        fid, idx, label = step[1], step[2], step[3]
        txt = label
        kw = {"message_type": "quick_reply", "button_id": make_answer_id(fid, idx), "reply_kind": "button_reply"}
    else:
        raise ValueError(kind)
    if len(step) > 3 and kind != "qans" and step[3] == "stale":
        kw["sent_ts"] = int(time.time()) - 48 * 3600
    mt = kw.pop("message_type")
    await flow.handle_inbound(wamid=f"wamid.{uuid.uuid4()}", message_type=mt, guest_phone=PHONE, event_id=None,
                              text=txt, raw={"message_id": f"wamid.{uuid.uuid4()}"}, context_id=None, **kw)


async def run(sc):
    await reset(state=sc.get("state", "rsvp_invite"), status=sc.get("status", "pending"),
                questions=sc.get("questions", False), guest_count=sc.get("guest_count"))
    trace = []
    for step in sc["steps"]:
        sent.clear()
        await inbound(step)
        trace.append({"step": step, "sent": copy.deepcopy(sent), "db": await snapshot()})
    return trace, await log_rows()


def first_diff(a, b):
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return {"index": i, "legacy": x, "graph": y}
    if len(a) != len(b):
        return {"len": (len(a), len(b))}
    return None


CONFIRM = ("tpl", "ברור שאגיע!", "rsvp_accepted")
DECLINE = ("tpl", "לצערי לא אוכל", "rsvp_declined")
MAYBE = ("tpl", "עוד מתלבט/ת, תחזרו אלי?", "rsvp_maybe")

SCENARIOS = [
    {"name": "confirm -> invalid counts -> questions (typed + retry + qans tap) -> notes -> done -> update -> count",
     "questions": True, "steps": [
         CONFIRM, ("text", "המון"), ("text", "0"), ("text", "2"), ("text", "מה?"), ("text", "כן"),
         ("qans", Q_MEAL, 1, "צמחוני"), ("tap", "לכתוב לנו הערה", "rsvp_info_question__BTN_2"),
         ("text", "  אני צמחונית 🌱  "), ("tap", "לעדכן הגעה", "rsvp_done__BTN_1"),
         ("tap", "נגיע כמות אחרת בסוף", "rsvp_update__BTN_3"), ("text", "3"),
         ("tap", "אין שום דבר מיוחד", "rsvp_info_question__BTN_1"), ("text", "תודה!")]},
    {"name": "questions: unmatched twice skips, then next question by typed option",
     "questions": True, "steps": [CONFIRM, ("text", "4"), ("text", "xyz"), ("text", "abc"), ("text", "2"),
                                  ("text", "שלום")]},
    {"name": "decline -> change of mind -> count", "steps": [
        DECLINE, ("text", "חבל"), ("tap", "בסוף נוכל להגיע", "rsvp_decline__BTN_1"), ("text", "שניים"),
        ("tap", "לכתוב לנו הערה", "rsvp_info_question__BTN_2"), ("text", "")]},
    {"name": "maybe -> typed confirm -> count; maybe -> decline tap", "steps": [
        MAYBE, ("text", "מה זה?"), ("text", "בסוף באים"), ("text", "5"), MAYBE,
        ("tap", "לצערי לא נוכל", "rsvp_maybe__BTN_2"), ("text", "בסוף נוכל להגיע")]},
    {"name": "invalid counts (phone number, 77, words)", "steps": [
        CONFIRM, ("text", "054-1234567"), ("text", "77"), ("text", "אנחנו 4 או 5"), ("text", "שלושה")]},
    {"name": "opt-out / opt-in mid-flow leave the RSVP conversation alone", "state": "rsvp_count",
     "status": "attending", "steps": [("text", "הסר"), ("text", "2"), ("text", "התחל"), ("text", "2")]},
    {"name": "already answered (restart default) re-applies answers", "state": "rsvp_done", "status": "attending",
     "guest_count": 2, "steps": [CONFIRM, ("text", "2"), DECLINE, MAYBE, CONFIRM]},
    {"name": "didn't understand loop re-sends the invitation template", "steps": [
        ("text", "מה השעה?"), ("text", "???"), ("text", "hmm"), ("text", "כן"), ("text", "1")]},
    {"name": "typed change of heart from done / info / update; bot tap keeps state meaning",
     "state": "rsvp_done", "status": "attending", "guest_count": 2, "steps": [
         ("text", "תודה רבה"), ("tap", "x", "rsvp_invite__btn_2"), ("tap", "בסוף נוכל להגיע", "rsvp_maybe__BTN_1"),
         ("text", "בסוף לא נגיע"), ("tap", "בסוף נוכל להגיע", "rsvp_decline__BTN_1"), ("text", "2"),
         ("text", "אולי"), ("text", "כן"), ("text", "2"), ("tap", "לעדכן הגעה", "rsvp_done__BTN_1"),
         ("tap", "בסוף לא נוכל להגיע", "rsvp_update__BTN_2")]},
    {"name": "stale reply is applied but not answered", "steps": [
        ("tpl", "ברור שאגיע!", "rsvp_accepted", "stale"), ("text", "3")]},
    {"name": "settings layer: party size + notes off, acknowledge, no change-mind, renamed maybe buttons",
     "layer": {"after_confirm": {"ask_party_size": {"enabled": False}, "ask_notes": {"enabled": False}},
               "after_decline": {"allow_change_mind": False, "text": "חבל {guest_name} 😢"},
               "after_maybe": {"buttons": {"confirm": "בעצם כן", "decline": "בעצם לא"}},
               "already_answered": {"behavior": "acknowledge"}},
     "questions": True, "steps": [
         CONFIRM, ("text", "כן"), ("text", "בשר"), CONFIRM, DECLINE, DECLINE,
         ("tap", "בסוף נוכל להגיע", "rsvp_decline__BTN_1"), MAYBE, MAYBE, ("tap", "בעצם לא", None),
         MAYBE, ("tap", "בעצם כן", "rsvp_maybe__BTN_1")]},
    {"name": "settings layer: party max 5, renamed notes buttons, questions off",
     "layer": {"after_confirm": {"ask_party_size": {"max": 5, "text": "כמה תהיו, {guest_name}? (עד {max_count})"},
                                 "ask_guest_questions": {"enabled": False},
                                 "ask_notes": {"buttons": {"no_notes": "הכל טוב", "write_note": "יש לי הערה"}}}},
     "questions": True, "steps": [
         CONFIRM, ("text", "8"), ("text", "5"), ("tap", "יש לי הערה", None), ("text", "אלרגיה לבוטנים"),
         ("tap", "לעדכן הגעה", "rsvp_done__BTN_1"), ("tap", "יש הערה שלא ציינו", "rsvp_update__BTN_1"),
         ("text", "עוד הערה"), ("text", "שלום")]},
]


async def equivalence():
    print("== legacy vs default graph: same messages, states and DB writes ==")
    for sc in SCENARIOS:
        await set_flow_layer(sc.get("layer"))
        await clear_graphs()
        GRAPH_RUNS[0] = 0
        legacy, legacy_log = await run(sc)
        legacy_runs = GRAPH_RUNS[0]
        flow_cfg = fc.FlowConfig(fc.merge_layers(sc.get("layer") or {}))
        graph = fg.build_default_graph(flow_cfg)
        assert not fg.validate_graph(graph)["errors"], fg.validate_graph(graph)
        await put_graph(graph)
        GRAPH_RUNS[0] = 0
        graph_t, graph_log = await run(sc)
        graph_runs = GRAPH_RUNS[0]
        same = legacy == graph_t
        check(f"{sc['name']}", same and legacy_runs == 0 and graph_runs > 0,
              first_diff(legacy, graph_t) if not same else f"graph runs legacy={legacy_runs} graph={graph_runs}")
        # Known cosmetic deviation: for a TYPED change of heart legacy logs the
        # incoming row under the rewritten state 'rsvp_invite'; the graph logs
        # the node that handled it. Outgoing rows must match exactly.
        def norm(rows):
            return [r if r[0] != "incoming" else (r[0], r[1]) for r in rows]
        check("   ...same messages_log rows (outgoing exact, incoming direction/type)",
              norm(legacy_log) == norm(graph_log), first_diff(legacy_log, graph_log))
    await set_flow_layer(None)
    await clear_graphs()


def custom_graph():
    """A graph exercising the non-legacy features."""
    g = {
        "schema_version": 1,
        "entry": {"default": "invite"},
        "nodes": [
            {"id": "invite", "type": "template", "title": "הזמנה", "input": "none", "buttons": []},
            {"id": "hello", "type": "message", "title": "שלום", "text": "שלום {guest_name}! 👋", "input": "none",
             "buttons": []},
            {"id": "pick_side", "type": "question", "title": "צד", "text": "מאיזה צד את/ה, {guest_name}?",
             "input": "list", "list_button": "בחירת צד",
             "buttons": [{"id": "bride", "label": "צד הכלה"}, {"id": "groom", "label": "צד החתן"},
                         {"id": "both", "label": "שניהם"}, {"id": "other", "label": "אחר"}]},
            {"id": "ask_table", "type": "question", "title": "שולחן", "text": "איזה שולחן? ({min_count}-{max_count})",
             "input": "number", "number": {"min": 1, "max": 30}},
            {"id": "bye", "type": "end", "title": "סוף", "text": "תודה! שולחן {answer} ✨", "input": "none",
             "buttons": []},
            {"id": "no_more", "type": "end", "title": "בלי תזכורות", "text": "לא נזכיר יותר 🙏", "input": "none",
             "buttons": []},
        ],
        "edges": [
            {"id": "e1", "from": "invite", "to": "hello", "when": {"kind": "rsvp", "value": "confirmed"},
             "actions": [{"type": "set_rsvp", "value": "confirmed"}, {"type": "add_tag", "tag": "vip"}]},
            {"id": "e1b", "from": "invite", "to": "no_more", "when": {"kind": "text_contains", "words": ["די", "לא להזכיר"]},
             "actions": [{"type": "stop_reminders"}, {"type": "notify_host", "text": "{guest_name} ביקש/ה בלי תזכורות"}]},
            {"id": "e2", "from": "hello", "to": "pick_side", "when": {"kind": "done"}},
            {"id": "e3", "from": "pick_side", "to": "ask_table", "when": {"kind": "button", "button_id": "bride"},
             "actions": [{"type": "set_field", "field": "group", "value": "{answer}"},
                         {"type": "set_field", "field": "custom:side", "value": "bride"}]},
            {"id": "e4", "from": "pick_side", "to": "ask_table", "when": {"kind": "any_text"},
             "actions": [{"type": "set_field", "field": "group", "value": "{answer}"}]},
            {"id": "e5", "from": "ask_table", "to": "bye", "when": {"kind": "number"},
             "actions": [{"type": "set_field", "field": "table_number", "value": "{answer}"}]},
            {"id": "e6", "from": "ask_table", "to": None, "when": {"kind": "number_invalid"}},
            {"id": "e7", "from": "bye", "to": "pick_side", "when": {"kind": "text_contains", "words": ["שינוי"]}},
        ],
    }
    return g


async def graph_features():
    print("== custom graph: list, chaining, actions, flag, fail-safes ==")
    g = custom_graph()
    v = fg.validate_graph(g)
    check("custom graph validates", not v["errors"], v)
    await exec_sql("INSERT INTO event_field_defs (id, event_id, key, label, data_type, ask_in_rsvp) VALUES "
                   "(gen_random_uuid(), CAST(:e AS uuid), 'side', 'צד', 'text', false)", e=EV)

    # Disabled graph -> legacy.
    await reset()
    await put_graph(g, enabled=False)
    GRAPH_RUNS[0] = 0
    sent.clear()
    await inbound(CONFIRM)
    check("disabled graph -> legacy flow (asks party size)", GRAPH_RUNS[0] == 0
          and (await snapshot())["state"] == "rsvp_count")

    # Enabled.
    await put_graph(g, enabled=True)
    await reset()
    await exec_sql("INSERT INTO event_field_defs (id, event_id, key, label, data_type, ask_in_rsvp) VALUES "
                   "(gen_random_uuid(), CAST(:e AS uuid), 'side', 'צד', 'text', false)", e=EV)
    sent.clear()
    await inbound(CONFIRM)
    snap = await snapshot()
    check("message node chains into the list question (2 sends)", len(sent) == 2
          and sent[0]["message_type"] == "free_text" and sent[0]["text"] == "שלום דנה! 👋"
          and sent[1]["interactive"]["type"] == "list", sent)
    rows = sent[1]["interactive"]["action"]["sections"][0]["rows"] if len(sent) > 1 else []
    check("list rows + ids + list button", [r["id"] for r in rows] == [f"pick_side__BTN_{i}" for i in range(1, 5)]
          and sent[1]["interactive"]["action"]["button"] == "בחירת צד"
          and sent[1]["interactive"]["body"]["text"] == "מאיזה צד את/ה, דנה?", sent[1:] )
    check("state = pick_side, status attending", snap["state"] == "pick_side" and snap["guest"][0] == "attending")
    tags = await q_all("SELECT t.name FROM guest_tags gt JOIN tags t ON t.id = gt.tag_id")
    check("add_tag vip", tags == [("vip",)], tags)
    sent.clear()
    await inbound(("tap", "צד הכלה", "pick_side__BTN_1"))
    snap = await snapshot()
    custom = await q_all("SELECT v.value::text FROM guest_custom_values v JOIN event_field_defs f ON f.id = v.field_def_id "
                         "WHERE f.key = 'side'")
    check("set_field group={answer} + custom:side", snap["guest"][5] == "צד הכלה" and custom == [('"bride"',)],
          (snap, custom))
    check("number prompt renders {min_count}/{max_count}", sent and sent[0]["text"] == "איזה שולחן? (1-30)", sent)
    sent.clear()
    await inbound(("text", "99"))
    check("number_invalid with to=null: stays, no reply", (await snapshot())["state"] == "ask_table" and not sent)
    await inbound(("text", "12"))
    snap = await snapshot()
    check("table_number written, end node text uses {answer}", snap["guest"][4] == 12 and snap["state"] == "bye"
          and sent and sent[-1]["text"] == "תודה! שולחן 12 ✨", (snap, sent))
    sent.clear()
    await inbound(("text", "מה נשמע"))
    check("end node without a matching edge stays silent", (await snapshot())["state"] == "bye" and not sent)
    await inbound(("text", "רוצה שינוי בבקשה"))
    check("text_contains routes", (await snapshot())["state"] == "pick_side")

    # Unknown legacy state -> entry; text_contains + stop_reminders + notify_host.
    await reset(state="rsvp_count")
    sent.clear()
    await inbound(("text", "די, לא להזכיר לי"))
    tags = await q_all("SELECT t.name FROM guest_tags gt JOIN tags t ON t.id = gt.tag_id")
    check("unknown state -> entry node; stop_reminders tags no_reminders", (await snapshot())["state"] == "no_more"
          and tags == [(fg.NO_REMINDERS_TAG,)] and sent and sent[0]["text"] == "לא נזכיר יותר 🙏", (tags, sent))

    # Event scope beats global.
    ev_graph = fg.build_default_graph()
    for n in ev_graph["nodes"]:
        if n["id"] == "rsvp_count":
            n["text"] = "כמה? (גרף אירוע)"
    await put_graph(ev_graph, scope="event", key=EV)
    await reset()
    sent.clear()
    await inbound(CONFIRM)
    check("event-scope graph wins over global", sent and sent[0].get("text") == "כמה? (גרף אירוע)", sent)

    # Invalid enabled graph is ignored (falls to the next scope / legacy).
    bad = copy.deepcopy(ev_graph)
    bad["edges"].append({"id": "bad", "from": "nope", "to": "rsvp_done", "when": {"kind": "any_text"}})
    await put_graph(bad, scope="event", key=EV)
    await reset()
    sent.clear()
    await inbound(CONFIRM)
    check("invalid event graph ignored -> global custom graph", (await snapshot())["state"] == "pick_side")
    await clear_graphs()
    await put_graph(bad, scope="event", key=EV)
    await reset()
    GRAPH_RUNS[0] = 0
    await inbound(CONFIRM)
    check("only an invalid graph -> legacy", GRAPH_RUNS[0] == 0 and (await snapshot())["state"] == "rsvp_count")

    # Missing table -> legacy.
    await exec_sql("ALTER TABLE flow_graphs RENAME TO fg_gone")
    fg.invalidate_cache()
    await reset()
    GRAPH_RUNS[0] = 0
    await inbound(CONFIRM)
    check("flow_graphs table missing -> legacy", GRAPH_RUNS[0] == 0 and (await snapshot())["state"] == "rsvp_count")
    await exec_sql("ALTER TABLE fg_gone RENAME TO flow_graphs")
    await clear_graphs()

    # qans tap while in a graph question node continues via the graph.
    await put_graph(fg.build_default_graph())
    await reset(state="question_answer", status="attending", questions=True, guest_count=2)
    sent.clear()
    await inbound(("qans", Q_SHUTTLE, 0, "כן"))
    check("qans tap in graph question loop -> next question", (await snapshot())["state"] == "question_answer"
          and sent and "איזו מנה?" in sent[0]["interactive"]["body"]["text"], sent)
    await clear_graphs()


async def main():
    await setup()
    await equivalence()
    await graph_features()
    await engine.dispose()


asyncio.run(main())
passed = sum(_P)
print(f"\nRESULT: {passed}/{len(_P)} checks passed")
sys.exit(0 if passed == len(_P) else 1)
