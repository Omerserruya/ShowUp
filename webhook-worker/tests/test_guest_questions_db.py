"""Host questions end-to-end through FlowManager against a REAL Postgres.

Needs POSTGRES_URL (a throwaway DB - tables are created here) and the worker's
deps (aio_pika, sqlalchemy, asyncpg), i.e. run inside the webhook-worker image:

  docker run --rm --network <net> -e POSTGRES_URL=postgresql://postgres:pw@pg:5432/postgres \
      -v $PWD/webhook-worker:/app -v $PWD/shared:/app/shared showup-webhook-worker \
      python tests/test_guest_questions_db.py
"""
import asyncio
import json
import os
import sys
import uuid

_HERE = os.path.dirname(os.path.abspath(__file__))
_WORKER = os.path.dirname(_HERE)
sys.path.insert(0, _WORKER)
sys.path.insert(0, os.path.dirname(_WORKER))

if not os.getenv("POSTGRES_URL"):
    print("SKIP: POSTGRES_URL not set")
    sys.exit(0)

from sqlalchemy import text  # noqa: E402

from db.models import Base  # noqa: E402
from db.session import AsyncSessionLocal, engine  # noqa: E402
from flow_manager import FlowManager, TYPED_CHANGE_OF_HEART_STATES  # noqa: E402
from states.question_answer import make_answer_id  # noqa: E402

_P = []
def check(name, cond):
    _P.append(bool(cond))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")


