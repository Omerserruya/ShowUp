"""voice-service end to end against a real Postgres - Twilio and ElevenLabs are
faked at the module boundary (telephony.place_call / tts.synthesize / find_voice).

Covers: admin auth, preview + plan allowance, round scheduling from the
no-response audience, the dialer (call window, already-answered skip), the
Twilio webhooks with signature checks (menu -> count -> guest updated),
decline/maybe, retries on no-answer, answering machines, round completion,
test calls and the clip endpoint.

Run (needs DB_* env pointing at an empty database):
    python tests/test_voice_service_db.py
"""
import os
import sys
import tempfile
import uuid
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ["VOICE_DIALER_ENABLED"] = "0"
os.environ["PUBLIC_BASE_URL"] = "https://showup.test"
os.environ["TWILIO_ACCOUNT_SID"] = "AC123"
os.environ["TWILIO_AUTH_TOKEN"] = "tok"
os.environ["TWILIO_FROM_NUMBER"] = "+97231234567"
os.environ["ELEVENLABS_API_KEY"] = "xi"
os.environ["VOICE_CLIP_DIR"] = tempfile.mkdtemp()

import jwt  # noqa: E402
import psycopg2  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import db  # noqa: E402
import main  # noqa: E402
import telephony  # noqa: E402
import tts  # noqa: E402
from shared.domain import voice_calls as vc  # noqa: E402

ADMIN = str(uuid.uuid4())
OWNER = str(uuid.uuid4())

BASE_SCHEMA = """
CREATE TABLE users (id uuid PRIMARY KEY, role text);
CREATE TABLE events (id uuid PRIMARY KEY, name text, event_date timestamptz, location text, inviters json,
                     subjects json, event_type text, plan_id text, public_slug text);
CREATE TABLE guests (id uuid PRIMARY KEY, event_id uuid, name text, phone text, status text DEFAULT 'invited',
                     import_count int, guest_count int, last_response timestamptz, opted_out_at timestamptz);
CREATE TABLE tags (id uuid PRIMARY KEY, name text);
CREATE TABLE guest_tags (guest_id uuid, tag_id uuid);
"""


def conn():
    return psycopg2.connect(host=os.environ["DB_HOST"], port=os.environ.get("DB_PORT", "5432"),
                            user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"],
                            dbname=os.environ["DB_NAME"])


def sql(q, args=()):
    with conn() as c, c.cursor() as cur:
        cur.execute(q, args)
        try:
            return cur.fetchall()
        except psycopg2.ProgrammingError:
            return None


def setup():
    sql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    sql(BASE_SCHEMA)
    sql("INSERT INTO users VALUES (%s, 'admin'), (%s, 'user')", (ADMIN, OWNER))
    db.ensure_schema()


def token(uid):
    return {"Authorization": "Bearer " + jwt.encode({"user_id": uid}, os.environ["JWT_SECRET"], algorithm="HS256")}


# ---- fakes ------------------------------------------------------------------
PLACED = []
TTS_CALLS = []


def fake_place_call(to, answer_url, status_url, **kw):
    sid = "CA" + uuid.uuid4().hex
    PLACED.append({"to": to, "answer": answer_url, "status": status_url, "sid": sid})
    return sid


def fake_synthesize(text, vid):
    TTS_CALLS.append(text)
    return b"ID3fake"


telephony.place_call = fake_place_call
tts.synthesize = fake_synthesize
tts.find_voice = lambda name=None: {"voice_id": "nimrod-id", "name": "Nimrod", "source": "library",
                                    "language": "he", "preview_url": None}

client = TestClient(main.app)


def twilio_post(url, params, good=True):
    """POST like Twilio does: form body + signature over the PUBLIC url."""
    path = url.replace(main.public_url(""), "")
    sig = vc.twilio_signature("tok" if good else "wrong", url, params)
    return client.post(path, data=params, headers={"X-Twilio-Signature": sig})


