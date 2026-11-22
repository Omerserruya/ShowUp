"""Admin conversation-flow settings end-to-end through FlowManager against a
REAL Postgres (shared/domain/flow_config.py + states/*).

Locks:
  * no settings rows -> byte-identical copy/buttons and routing (defaults)
  * per-event-type override wins over global, field by field
  * steps can be turned off (party size / notes) and are skipped in order
  * renamed buttons route by button_id `{state}__BTN_n` AND by the new label
  * party-size bounds, already-answered "acknowledge", opt-out text

Needs POSTGRES_URL (a throwaway DB - tables are DROPPED/created here) and the
worker's deps, i.e. run inside the webhook-worker image (see
test_guest_questions_db.py for the docker command).
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


async def set_layer(scope, key, config):
    await exec_sql("UPDATE conversation_flow_configs SET is_active = false WHERE scope = :s AND scope_key = :k",
                   s=scope, k=key)
    await exec_sql("INSERT INTO conversation_flow_configs (scope, scope_key, config, version, is_active) "
                   "SELECT CAST(:s AS varchar), CAST(:k AS varchar), CAST(:c AS jsonb), COALESCE(MAX(version), 0) + 1, "
                   "true FROM conversation_flow_configs WHERE scope = CAST(:s AS varchar) "
                   "AND scope_key = CAST(:k AS varchar)",
                   s=scope, k=key, c=json.dumps(config, ensure_ascii=False))
    fc.invalidate_cache()


async def set_state(t, st):
    await exec_sql("UPDATE conversations SET current_state = :st WHERE guest_phone = :p", st=st, p=PHONE[t])


async def state(t):
    return (await q1("SELECT current_state FROM conversations WHERE guest_phone = :p", p=PHONE[t]))[0]


async def guest(t):
    return tuple(await q1("SELECT status, guest_count FROM guests WHERE id = CAST(:g AS uuid)", g=GUEST[t]))


def body(out):
    if not out:
        return None
    return out["interactive"]["body"]["text"] if out["message_type"] == "interactive" else out.get("text")


def buttons(out):
    if not out or out["message_type"] != "interactive":
        return []
    return [b["reply"]["title"] for b in out["interactive"]["action"]["buttons"]]


def button_ids(out):
    if not out or out["message_type"] != "interactive":
        return []
    return [b["reply"]["id"] for b in out["interactive"]["action"]["buttons"]]


async def main():
    await setup()
    sent = []
    flow = FlowManager(outpost_queue="outpost_priority_queue")

    async def _pub(payload):
        sent.append(payload)
    flow.publish_outgoing = _pub

    async def inbound(t_or_phone, text_value="", **kw):
        sent.clear()
        phone = PHONE.get(t_or_phone, t_or_phone)
        await flow.handle_event(message_type=kw.pop("message_type", "free_text"), guest_phone=phone, event_id=None,
                                text=text_value, raw={"message_id": f"wamid.{uuid.uuid4()}"}, context_id=None, **kw)
        return sent[-1] if sent else None

    def tap(t, label, button_id):
        return inbound(t, label, message_type="quick_reply", button_id=button_id, reply_kind="button_reply")

    def template_tap(t, label, payload):
        return inbound(t, label, message_type="button", button_payload=payload, reply_kind="template_button")

    D = fc.default_flow()

    print("== no settings rows: today's copy + routing, byte for byte ==")
    out = await template_tap("other", "ברור שאגיע!", "rsvp_accepted")
    check("confirm -> rsvp_count", await state("other") == "rsvp_count")
    check("party-size text = original (rendered)",
          body(out) == "יופי! שמחים לדעת שתוכל להגיע להאירוע של נועה של נועה כהן 🥳\n"
                       "רק כדי שנוכל להתכונן כמו שצריך – כמה אנשים תגיעו? 😊\n\n *הגב בבקשה במספר בלבד*")
    out = await inbound("other", "77")
    check("51+ -> retry with original copy", await state("other") == "rsvp_count_retry"
          and body(out) == "לא הצלחנו להבין כמה תהיו 😅\nנשמח למספר בלבד, בין 1 ל־50 – כולל אותך. למשל: 2")
    out = await inbound("other", "2")
    check("count -> info question (no host questions)", await state("other") == "rsvp_info_question")
    check("info question copy + buttons = original",
          body(out) == D.legacy_text("after_confirm.ask_notes.text")
          and buttons(out) == ["אין שום דבר מיוחד", "לכתוב לנו הערה"]
          and button_ids(out) == ["rsvp_info_question__BTN_1", "rsvp_info_question__BTN_2"])
    out = await tap("other", "אין שום דבר מיוחד", "rsvp_info_question__BTN_1")
    check("-> rsvp_done with original text", await state("other") == "rsvp_done"
          and body(out) == D.legacy_text("after_confirm.done_message.text") and buttons(out) == ["לעדכן הגעה"])
    check("attending, 2", await guest("other") == ("attending", 2))

    print("== no inviters typed: the bot names the couple from the event details ==")
    await exec_sql("UPDATE events SET inviters = CAST('[]' AS json), subjects = CAST(:s AS json) WHERE id = CAST(:e AS uuid)",
                   e=EV["other"], s=json.dumps({"p1": "שני", "p2": "עומר"}))
    out = await template_tap("other", "ברור שאגיע!", "rsvp_accepted")
    check("party-size text says 'של שני ועומר', not a blank", "של שני ועומר 🥳" in (body(out) or ""))
    await exec_sql("UPDATE events SET inviters = CAST(:i AS json), subjects = NULL WHERE id = CAST(:e AS uuid)",
                   e=EV["other"], i=json.dumps([{"fn": "נועה", "ln": "כהן"}]))

    print("== a note typed without the button is saved, echoed, and is never a decline ==")
    await template_tap("other", "ברור שאגיע!", "rsvp_accepted")
    await inbound("other", "2")
    out = await inbound("other", "לא אוכל בשר")
    check("typed note -> note_saved, echoed in quotes",
          await state("other") == "note_saved"
          and body(out) == 'אין בעיה, ציינו בפני בעלי האירוע: "לא אוכל בשר"\nאם משהו ישתנה, נשמח אם תעדכן כאן ❤️'
          and buttons(out) == ["לכתוב לנו משהו אחר", "לעדכן הגעה"]
          and button_ids(out) == ["note_saved__BTN_1", "note_saved__BTN_2"])
    notes = (await q1("SELECT notes FROM guests WHERE id = CAST(:g AS uuid)", g=GUEST["other"]))[0]
    check("'לא אוכל בשר' is a note, guest still attending",
          notes.endswith("הערת אורח (וואטסאפ): לא אוכל בשר") and await guest("other") == ("attending", 2))
    out = await tap("other", "לכתוב לנו משהו אחר", "note_saved__BTN_1")
    check("another note -> asked to write", await state("other") == "note_info")
    out = await inbound("other", "כיסא תינוק")
    check("second note echoed", '"כיסא תינוק"' in (body(out) or "") and await state("other") == "note_saved")
    out = await inbound("other", "תודה!")
    check("'thanks' after the echo -> done, not a note", await state("other") == "rsvp_done"
          and not (await q1("SELECT notes FROM guests WHERE id = CAST(:g AS uuid)", g=GUEST["other"]))[0].endswith("תודה!"))
    await set_state("other", "rsvp_info_question")
    out = await inbound("other", "לא תודה")
    check("'לא תודה' at the question -> done, still attending",
          await state("other") == "rsvp_done" and await guest("other") == ("attending", 2))
    out = await template_tap("other", "ברור שאגיע!", "rsvp_accepted")
    check("default already_answered = restart (re-asks count)", await state("other") == "rsvp_count")

    print("== global + event_type layers ==")
    await set_layer("global", "default", {
        "after_decline": {"text": "חבל {guest_name} 😢", "buttons": {"change_mind": "בעצם כן מגיעים"}},
        "after_maybe": {"buttons": {"confirm": "בעצם כן", "decline": "בעצם לא"}},
        "opt_out": {"text": "הוסרת. להחזרה: התחל"},
    })
    await set_layer("event_type", "wedding", {
        "after_confirm": {"ask_party_size": {"enabled": False}, "ask_notes": {"enabled": False}},
    })
    await set_layer("event_type", "bar", {
        "after_confirm": {"ask_party_size": {"max": 5}},
        "after_decline": {"text": "בר מצווה בלעדיך זה לא אותו דבר"},
        "already_answered": {"behavior": "acknowledge"},
    })

    out = await template_tap("wedding", "ברור שאגיע!", "rsvp_accepted")
    check("wedding: party size + notes off -> straight to done", await state("wedding") == "rsvp_done"
          and body(out) == D.legacy_text("after_confirm.done_message.text"))
    check("wedding: status attending", (await guest("wedding"))[0] == "attending")

    out = await template_tap("other", "לצערי לא אוכל", "rsvp_declined")
    check("global decline text rendered", await state("other") == "rsvp_decline" and body(out) == "חבל דנה 😢")
    check("renamed change-mind button", buttons(out) == ["בעצם כן מגיעים"])
    out = await tap("other", "בעצם כן מגיעים", "rsvp_decline__BTN_1")
    check("renamed button routes by id -> rsvp_count", await state("other") == "rsvp_count")
    check("change of mind -> attending", (await guest("other"))[0] == "attending")
    await set_state("other", "rsvp_decline")
    await tap("other", "בעצם כן מגיעים", None)
    check("renamed button routes by LABEL too", await state("other") == "rsvp_count")
    await set_state("other", "rsvp_decline")
    await tap("other", "בסוף נוכל להגיע", None)
    check("old default label still routes (old messages)", await state("other") == "rsvp_count")

    out = await template_tap("bar", "לצערי לא אוכל", "rsvp_declined")
    check("type layer beats global text", body(out) == "בר מצווה בלעדיך זה לא אותו דבר")
    check("...but inherits the global button", buttons(out) == ["בעצם כן מגיעים"])

    print("== maybe: renamed buttons route by id ==")
    out = await template_tap("other", "עוד מתלבט/ת, תחזרו אלי?", "rsvp_maybe")
    check("maybe buttons renamed", await state("other") == "rsvp_maybe" and buttons(out) == ["בעצם כן", "בעצם לא"])
    await tap("other", "בעצם לא", "rsvp_maybe__BTN_2")
    check("BTN_2 -> decline + declined", await state("other") == "rsvp_decline"
          and (await guest("other"))[0] == "declined")

    print("== party-size bounds per type ==")
    await set_state("bar", "rsvp_count")
    out = await inbound("bar", "8")
    check("bar max 5: '8' re-asked", await state("bar") == "rsvp_count_retry" and "ל־5" in (body(out) or ""))
    await inbound("bar", "4")
    check("'4' accepted", await guest("bar") == ("attending", 4))

    print("== already answered: acknowledge (bar) ==")
    await set_state("bar", "rsvp_done")
    out = await template_tap("bar", "ברור שאגיע!", "rsvp_accepted")
    check("same answer -> acknowledged, state kept", await state("bar") == "rsvp_done"
          and body(out) == D.legacy_text("already_answered.text"))
    check("ack carries the done state's button", button_ids(out) == ["rsvp_done__BTN_1"])
    await template_tap("bar", "לצערי לא אוכל", "rsvp_declined")
    check("different answer is still applied", await state("bar") == "rsvp_decline"
          and (await guest("bar"))[0] == "declined")

    print("== opt-out text (global layer) ==")
    out = await inbound("other", "הסר")
    check("opt-out uses the configured text", out and out.get("text") == "הוסרת. להחזרה: התחל")

    print("== host questions toggle gates question_answer ==")
    await exec_sql("INSERT INTO event_field_defs (id, event_id, key, label, data_type, options, ask_in_rsvp) VALUES "
                   "(gen_random_uuid(), CAST(:e AS uuid), 'shuttle', 'צריכים הסעה?', 'enum', "
                   "CAST(:o AS json), true)", e=EV["other"], o=json.dumps(["כן", "לא"]))
    await set_layer("event_type", "other", {"after_confirm": {"ask_guest_questions": {"enabled": False}}})
    await set_state("other", "rsvp_count")
    await inbound("other", "3")
    check("questions off -> skipped to info question", await state("other") == "rsvp_info_question")
    await set_layer("event_type", "other", {})
    await set_state("other", "rsvp_count")
    await inbound("other", "3")
    check("questions on (default) -> question_answer", await state("other") == "question_answer")

    print("== a broken settings table never breaks the RSVP ==")
    await exec_sql("ALTER TABLE conversation_flow_configs RENAME TO cfc_gone")
    fc.invalidate_cache()
    await set_state("wedding", "rsvp_invite")
    out = await template_tap("wedding", "ברור שאגיע!", "rsvp_accepted")
    check("falls back to defaults (asks party size)", await state("wedding") == "rsvp_count"
          and body(out) == D.legacy_text("after_confirm.ask_party_size.text").replace(
              "{{event.name}}", "האירוע של נועה").replace("{{event.inviters}}", "נועה כהן"))
    await exec_sql("ALTER TABLE cfc_gone RENAME TO conversation_flow_configs")

    await engine.dispose()


asyncio.run(main())
passed = sum(_P)
print(f"\nRESULT: {passed}/{len(_P)} checks passed")
sys.exit(0 if passed == len(_P) else 1)
