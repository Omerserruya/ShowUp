"""Replies to rounds that ask nothing (shared/domain/stage_replies.py) against a
REAL Postgres. Pilot event 2-4.11.26: after the thank-you, "היה מושלם" got
"noted!" and "בדוק אחי" got "how many will you be?".

Locks:
  * stage_thank_you: one stage reply, the words saved as a note, quiet after;
    an RSVP-looking text after the event changes nothing
  * stage_final_reminder (logistics): "תודה" -> stage reply, status untouched;
    a typed "בסוף לא נוכל להגיע" still declines through the RSVP flow
  * a question is never an RSVP answer ("כמה מגיעים לאירוע?")

Run like test_flow_settings_db.py (needs POSTGRES_URL, webhook-worker image).
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
from flow_manager import FlowManager  # noqa: E402
from shared.domain import flow_config as fc  # noqa: E402

_P = []
def check(name, cond):
    _P.append(bool(cond))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")


SCHEMA = [
    "DROP TABLE IF EXISTS conversation_flow_configs, guest_custom_values, event_field_defs, messages_sent, campaigns, "
    "guests, events, inbound_seen, inbound_pending_choice, messages_log, conversations CASCADE",
    """CREATE TABLE events (id UUID PRIMARY KEY, name TEXT, event_date TIMESTAMPTZ, location TEXT,
        inviters JSON, subjects JSON, state TEXT DEFAULT 'active', event_type VARCHAR(50))""",
    """CREATE TABLE guests (id UUID PRIMARY KEY, event_id UUID, name TEXT, phone TEXT, status TEXT,
        guest_count INT, last_response TIMESTAMP, notes TEXT,
        opted_out_at TIMESTAMPTZ, opted_out_reason TEXT, opted_out_source TEXT)""",
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
    # mirrors core-service migrations.ensure_conversation_flow_configs
    """CREATE TABLE conversation_flow_configs (id BIGSERIAL PRIMARY KEY, scope VARCHAR(20) NOT NULL,
        scope_key VARCHAR(64) NOT NULL, config JSONB NOT NULL DEFAULT '{}'::jsonb, version INTEGER NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT false, note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by UUID)""",
]

# One guest per event type so the type layers are independent.
EV = {t: str(uuid.uuid4()) for t in ("other", "wedding", "bar")}
GUEST = {t: str(uuid.uuid4()) for t in EV}
PHONE = {"other": "972501110001", "wedding": "972501110002", "bar": "972501110003"}


async def exec_sql(sql, **kw):
    async with AsyncSessionLocal() as s:
        await s.execute(text(sql), kw)
        await s.commit()


async def q1(sql, **kw):
    async with AsyncSessionLocal() as s:
        return (await s.execute(text(sql), kw)).first()


async def setup():
    async with engine.begin() as conn:
        for stmt in SCHEMA:
            await conn.execute(text(stmt))
        await conn.run_sync(Base.metadata.create_all)
    for t, eid in EV.items():
        await exec_sql("INSERT INTO events (id, name, event_date, inviters, event_type) VALUES (CAST(:id AS uuid), "
                       "'האירוע של נועה', now() + interval '30 days', CAST(:inv AS json), :t)",
                       id=eid, t=t, inv=json.dumps([{"fn": "נועה", "ln": "כהן"}]))
        await exec_sql("INSERT INTO guests (id, event_id, name, phone, status) VALUES "
                       "(CAST(:g AS uuid), CAST(:e AS uuid), 'דנה', :p, 'pending')",
                       g=GUEST[t], e=eid, p="0" + PHONE[t][3:])
        await exec_sql("INSERT INTO conversations (id, guest_id, guest_phone, event_id, current_state, active, "
                       "created_at, updated_at) VALUES (gen_random_uuid(), CAST(:g AS uuid), :p, :e, "
                       "'rsvp_invite', true, now(), now())", g=GUEST[t], p=PHONE[t], e=eid)



async def set_state(t, st):
    await exec_sql("UPDATE conversations SET current_state = :st WHERE guest_phone = :p", st=st, p=PHONE[t])


async def state(t):
    return (await q1("SELECT current_state FROM conversations WHERE guest_phone = :p", p=PHONE[t]))[0]


async def guest_row(t):
    return tuple(await q1("SELECT status, guest_count, notes FROM guests WHERE id = CAST(:g AS uuid)", g=GUEST[t]))


async def main():
    await setup()
    sent = []
    flow = FlowManager(outpost_queue="outpost_priority_queue")

    async def _pub(payload):
        sent.append(payload)
    flow.publish_outgoing = _pub

    async def inbound(t, text_value):
        sent.clear()
        await flow.handle_event(message_type="free_text", guest_phone=PHONE[t], event_id=None, text=text_value,
                                raw={"message_id": f"wamid.{uuid.uuid4()}"}, context_id=None)
        return list(sent)

    D = fc.default_flow()

    print("== after the thank-you ==")
    await exec_sql("UPDATE guests SET status = 'attending', guest_count = 2 WHERE id = CAST(:g AS uuid)", g=GUEST["other"])
    await set_state("other", "stage_thank_you")
    out = await inbound("other", "היה מוווווושלם ❤️ ניפגש בקרוב בברית 🙏")
    check("one reply, the thank-you stage text", len(out) == 1 and out[0].get("text", "").startswith("תודה רבה דנה"))
    g = await guest_row("other")
    check("words kept as a note for the hosts", "היה מוווווושלם" in (g[2] or ""))
    check("status untouched", g[:2] == ("attending", 2))
    check("-> acked state", await state("other") == "stage_thank_you_acked")
    out = await inbound("other", "בדוק אחי")
    check("second message: no reply, still noted", out == [] and "בדוק אחי" in ((await guest_row("other"))[2] or ""))
    out = await inbound("other", "לא נגיע")
    check("an RSVP-looking text after the event changes nothing", out == [] and (await guest_row("other"))[0] == "attending")
    out = await inbound("other", "תודה")
    check("'תודה' is not saved as a note", (await guest_row("other"))[2].count("תודה") == 0)

    print("== after the logistics reminder ==")
    await exec_sql("UPDATE guests SET status = 'attending', guest_count = 3, notes = NULL WHERE id = CAST(:g AS uuid)",
                   g=GUEST["wedding"])
    await set_state("wedding", "stage_final_reminder")
    out = await inbound("wedding", "סגור")
    check("'סגור' -> logistics stage reply", len(out) == 1 and "מחכים לראות אותך" in out[0].get("text", ""))
    check("status untouched, nothing noted", await guest_row("wedding") == ("attending", 3, None))
    out = await inbound("wedding", "בסוף לא נוכל להגיע")
    check("typed decline still declines", (await guest_row("wedding"))[0] == "declined")

    print("== a question is not an answer ==")
    await set_state("bar", "rsvp_invite")
    await inbound("bar", "כמה מגיעים לאירוע?")
    check("still pending", (await guest_row("bar"))[0] == "pending")

    print("\nRESULT:", "OK" if all(_P) else "FAIL", f"({sum(_P)}/{len(_P)})")
    sys.exit(0 if all(_P) else 1)


asyncio.run(main())