def seed_event(plan="pro", event_type="wedding"):
    eid = str(uuid.uuid4())
    sql("INSERT INTO events VALUES (%s, 'החתונה', '2026-11-12T17:30:00+00:00', 'אולמי הגן', "
        "'[{\"fn\":\"מיכל\",\"ln\":\"לוי\"}]', '{\"p1\":\"מיכל\",\"p2\":\"יוסי\",\"role1\":\"bride\",\"role2\":\"groom\"}', "
        "%s, %s, 'slug')", (eid, event_type, plan))
    guests = {}
    for name, phone, status in [("דנה כהן", "050-1111111", "invited"), ("רון לוי", "0502222222", "pending"),
                                ("שירה", "0503333333", "invited"), ("כבר ענה", "0504444444", "attending"),
                                ("בלי טלפון", "", "invited"), ("הסיר", "0505555555", "invited"),
                                ("בלי תזכורות", "0506666666", "invited")]:
        gid = str(uuid.uuid4())
        guests[name] = gid
        sql("INSERT INTO guests (id, event_id, name, phone, status, import_count) VALUES (%s,%s,%s,%s,%s,2)",
            (gid, eid, name, phone, status))
    sql("UPDATE guests SET opted_out_at = now() WHERE id = %s", (guests["הסיר"],))
    tag = str(uuid.uuid4())
    sql("INSERT INTO tags VALUES (%s, 'no_reminders')", (tag,))
    sql("INSERT INTO guest_tags VALUES (%s, %s)", (guests["בלי תזכורות"], tag))
    return eid, guests


def call_of(gid):
    return sql("SELECT id, status, result, attempt, twilio_sid, guest_count FROM voice_calls WHERE guest_id = %s", (gid,))[0]


def guest(gid):
    return sql("SELECT status, guest_count, last_response FROM guests WHERE id = %s", (gid,))[0]