SCHEMA = [
    "DROP TABLE IF EXISTS guest_custom_values, event_field_defs, messages_sent, campaigns, guests, events, "
    "inbound_seen, inbound_pending_choice, messages_log, conversations CASCADE",
    """CREATE TABLE events (id UUID PRIMARY KEY, name TEXT, event_date TIMESTAMPTZ, location TEXT,
        inviters JSON, subjects JSON, state TEXT DEFAULT 'active')""",
    """CREATE TABLE guests (id UUID PRIMARY KEY, event_id UUID, name TEXT, phone TEXT, status TEXT,
        guest_count INT, last_response TIMESTAMP, notes TEXT)""",
    """CREATE TABLE event_field_defs (id UUID PRIMARY KEY, event_id UUID NOT NULL, key VARCHAR(50), label VARCHAR(100),
        data_type VARCHAR(20), options JSON, required BOOLEAN DEFAULT false, applies_to_template BOOLEAN DEFAULT false,
        ask_in_rsvp BOOLEAN NOT NULL DEFAULT false, sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    """CREATE TABLE guest_custom_values (id UUID PRIMARY KEY, guest_id UUID NOT NULL, field_def_id UUID NOT NULL,
        value JSON, CONSTRAINT uq_value_guest_field UNIQUE (guest_id, field_def_id))""",
    "CREATE TABLE campaigns (id UUID PRIMARY KEY, event_id UUID)",
    """CREATE TABLE messages_sent (campaign_id UUID, guest_id UUID, wa_message_id TEXT, status TEXT,
        replied_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, sent_at TIMESTAMPTZ)""",
    """CREATE TABLE inbound_seen (wamid TEXT PRIMARY KEY, kind TEXT, attempts INT DEFAULT 1,
        seen_at TIMESTAMPTZ DEFAULT now(), done_at TIMESTAMPTZ)""",
    "CREATE TABLE inbound_pending_choice (guest_phone TEXT PRIMARY KEY, payload TEXT, created_at TIMESTAMPTZ)",
]

PHONE = "972501112233"
PHONE2 = "972501112244"
EVENT = str(uuid.uuid4())
EVENT2 = str(uuid.uuid4())
G1, G2, G3 = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
F_SHUTTLE, F_CITY = str(uuid.uuid4()), str(uuid.uuid4())
F_HIDDEN = str(uuid.uuid4())
CITIES = ["תל אביב", "ירושלים", "חיפה", "באר שבע", "לא צריך הסעה"]


async def setup():
    async with engine.begin() as conn:
        for stmt in SCHEMA:
            await conn.execute(text(stmt))
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSessionLocal() as s:
        for eid, name in ((EVENT, "החתונה"), (EVENT2, "בר מצווה")):
            await s.execute(text("INSERT INTO events (id, name, event_date, inviters) VALUES "
                                 "(CAST(:id AS uuid), :n, now() + interval '30 days', '[]')"), {"id": eid, "n": name})
        for gid, eid, ph in ((G1, EVENT, "0501112233"), (G2, EVENT2, "+972501112244"), (G3, EVENT, "0501112255")):
            await s.execute(text("INSERT INTO guests (id, event_id, name, phone, status) VALUES "
                                 "(CAST(:g AS uuid), CAST(:e AS uuid), 'דנה', :p, 'pending')"),
                            {"g": gid, "e": eid, "p": ph})
        q = ("INSERT INTO event_field_defs (id, event_id, key, label, data_type, options, ask_in_rsvp, sort_order) "
             "VALUES (CAST(:id AS uuid), CAST(:e AS uuid), :k, :l, 'enum', CAST(:o AS json), :ask, :so)")
        await s.execute(text(q), {"id": F_SHUTTLE, "e": EVENT, "k": "shuttle", "l": "צריכים הסעה לאירוע?",
                                  "o": json.dumps(["כן, אשמח", "לא, תודה"]), "ask": True, "so": 0})
        await s.execute(text(q), {"id": F_CITY, "e": EVENT, "k": "city", "l": "מאיזו עיר?",
                                  "o": json.dumps(CITIES), "ask": True, "so": 1})
        await s.execute(text(q), {"id": F_HIDDEN, "e": EVENT, "k": "internal", "l": "פנימי",
                                  "o": json.dumps(["a", "b"]), "ask": False, "so": 2})
        for ph, eid, gid in ((PHONE, EVENT, G1), (PHONE2, EVENT2, G2)):
            await s.execute(text("INSERT INTO conversations (id, guest_id, guest_phone, event_id, current_state, active, "
                                 "created_at, updated_at) VALUES (gen_random_uuid(), CAST(:g AS uuid), :p, :e, "
                                 "'rsvp_count', true, now(), now())"), {"g": gid, "p": ph, "e": eid})
        await s.commit()


async def q1(sql, **kw):
    async with AsyncSessionLocal() as s:
        return (await s.execute(text(sql), kw)).first()


async def state(phone):
    return (await q1("SELECT current_state FROM conversations WHERE guest_phone = :p", p=phone))[0]


async def answer(gid, fid):
    row = await q1("SELECT value FROM guest_custom_values WHERE guest_id = CAST(:g AS uuid) "
                   "AND field_def_id = CAST(:f AS uuid)", g=gid, f=fid)
    return ("<none>",) if row is None else row


async def main():
    await setup()
    sent = []
    flow = FlowManager(outpost_queue="outpost_priority_queue")

    async def _pub(payload):
        sent.append(payload)
    flow.publish_outgoing = _pub

    async def inbound(phone, text_value="", **kw):
        sent.clear()
        await flow.handle_event(message_type=kw.pop("message_type", "free_text"), guest_phone=phone, event_id=None,
                                text=text_value, raw={"message_id": f"wamid.{uuid.uuid4()}"}, context_id=None, **kw)
        return sent[-1] if sent else None

    print("== party size -> first question (buttons) ==")
    out = await inbound(PHONE, "2")
    g = await q1("SELECT status, guest_count FROM guests WHERE id = CAST(:g AS uuid)", g=G1)
    check("party size recorded + attending", tuple(g) == ("attending", 2))
    check("state -> question_answer", await state(PHONE) == "question_answer")
    check("interactive buttons sent", out and out["message_type"] == "interactive"
          and out["interactive"]["type"] == "button")
    check("button ids are qans__<shuttle>__i",
          out and [b["reply"]["id"] for b in out["interactive"]["action"]["buttons"]]
          == [make_answer_id(F_SHUTTLE, 0), make_answer_id(F_SHUTTLE, 1)])
    check("question text contains the label", out and "צריכים הסעה לאירוע?" in out["interactive"]["body"]["text"])

    print("== 'לא, תודה' button answer never touches the RSVP ==")
    out = await inbound(PHONE, "לא, תודה", message_type="quick_reply",
                        button_id=make_answer_id(F_SHUTTLE, 1), reply_kind="button_reply")
    g = await q1("SELECT status, guest_count FROM guests WHERE id = CAST(:g AS uuid)", g=G1)
    check("status still attending", tuple(g) == ("attending", 2))
    check("answer stored", (await answer(G1, F_SHUTTLE))[0] == "לא, תודה")
    check("next question is the 5-option list", out and out["interactive"]["type"] == "list")
    check("non-asked field is skipped in the loop",
          out and all(F_HIDDEN not in r["id"] for r in out["interactive"]["action"]["sections"][0]["rows"]))
    check("still in question_answer", await state(PHONE) == "question_answer")

    print("== free text: no match -> re-ask once -> skip -> rsvp_info_question ==")
    out = await inbound(PHONE, "לא בטוח בכלל")
    check("unmatched -> retry state", await state(PHONE) == "question_answer_retry")
    check("re-asked", out and out["interactive"]["type"] == "list" and "לא הצלחנו" in out["interactive"]["body"]["text"])
    check("typed 'לא...' did not decline", (await q1("SELECT status FROM guests WHERE id = CAST(:g AS uuid)", g=G1))[0]
          == "attending")
    out = await inbound(PHONE, "בלה בלה")
    check("second miss skips (NULL stored)", (await answer(G1, F_CITY))[0] is None)
    check("flow continues to rsvp_info_question", await state(PHONE) == "rsvp_info_question")
    check("info question sent", out and out.get("state") == "rsvp_info_question")

    print("== old question tap later updates the answer only ==")
    await inbound(PHONE, "אין שום דבר מיוחד")
    check("reached rsvp_done", await state(PHONE) == "rsvp_done")
    out = await inbound(PHONE, "כן, אשמח", message_type="quick_reply",
                        button_id=make_answer_id(F_SHUTTLE, 0), reply_kind="button_reply")
    check("answer updated (upsert)", (await answer(G1, F_SHUTTLE))[0] == "כן, אשמח")
    check("state unchanged", await state(PHONE) == "rsvp_done")
    check("short thanks sent", out and out["message_type"] == "free_text")
    check("status still attending", (await q1("SELECT status FROM guests WHERE id = CAST(:g AS uuid)", g=G1))[0]
          == "attending")

    print("== event without questions goes straight to rsvp_info_question ==")
    await inbound(PHONE2, "3")
    check("no questions -> rsvp_info_question", await state(PHONE2) == "rsvp_info_question")

    print("== free text matched to an option ==")
    async with AsyncSessionLocal() as s:
        await s.execute(text("DELETE FROM guest_custom_values WHERE guest_id = CAST(:g AS uuid)"), {"g": G1})
        await s.execute(text("UPDATE conversations SET current_state = 'rsvp_count' WHERE guest_phone = :p"),
                        {"p": PHONE})
        await s.commit()
    await inbound(PHONE, "1")
    await inbound(PHONE, "לא")  # typed: prefix-matches "לא, תודה"
    check("typed 'לא' stored as option", (await answer(G1, F_SHUTTLE))[0] == "לא, תודה")
    check("typed 'לא' did NOT decline", (await q1("SELECT status FROM guests WHERE id = CAST(:g AS uuid)", g=G1))[0]
          == "attending")
    await inbound(PHONE, "ירושלים")
    check("typed city stored", (await answer(G1, F_CITY))[0] == "ירושלים")
    check("-> rsvp_info_question", await state(PHONE) == "rsvp_info_question")
    check("question states are not typed-change-of-heart states",
          "question_answer" not in TYPED_CHANGE_OF_HEART_STATES)

    await engine.dispose()


asyncio.run(main())
passed = sum(_P)
print(f"\nRESULT: {passed}/{len(_P)} checks passed")
sys.exit(0 if passed == len(_P) else 1)
