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
os.environ["VOICE_TEMPO"] = "1"
os.environ["TWILIO_ACCOUNT_SID"] = "AC123"
os.environ["TWILIO_AUTH_TOKEN"] = "tok"
os.environ["TWILIO_FROM_NUMBER"] = "+97231234567"
os.environ["ELEVENLABS_API_KEY"] = "xi"
os.environ["VOICE_CLIP_DIR"] = tempfile.mkdtemp()
os.environ["VOICE_AUTO_PLAN_SECONDS"] = "1e12"   # auto planning is exercised explicitly below
os.environ["INTERNAL_API_SECRET"] = "int-secret"

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
                     subjects json, event_type text, plan_id text, public_slug text, state text DEFAULT 'active');
CREATE TABLE guests (id uuid PRIMARY KEY, event_id uuid, name text, phone text, status text DEFAULT 'invited',
                     import_count int, guest_count int, last_response timestamptz, opted_out_at timestamptz);
CREATE TABLE tags (id uuid PRIMARY KEY, name text);
CREATE TABLE guest_tags (guest_id uuid, tag_id uuid);
CREATE TABLE messages_sent (campaign_id uuid, guest_id uuid, status text, error_code text,
                            retry_count int NOT NULL DEFAULT 0);
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


def fake_place_call(to, answer_url, status_url, amd_url=None, **kw):
    sid = "CA" + uuid.uuid4().hex
    PLACED.append({"to": to, "answer": answer_url, "status": status_url, "amd": amd_url, "sid": sid})
    return sid


def fake_synthesize(text, vid):
    TTS_CALLS.append(text)
    return b"ID3fake"


telephony.place_call = fake_place_call
tts.synthesize = fake_synthesize


def fake_synthesize_pcm(text, vid):
    TTS_CALLS.append(text)
    # 100 ms silence, 200 ms "voice", 300 ms silence (16-bit mono, 16 kHz)
    return b"\x00\x00" * 1600 + b"\x10\x27" * 3200 + b"\x00\x00" * 4800


tts.synthesize_pcm = fake_synthesize_pcm
tts.find_voice = lambda name=None: {"voice_id": "nimrod-id", "name": "Nimrod", "source": "library",
                                    "language": "he", "preview_url": None}

client = TestClient(main.app)


def twilio_post(url, params, good=True):
    """POST like Twilio does: form body + signature over the PUBLIC url."""
    path = url.replace(main.public_url(""), "")
    sig = vc.twilio_signature("tok" if good else "wrong", url, params)
    return client.post(path, data=params, headers={"X-Twilio-Signature": sig})