def run():
    setup()
    eid, g = seed_event()

    # --- auth ---
    assert client.get("/admin/status").status_code == 401
    assert client.get("/admin/status", headers=token(OWNER)).status_code == 403
    st = client.get("/admin/status", headers=token(ADMIN)).json()
    assert st["twilio_configured"] and st["elevenlabs_configured"]

    # --- voice check (Nimrod) ---
    r = client.post("/admin/voice-check", json={"name": "Nimrod"}, headers=token(ADMIN))
    assert r.status_code == 200, r.text
    assert r.json()["voice"]["voice_id"] == "nimrod-id" and db.kv_get(tts.KV_VOICE) == "nimrod-id"
    assert r.json()["sample_url"].startswith("https://showup.test/api/voice/clips/")

    # --- preview: only the 3 pending, callable, not opted-out, not no_reminders ---
    p = client.get(f"/admin/events/{eid}/preview", headers=token(ADMIN)).json()
    assert p["pending_guests"] == 3 and p["callable"] == 3, p
    assert p["rounds_allowed"] == 1 and p["can_schedule"]
    assert "היי דנה!" in p["sample_opening"] and "מיכל ויוסי" in p["sample_opening"]
    assert "ביום חמישי, ה-12 בנובמבר" in p["sample_opening"]  # 17:30Z = 19:30 Israel, same day

    # --- plan without calls: blocked until the admin override ---
    eid2, _ = seed_event(plan="basic")
    r = client.post(f"/admin/events/{eid2}/rounds", json={}, headers=token(ADMIN))
    assert r.status_code == 409 and r.json()["detail"]["error"] == "no_phone_rounds_left"
    a = client.put(f"/admin/events/{eid2}/settings", json={"enabled": True}, headers=token(ADMIN)).json()
    assert a["rounds_allowed"] == vc.OVERRIDE_CALL_ROUNDS

    # --- schedule a round ---
    r = client.post(f"/admin/events/{eid}/rounds", json={}, headers=token(ADMIN))
    assert r.status_code == 201, r.text
    assert r.json()["total"] == 3
    assert client.post(f"/admin/events/{eid}/rounds", json={}, headers=token(ADMIN)).status_code == 409  # 1 included

    # --- dialer: outside the call window nothing is placed ---
    main.now_il = lambda: datetime(2026, 11, 14, 12, 0, tzinfo=main.IL)  # Saturday
    assert main.tick() == 0 and not PLACED
    main.now_il = lambda: datetime(2026, 11, 10, 12, 0, tzinfo=main.IL)  # Tuesday noon

    # Shira answers on WhatsApp meanwhile -> her call is skipped, not placed.
    sql("UPDATE guests SET status = 'attending' WHERE id = %s", (g["שירה"],))
    assert main.tick() == 3
    assert len(PLACED) == 2 and {p_["to"] for p_ in PLACED} == {"+972501111111", "+972502222222"}
    assert call_of(g["שירה"])[1] == "canceled"
    assert any("היי דנה! איזה כיף" in t for t in TTS_CALLS)
    n_tts = len(TTS_CALLS)
    # fixed clips are cached: a second preparation generates only the new opening
    dana = call_of(g["דנה כהן"])
    assert dana[1] == "dialing" and dana[3] == 1
    dana_call = next(p_ for p_ in PLACED if p_["to"] == "+972501111111")
    ron_call = next(p_ for p_ in PLACED if p_["to"] == "+972502222222")

    # --- signature is enforced ---
    assert twilio_post(dana_call["answer"], {"CallSid": dana_call["sid"], "AnsweredBy": "human"}, good=False).status_code == 403

    # --- Dana: answer -> 1 -> 4# ---
    r = twilio_post(dana_call["answer"], {"CallSid": dana_call["sid"], "AnsweredBy": "human"})
    assert r.status_code == 200 and "<Gather" in r.text and "s=menu&amp;t=1" in r.text, r.text
    opening_key = sql("SELECT opening_clip FROM voice_calls WHERE guest_id = %s", (g["דנה כהן"],))[0][0]
    assert main.clip_url(opening_key) in r.text
    cid = sql("SELECT id FROM voice_calls WHERE guest_id = %s", (g["דנה כהן"],))[0][0]
    r = twilio_post(main.public_url(f"/twilio/step?c={cid}&s=menu&t=1"), {"CallSid": dana_call["sid"], "Digits": "1"})
    assert "s=count&amp;t=1" in r.text and 'finishOnKey="#"' in r.text
    r = twilio_post(main.public_url(f"/twilio/step?c={cid}&s=count&t=1"), {"CallSid": dana_call["sid"], "Digits": "4"})
    assert "<Hangup/>" in r.text and "<Gather" not in r.text
    st_, cnt, last = guest(g["דנה כהן"])
    assert st_ == "attending" and cnt == 4 and last is not None
    twilio_post(dana_call["status"], {"CallSid": dana_call["sid"], "CallStatus": "completed", "CallDuration": "38"})
    c = call_of(g["דנה כהן"])
    assert c[1] == "done" and c[2] == "confirmed" and c[5] == 4

    # --- Ron: no answer -> retried later, then answers and declines ---
    twilio_post(ron_call["status"], {"CallSid": ron_call["sid"], "CallStatus": "no-answer"})
    c = call_of(g["רון לוי"])
    assert c[1] == "queued" and c[2] is None and c[4] is None
    assert main.tick() == 0  # not due yet (retry delay)
    sql("UPDATE voice_calls SET next_at = now() WHERE guest_id = %s", (g["רון לוי"],))
    assert main.tick() == 1 and call_of(g["רון לוי"])[3] == 2
    assert len(TTS_CALLS) == n_tts  # opening + fixed clips all cached
    ron2 = PLACED[-1]
    rid = sql("SELECT id FROM voice_calls WHERE guest_id = %s", (g["רון לוי"],))[0][0]
    twilio_post(ron2["answer"], {"CallSid": ron2["sid"], "AnsweredBy": "human"})
    r = twilio_post(main.public_url(f"/twilio/step?c={rid}&s=menu&t=1"), {"CallSid": ron2["sid"], "Digits": "2"})
    assert "<Hangup/>" in r.text
    assert guest(g["רון לוי"])[0] == "declined"
    twilio_post(ron2["status"], {"CallSid": ron2["sid"], "CallStatus": "completed", "CallDuration": "20"})

    # --- the round closes when every call is settled ---
    rounds = client.get(f"/admin/events/{eid}/rounds", headers=token(ADMIN)).json()["rounds"]
    assert rounds[0]["status"] == "done", rounds
    assert rounds[0]["confirmed"] == 1 and rounds[0]["declined"] == 1 and rounds[0]["attempts"] == 3

    # --- answering machine on the 2nd (last) attempt: hang up, no retry ---
    eid3, g3 = seed_event()
    client.post(f"/admin/events/{eid3}/rounds", json={}, headers=token(ADMIN))
    sql("UPDATE voice_calls SET status = 'canceled' WHERE event_id = %s AND guest_id <> %s", (eid3, g3["דנה כהן"]))
    sql("UPDATE voice_calls SET attempt = 1 WHERE guest_id = %s", (g3["דנה כהן"],))
    assert main.tick() == 1
    m = PLACED[-1]
    r = twilio_post(m["answer"], {"CallSid": m["sid"], "AnsweredBy": "machine_start"})
    assert "<Hangup/>" in r.text and "<Play>" not in r.text
    twilio_post(m["status"], {"CallSid": m["sid"], "CallStatus": "completed"})
    c = call_of(g3["דנה כהן"])
    assert c[1] == "done" and c[2] == "machine"
    assert guest(g3["דנה כהן"])[0] == "invited"

    # --- maybe, and no input at all ---
    assert vc.on_digits("menu", "3", 1).result == "maybe"

    # --- test call: dials outside the window, never touches guests ---
    main.now_il = lambda: datetime(2026, 11, 14, 22, 0, tzinfo=main.IL)
    r = client.post("/admin/test-call", json={"phone": "0541234567", "name": "עומר"}, headers=token(ADMIN))
    assert r.status_code == 200 and "היי עומר!" in r.json()["opening_text"]
    assert main.tick() == 1 and PLACED[-1]["to"] == "+972541234567"
    t = PLACED[-1]
    tid = r.json()["call"]["id"]
    twilio_post(t["answer"], {"CallSid": t["sid"], "AnsweredBy": "human"})
    twilio_post(main.public_url(f"/twilio/step?c={tid}&s=menu&t=1"), {"CallSid": t["sid"], "Digits": "1"})
    twilio_post(main.public_url(f"/twilio/step?c={tid}&s=count&t=1"), {"CallSid": t["sid"], "Digits": "2"})
    twilio_post(t["status"], {"CallSid": t["sid"], "CallStatus": "completed"})
    tc = client.get(f"/admin/calls/{tid}", headers=token(ADMIN)).json()
    assert tc["result"] == "confirmed" and tc["guest_count"] == 2 and tc["status"] == "done"

    # --- clips are served, traversal is not ---
    key = opening_key.removeprefix("voice/")
    r = client.get(f"/clips/{key}")
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    assert client.get("/clips/..%2F..%2Fetc/passwd").status_code == 404

    # --- cancel ---
    eid4, _ = seed_event()
    rnd = client.post(f"/admin/events/{eid4}/rounds", json={"start_at": "2030-01-01T10:00:00"}, headers=token(ADMIN)).json()
    assert client.post(f"/admin/rounds/{rnd['id']}/cancel", headers=token(ADMIN)).json()["canceled_calls"] == 3

    print("voice-service db test: OK")


if __name__ == "__main__":
    run()
