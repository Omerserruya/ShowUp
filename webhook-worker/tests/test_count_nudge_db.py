""""Confirmed but never said how many" reminder (FlowManager.send_count_nudges)
against a REAL Postgres: sent once, ~3h after the guest's last message, only
inside the 24h window and at a decent hour; the reply then counts as usual.

Needs POSTGRES_URL (a throwaway DB - tables are DROPPED/created here); run in
the webhook-worker image like test_flow_settings_db.py.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

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
from flow_manager import FlowManager, COUNT_NUDGE_STATE  # noqa: E402

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
    """CREATE TABLE conversation_flow_configs (id BIGSERIAL PRIMARY KEY, scope VARCHAR(20) NOT NULL,
        scope_key VARCHAR(64) NOT NULL, config JSONB NOT NULL DEFAULT '{}'::jsonb, version INTEGER NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT false, note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by UUID)""",
]

EVENT = str(uuid.uuid4())
GUEST = str(uuid.uuid4())
PHONE = "972501110009"


async def exec_sql(sql, **kw):
    async with AsyncSessionLocal() as s:
        await s.execute(text(sql), kw)
        await s.commit()


async def q1(sql, **kw):
    async with AsyncSessionLocal() as s:
        return (await s.execute(text(sql), kw)).first()


async def main():
    async with engine.begin() as conn:
        for stmt in SCHEMA:
            await conn.execute(text(stmt))
        await conn.run_sync(Base.metadata.create_all)
    await exec_sql("INSERT INTO events (id, name, event_date, subjects, event_type) VALUES (CAST(:id AS uuid), "
                   "'החתונה', now() + interval '30 days', '{\"p1\": \"שני\", \"p2\": \"עומר\"}', 'wedding')", id=EVENT)
    await exec_sql("INSERT INTO guests (id, event_id, name, phone, status) VALUES "
                   "(CAST(:g AS uuid), CAST(:e AS uuid), 'שקד', :p, 'pending')", g=GUEST, e=EVENT, p="0" + PHONE[3:])
    await exec_sql("INSERT INTO conversations (id, guest_id, guest_phone, event_id, current_state, active, "
                   "created_at, updated_at) VALUES (gen_random_uuid(), CAST(:g AS uuid), :p, :e, "
                   "'rsvp_invite', true, now(), now())", g=GUEST, p=PHONE, e=EVENT)

    sent = []
    flow = FlowManager(outpost_queue="outpost_priority_queue")

    async def _pub(payload):
        sent.append(payload)
    flow.publish_outgoing = _pub

    await flow.handle_event(message_type="button", guest_phone=PHONE, event_id=None, text="ברור שאגיע!",
                            button_payload="rsvp_accepted", reply_kind="template_button",
                            raw={"message_id": f"wamid.{uuid.uuid4()}"}, context_id=None)
    st = await q1("SELECT current_state FROM conversations WHERE guest_phone = :p", p=PHONE)
    check("confirmed -> asked how many", st[0] == "rsvp_count")

    # Pretend 'now' is noon Israel time on the day the guest answered.
    answered = (await q1("SELECT max(created_at) FROM messages_log WHERE direction = 'incoming'"))[0]
    noon_il = answered.astimezone(timezone(timedelta(hours=2))).replace(hour=12, minute=0)

    sent.clear()
    check("1 hour later: nothing yet", await flow.send_count_nudges(answered + timedelta(hours=1)) == 0)
    check("night (03:00 IL): nothing", await flow.send_count_nudges(noon_il.replace(hour=3) + timedelta(days=1)) == 0)
    when = answered + timedelta(hours=4)
    if not 9 <= when.astimezone(timezone(timedelta(hours=2))).hour < 21:
        await exec_sql("UPDATE messages_log SET created_at = :t WHERE direction = 'incoming'",
                       t=noon_il - timedelta(hours=4))
        when = noon_il
    check("~3h later: one reminder", await flow.send_count_nudges(when) == 1 and len(sent) == 1)
    check("reminder text names the hosts and asks for a number",
          "כמה תהיו" in sent[0]["text"] and "שני ועומר" in sent[0]["text"] and sent[0]["recipient"] == PHONE)
    check("sent once only", await flow.send_count_nudges(when + timedelta(hours=1)) == 0)
    row = await q1("SELECT count(*) FROM messages_log WHERE state = :s", s=COUNT_NUDGE_STATE)
    check("logged with the reminder marker", row[0] == 1)
    st = await q1("SELECT current_state FROM conversations WHERE guest_phone = :p", p=PHONE)
    check("conversation still waits for the number", st[0] == "rsvp_count")

    sent.clear()
    await flow.handle_event(message_type="free_text", guest_phone=PHONE, event_id=None, text="3",
                            raw={"message_id": f"wamid.{uuid.uuid4()}"}, context_id=None)
    g = await q1("SELECT status, guest_count FROM guests WHERE id = CAST(:g AS uuid)", g=GUEST)
    check("reply after the reminder counts", tuple(g) == ("attending", 3))

    # Past the 24h window: no reminder for a second, silent guest.
    await exec_sql("UPDATE guests SET guest_count = NULL")
    await exec_sql("UPDATE conversations SET current_state = 'rsvp_count'")
    await exec_sql("DELETE FROM messages_log WHERE state = :s", s=COUNT_NUDGE_STATE)
    late = (await q1("SELECT max(created_at) FROM messages_log WHERE direction = 'incoming'"))[0] + timedelta(hours=23)
    check("after 21h: too late, nothing", await flow.send_count_nudges(late) == 0)

    passed = sum(_P)
    print(f"\nRESULT: {passed}/{len(_P)} checks passed")
    sys.exit(0 if passed == len(_P) else 1)


asyncio.run(main())