def seed_event(plan="plus", event_type="wedding"):
    eid = str(uuid.uuid4())
    sql("INSERT INTO events VALUES (%s, 'החתונה', '2026-11-12T17:30:00+00:00', 'אולמי הגן', "
        "'[{\"fn\":\"מיכל\",\"ln\":\"לוי\"}]', '{\"p1\":\"מיכל\",\"p2\":\"יוסי\",\"role1\":\"bride\",\"role2\":\"groom\"}', "
        "%s, %s, 'slug')", (eid, event_type, plan))
    guests = {}
    for name, phone, status in [("דנה כהן", "050-1111111", "invited"), ("רון לוי", "0502222222", "pending"),
                                ("שירה", "0503333333", "invited"), ("כבר ענה", "0504444444", "attending"),
                                ("בלי טלפון", "", "invited"), ("הסיר", "0505555555", "invited"),
                                ("מתלבטת", "0501231234", "maybe"),
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

    # --- preview: only the 4 undecided (no answer / maybe), callable, not opted-out, not no_reminders ---
    p = client.get(f"/admin/events/{eid}/preview", headers=token(ADMIN)).json()
    assert p["pending_guests"] == 4 and p["callable"] == 4, p   # "maybe" is called too
    assert db.guest_still_pending(g["מתלבטת"])     # not skipped at dial time either
    sql("UPDATE guests SET status = 'attending' WHERE id = %s", (g["מתלבטת"],))   # she decided; keeps the flow below at 3
    assert p["rounds_allowed"] == 1 and p["can_schedule"]
    assert "היי דנה," in p["sample_opening"] and "מיכל ויוסי" in p["sample_opening"]
    assert "ביום חמישי, השנים עשר בנובמבר" in p["sample_opening"]  # 17:30Z = 19:30 Israel, same day

    # --- plan without calls: blocked until the admin override ---
    eid2, _ = seed_event(plan="basic")
    r = client.post(f"/admin/events/{eid2}/rounds", json={}, headers=token(ADMIN))
    assert r.status_code == 409 and r.json()["detail"]["error"] == "no_phone_rounds_left"
    a = client.put(f"/admin/events/{eid2}/settings", json={"enabled": True}, headers=token(ADMIN)).json()
    assert a["rounds_allowed"] == vc.OVERRIDE_CALL_ROUNDS

    # WhatsApp could not reach שירה even after the retry -> she is dialled first
    sql("INSERT INTO messages_sent VALUES (%s, %s, 'failed', '131049', 1)", (str(uuid.uuid4()), g["שירה"]))

    # --- schedule a round ---
    r = client.post(f"/admin/events/{eid}/rounds", json={}, headers=token(ADMIN))
    assert r.status_code == 201, r.text
    assert r.json()["total"] == 3
    order = sql("SELECT guest_id::text FROM voice_calls WHERE event_id = %s ORDER BY next_at, guest_name", (eid,))
    assert order[0][0] == g["שירה"], order
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
    # the opening is voiced in parts: greeting per name, body per event, fixed menu
    assert any(t.endswith("היי דנה, מדברת מ־ShowUp, אישורי הגעה.") for t in TTS_CALLS)
    body_clips = [t for t in TTS_CALLS if "מיכל ויוסי מזמינים" in t and "היי" not in t]
    assert len(body_clips) == 1, body_clips   # dana + ron + shira share one event clip
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
    assert opening_key.endswith(".wav") and main.clip_url(opening_key) in r.text   # one seamless file
    wav = (tts.CLIP_DIR / opening_key).read_bytes()
    # lead-in silence + 3 parts x (200 ms voice + 15 ms head + 60 ms tail) + 2 gaps, edge silence trimmed
    lead = 2 * 16 * tts.LEAD_MS
    assert wav[:4] == b"RIFF" and not any(wav[44:44 + lead]) \
        and len(wav) - 44 < lead + 3 * 2 * 16 * 290 + 2 * 2 * 16 * tts.GAP_MS
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
    assert r.status_code == 200 and "היי עומר," in r.json()["opening_text"]
    assert main.tick() == 1 and PLACED[-1]["to"] == "+972541234567"
    t = PLACED[-1]
    tid = r.json()["call"]["id"]
    twilio_post(t["answer"], {"CallSid": t["sid"], "AnsweredBy": "human"})
    twilio_post(main.public_url(f"/twilio/step?c={tid}&s=menu&t=1"), {"CallSid": t["sid"], "Digits": "1"})
    twilio_post(main.public_url(f"/twilio/step?c={tid}&s=count&t=1"), {"CallSid": t["sid"], "Digits": "2"})
    twilio_post(t["status"], {"CallSid": t["sid"], "CallStatus": "completed"})
    tc = client.get(f"/admin/calls/{tid}", headers=token(ADMIN)).json()
    assert tc["result"] == "confirmed" and tc["guest_count"] == 2 and tc["status"] == "done"

    # --- async AMD: opening plays at once; voicemail verdict hangs up, a pressed key wins ---
    HUNG = []
    telephony.hangup = HUNG.append
    for pressed in (False, "timeout", True):
        r = client.post("/admin/test-call", json={"phone": "0541234567", "name": "עומר"}, headers=token(ADMIN))
        cid = r.json()["call"]["id"]
        assert main.tick() == 1
        a = PLACED[-1]
        assert "/twilio/amd?c=" in a["amd"]
        assert "<Play>" in twilio_post(a["answer"], {"CallSid": a["sid"]}).text   # no AnsweredBy yet
        if pressed is True:
            twilio_post(main.public_url(f"/twilio/step?c={cid}&s=menu&t=1"), {"CallSid": a["sid"], "Digits": "2"})
        elif pressed == "timeout":   # the menu timed out once before the AMD verdict arrived
            twilio_post(main.public_url(f"/twilio/step?c={cid}&s=menu&t=1"), {"CallSid": a["sid"]})
        assert twilio_post(a["amd"], {"CallSid": a["sid"], "AnsweredBy": "machine_start"}).status_code == 204
        assert HUNG == ([] if pressed is True else [a["sid"]]), (pressed, HUNG)
        twilio_post(a["status"], {"CallSid": a["sid"], "CallStatus": "completed"})
        res = client.get(f"/admin/calls/{cid}", headers=token(ADMIN)).json()["result"]
        assert res == ("declined" if pressed is True else "machine") or (pressed == "timeout" and res == "no_input"), res
        HUNG.clear()

    # --- landing-page sample call: hours, Israeli mobiles, per-number/IP limits ---
    demo = lambda body, ip="1.2.3.4": client.post("/public/demo-call", json=body, headers={"X-Real-IP": ip})
    main.now_il = lambda: datetime(2026, 11, 7, 12, 0, tzinfo=main.IL)            # Saturday
    assert demo({"name": "נועה", "phone": "0521112233"}).status_code == 409
    main.now_il = lambda: datetime(2026, 11, 8, 12, 0, tzinfo=main.IL)            # Sunday noon
    assert demo({"name": "נועה", "phone": "035551234"}).status_code == 400          # landline
    r = demo({"name": "נועה כהן", "phone": "052-111-2233"})
    assert r.status_code == 202 and r.json()["from"] == "03-1234567", r.text
    assert demo({"name": "נועה", "phone": "0521112233"}, ip="9.9.9.9").status_code == 429   # same number today
    assert demo({"name": "x", "phone": "0521112244"}).status_code == 202
    assert demo({"name": "x", "phone": "0521112255"}).status_code == 202
    assert demo({"name": "x", "phone": "0521112266"}).json()["detail"]["error"] == "busy"  # 4th from one IP
    assert main.tick() >= 1
    d = next(p for p in PLACED if p["to"] == "+972521112233")
    assert any("היי נועה, כאן ShowUp. ביקשתם לשמוע" in t for t in TTS_CALLS)
    assert any("נכנסים ל־ShowUp" in t for t in TTS_CALLS)
    assert "<Play>" in twilio_post(d["answer"], {"CallSid": d["sid"]}).text

    # --- clips are served, traversal is not ---
    key = opening_key.removeprefix("voice/")
    r = client.get(f"/clips/{key}")
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    assert client.get("/clips/..%2F..%2Fetc/passwd").status_code == 404

    # --- automatic rounds: planned per plan, guest list taken at start, follow the date ---
    from datetime import timedelta
    now = datetime(2026, 9, 1, 9, 0, tzinfo=main.IL)
    pro_eid, pro_g = seed_event(plan="pro")
    basic_eid, _ = seed_event(plan="basic")
    sql("UPDATE events SET event_date = '2020-01-01' WHERE id NOT IN (%s, %s)", (pro_eid, basic_eid))
    sql("DELETE FROM voice_event_settings")
    assert main.plan_auto_rounds(now) == 3
    auto = sql("SELECT start_at, auto, populated, status FROM voice_rounds WHERE event_id = %s ORDER BY start_at", (pro_eid,))
    assert [r[0].astimezone(main.IL).date().isoformat() for r in auto] == ["2026-11-02", "2026-11-08", "2026-11-10"]
    assert all(r[1] and not r[2] and r[3] == "scheduled" for r in auto)
    assert sql("SELECT count(*) FROM voice_rounds WHERE event_id = %s", (basic_eid,))[0][0] == 0
    assert main.plan_auto_rounds(now) == 0                       # idempotent
    # the event moves a week later -> the not-started automatic rounds move with it
    sql("UPDATE events SET event_date = event_date + interval '7 days' WHERE id = %s", (pro_eid,))
    assert main.plan_auto_rounds(now) == 3
    moved = sql("SELECT start_at FROM voice_rounds WHERE event_id = %s ORDER BY start_at", (pro_eid,))
    assert moved[0][0].astimezone(main.IL).date().isoformat() == "2026-11-09"

    # --- owner API (core forwards with the internal secret) ---
    H = {"X-Internal-Secret": "int-secret"}
    base = f"/internal/events/{pro_eid}/call-rounds"
    assert client.get(base).status_code == 403
    lst = client.get(base, headers=H).json()
    assert lst["rounds_allowed"] == 3 and lst["rounds_used"] == 3 and not lst["can_schedule"]
    assert lst["pending_guests"] == 4 and [r["auto"] for r in lst["rounds"]] == [True, True, True]
    first = lst["rounds"][0]["id"]
    assert client.post(base, json={"start_at": "2026-11-15T11:00:00+02:00"}, headers=H).status_code == 409  # 3 of 3
    assert client.put(f"{base}/{first}", json={"start_at": "2020-01-01T11:00:00+02:00"}, headers=H).status_code == 422
    assert client.put(f"{base}/{first}", json={"start_at": "2026-11-30T11:00:00+02:00"}, headers=H).status_code == 422  # after event
    r = client.put(f"{base}/{first}", json={"start_at": "2026-11-04T12:00:00+02:00"}, headers=H)
    assert r.status_code == 200 and r.json()["auto"] is False
    assert client.post(f"{base}/{first}/cancel", headers=H).status_code == 200
    assert client.post(base, json={"start_at": "2026-11-05T11:00:00+02:00"}, headers=H).status_code == 201
    other_eid, _ = seed_event(plan="pro")
    assert client.put(f"/internal/events/{other_eid}/call-rounds/{first}", json={"start_at": "2026-11-04T12:00:00+02:00"},
                      headers=H).status_code == 404
    sql("UPDATE events SET event_date = '2020-01-01' WHERE id = %s", (other_eid,))

    # a due automatic round takes whoever is still pending at that moment
    sql("UPDATE guests SET status = 'attending' WHERE id = %s", (pro_g["דנה כהן"],))
    sql("UPDATE voice_rounds SET start_at = now() - interval '1 minute' WHERE event_id = %s AND auto", (pro_eid,))
    main.tick()
    started = sql("SELECT status, total, populated FROM voice_rounds WHERE event_id = %s AND auto ORDER BY start_at", (pro_eid,))
    assert started[0][0] in ("running", "done") and started[0][2] and started[0][1] == 3, started   # רון + שירה + מתלבטת
    sql("UPDATE guests SET status = 'attending' WHERE event_id = %s", (pro_eid,))
    sql("UPDATE voice_rounds SET start_at = now() - interval '1 minute' WHERE event_id = %s AND NOT auto", (pro_eid,))
    main.tick()
    manual = sql("SELECT status, total FROM voice_rounds WHERE event_id = %s AND NOT auto AND status <> 'canceled'", (pro_eid,))
    assert manual == [("done", 0)]                                # everyone answered meanwhile -> nothing to call

    # --- cancel ---
    eid4, _ = seed_event()
    rnd = client.post(f"/admin/events/{eid4}/rounds", json={"start_at": "2030-01-01T10:00:00"}, headers=token(ADMIN)).json()
    assert client.post(f"/admin/rounds/{rnd['id']}/cancel", headers=token(ADMIN)).json()["canceled_calls"] == 4

    # --- calls back to our number ---
    import re
    from html import unescape
    action = lambda xml: unescape(re.search(r'action="([^"]+)"', xml).group(1))
    inbound = lambda frm, sid: twilio_post(main.public_url("/twilio/inbound"), {"CallSid": sid, "From": frm})
    eid5, g5 = seed_event()

    # a stranger: who we are + WhatsApp, then hang up; nothing recorded
    r = inbound("+972509999999", "CAstranger")
    assert r.status_code == 200 and "<Hangup/>" in r.text and "<Gather" not in r.text
    assert vc.UNKNOWN_CALLER_TEXT in TTS_CALLS
    assert not sql("SELECT 1 FROM voice_calls WHERE twilio_sid = 'CAstranger'")
    assert twilio_post(main.public_url("/twilio/inbound"), {"CallSid": "x", "From": "+972509999999"},
                       good=False).status_code == 403

    # one upcoming invitation -> straight to it; the keypad answer updates the guest
    only = str(uuid.uuid4())
    sql("INSERT INTO guests (id, event_id, name, phone, status, import_count) VALUES (%s,%s,'יעל','+972507777777','invited',2)",
        (only, eid5))
    r = inbound("+972507777777", "CAonly")
    assert "/twilio/step?" in action(r.text)
    assert any("היי יעל," in t and "תודה שחזרתם אלינו" in t for t in TTS_CALLS)
    assert any(t.startswith("[") and "מיכל ויוסי" in t and "היי" not in t for t in TTS_CALLS)
    row = sql("SELECT direction, status, guest_id::text, event_id::text FROM voice_calls WHERE twilio_sid = 'CAonly'")[0]
    assert row == ("inbound", "in_progress", only, eid5), row
    r = twilio_post(action(r.text), {"Digits": "1", "CallSid": "CAonly"})
    r = twilio_post(action(r.text), {"Digits": "4#", "CallSid": "CAonly"})
    assert guest(only)[:2] == ("attending", 4)
    twilio_post(main.public_url("/twilio/status"), {"CallSid": "CAonly", "CallStatus": "completed", "CallDuration": "20"})
    assert sql("SELECT status, result FROM voice_calls WHERE twilio_sid = 'CAonly'")[0] == ("done", "confirmed")

    # we called רון a minute ago (he is invited to several events) -> that call's event
    ron = g5["רון לוי"]
    sql("INSERT INTO voice_calls (event_id, guest_id, phone, guest_name, status, result) "
        "VALUES (%s, %s, '+972502222222', 'רון לוי', 'done', 'no_answer')", (eid5, ron))
    r = inbound("+972502222222", "CAron")
    assert sql("SELECT guest_id::text FROM voice_calls WHERE twilio_sid = 'CAron'")[0][0] == ron
    twilio_post(action(r.text), {"Digits": "2", "CallSid": "CAron"})
    assert guest(ron)[0] == "declined"

    # מאיה is invited to two upcoming events and was not called -> pick one
    eid6, _ = seed_event(event_type="brit")
    for e in (eid6, eid5):
        sql("INSERT INTO guests (id, event_id, name, phone, status, import_count) VALUES (%s,%s,'מאיה','0508888888','invited',1)",
            (str(uuid.uuid4()), e))
    r = inbound("+972508888888", "CAshira")
    pick = action(r.text)
    assert "/twilio/inbound/pick?" in pick and any("אם זה לגבי ההזמנה של" in t for t in TTS_CALLS)
    ids = re.search(r"g=([^&]+)", pick).group(1).split(",")
    assert len(ids) == 2
    again = twilio_post(pick, {"Digits": "9", "CallSid": "CAshira", "From": "+972508888888"})
    assert "t=2" in action(again.text)                                   # wrong key -> menu once more
    r = twilio_post(pick, {"Digits": "2", "CallSid": "CAshira", "From": "+972508888888"})
    assert sql("SELECT guest_id::text FROM voice_calls WHERE twilio_sid = 'CAshira'")[0][0] == ids[1]
    twilio_post(main.public_url("/twilio/status"), {"CallSid": "CAshira", "CallStatus": "completed"})
    assert sql("SELECT status FROM voice_calls WHERE twilio_sid = 'CAshira'")[0][0] == "done"   # never re-dialed

    # pressed 9: core sends the invitation on WhatsApp; the clip never claims a failed send
    posted = []

    class _Resp:
        def __init__(self, code):
            self.status_code = code
    clip_of = lambda text: tts.key_for(text, tts.voice_id()).removeprefix("voice/")
    for code, text in ((200, vc.WHATSAPP_SENT_TEXT), (503, vc.WHATSAPP_FAILED_TEXT)):
        gid = str(uuid.uuid4())
        sql("INSERT INTO guests (id, event_id, name, phone, status, import_count) VALUES (%s,%s,'טל',%s,'invited',1)",
            (gid, eid5, f"+97250123400{code % 10}"))
        main.httpx.post = lambda url, **kw: (posted.append((url, kw["json"], kw["headers"])), _Resp(code))[1]
        r = inbound(f"+97250123400{code % 10}", f"CA9{code}")
        r = twilio_post(action(r.text), {"Digits": "9", "CallSid": f"CA9{code}"})
        assert clip_of(text) in r.text and "<Hangup/>" in r.text, r.text
        assert sql("SELECT result FROM voice_calls WHERE twilio_sid = %s", (f"CA9{code}",))[0][0] == "whatsapp"
        assert guest(gid)[0] == "invited"
    assert posted[0][0].endswith("/internal/voice/send-invitation") and posted[0][1]["event_id"] == eid5
    assert posted[0][2]["X-Internal-Secret"] == "int-secret"

    print("voice-service db test: OK")


if __name__ == "__main__":
    run()
