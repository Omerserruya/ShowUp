"""Automated RSVP phone calls - scripts, IVR state machine, TwiML, signatures.

Pure python. Run: `python3 shared/domain/tests/test_voice_calls.py` or pytest.
"""
import os
import sys
from datetime import datetime

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from shared.domain import voice_calls as vc  # noqa: E402


def test_spoken_date():
    assert vc.spoken_date("2026-11-12T19:30:00") == "ביום חמישי, ה-12 בנובמבר"
    assert vc.spoken_date("2026-11-14T19:30:00") == "בשבת, ה-14 בנובמבר"
    assert vc.spoken_date(None) == "" and vc.spoken_date("garbage") == ""


def test_opening_is_one_personal_utterance_per_event_type():
    w = vc.opening_text("wedding", "דנה כהן", "מיכל ויוסי", "2026-11-12T19:30:00")
    assert w.startswith("[excited] היי דנה! איזה כיף,")
    assert "מיכל ויוסי" in w and "לחתונה שלהם ביום חמישי, ה-12 בנובמבר" in w
    assert w.endswith(vc.MENU_TEXT)
    corp = vc.opening_text("corporate", "דנה", "אקמה", None)
    assert corp.startswith("[friendly] שלום דנה,") and "כיף" not in corp
    brit = vc.opening_text("brit", "", "משפחת לוי", None)
    assert brit.startswith("[warmly] שלום!") and "לברית." in brit
    assert vc.opening_text("unknown-type", "רון", "", None).startswith("[warmly] היי רון")


def test_opening_handles_junk_names_missing_hosts_and_honoree():
    assert vc.first_name("7") == "" and vc.first_name("- כהן") == "" and vc.first_name("0501234567") == ""
    assert vc.first_name("דנה") == "דנה" and vc.first_name("Dana Cohen") == "Dana"
    t = vc.opening_text("birthday", "7", "", "2026-09-04T20:00:00", "מיכל")
    assert t.startswith("[excited] היי! איזה כיף,")
    assert "אנחנו מתקשרים לגבי ההזמנה ליום ההולדת של מיכל ביום שישי, ה-4 בספטמבר." in t
    assert "המארחים" not in t
    assert "לחתונה ב" not in vc.opening_text("wedding", "", "", None)
    assert "לחתונה." in vc.opening_text("wedding", "", "", None)
    # honoree already named by the hosts label -> not repeated
    b = vc.opening_text("bar", "רון", "משפחת לוי", None, "איתי")
    assert "לבר המצווה של איתי." in b
    assert "של מיכל" not in vc.opening_text("birthday", "", "מיכל", None, "מיכל")


def test_fixed_texts_cover_every_clip_the_machine_plays():
    names = set()
    steps = [vc.on_answer()]
    for step, digits, tries in [("menu", "1", 1), ("menu", "2", 1), ("menu", "3", 1), ("menu", "", 1),
                                ("menu", "9", 1), ("menu", "", 2), ("count", "4", 1), ("count", "", 1),
                                ("count", "", 2), ("other", "", 1)]:
        steps.append(vc.on_digits(step, digits, tries))
    for s in steps:
        names.update(s.play)
    for et in ("wedding", "brit", "corporate", "other"):
        assert names - {"opening"} <= set(vc.fixed_texts(et))


def test_menu():
    s = vc.on_digits("menu", "1", 1)
    assert s.gather == "count" and s.result is None
    assert vc.on_digits("menu", "2", 1).result == vc.CallResult.DECLINED
    assert vc.on_digits("menu", "3", 1).result == vc.CallResult.MAYBE
    again = vc.on_digits("menu", "", 1)
    assert again.gather == "menu" and again.tries == 2 and again.play == ("menu",)
    assert vc.on_digits("menu", "7", 1).play == ("menu_invalid",)
    last = vc.on_digits("menu", "", vc.MENU_TRIES)
    assert last.result == vc.CallResult.NO_INPUT and last.hangup


def test_count():
    assert vc.parse_count("4#") == 4 and vc.parse_count("04") == 4 and vc.parse_count("12") == 12
    assert vc.parse_count("0") is None and vc.parse_count("") is None and vc.parse_count("99") is None
    s = vc.on_digits("count", "3", 1)
    assert s.result == vc.CallResult.CONFIRMED and s.count == 3 and s.hangup
    retry = vc.on_digits("count", "0", 1)
    assert retry.gather == "count" and retry.play == ("count_invalid",)
    # pressed 1 (coming) but never a usable number: still confirmed, count unknown
    s = vc.on_digits("count", "", vc.COUNT_TRIES)
    assert s.result == vc.CallResult.CONFIRMED and s.count is None


def test_result_from_status():
    assert vc.result_from_status("no-answer") == vc.CallResult.NO_ANSWER
    assert vc.result_from_status("busy") == vc.CallResult.BUSY
    assert vc.result_from_status("completed", "machine_end_beep") == vc.CallResult.MACHINE
    assert vc.result_from_status("completed", "human") is None


def test_call_window():
    assert vc.is_call_time(datetime(2026, 11, 12, 10, 0))        # Thursday
    assert not vc.is_call_time(datetime(2026, 11, 12, 20, 0))
    assert not vc.is_call_time(datetime(2026, 11, 12, 9, 59))
    assert vc.is_call_time(datetime(2026, 11, 13, 12, 30))       # Friday
    assert not vc.is_call_time(datetime(2026, 11, 13, 13, 0))
    assert not vc.is_call_time(datetime(2026, 11, 14, 12, 0))    # Saturday
    assert vc.is_call_time(datetime(2026, 11, 15, 11, 0))        # Sunday


def test_twiml():
    x = vc.twiml(("https://a/x.mp3?a=1&b=2",), gather_action="https://h/step?s=menu&t=1")
    assert '<Gather input="dtmf" action="https://h/step?s=menu&amp;t=1"' in x
    assert "<Play>https://a/x.mp3?a=1&amp;b=2</Play></Gather>" in x and 'numDigits="1"' in x
    c = vc.twiml(("u",), gather_action="a", count=True)
    assert 'finishOnKey="#"' in c
    h = vc.twiml(("u",), hangup=True)
    assert "<Gather" not in h and h.endswith("<Play>u</Play><Hangup/></Response>")


def test_twilio_signature():
    # Example from Twilio's security docs.
    token = "12345"
    url = "https://mycompany.com/myapp.php?foo=1&bar=2"
    params = {"CallSid": "CA1234567890ABCDE", "Caller": "+12349013030", "Digits": "1234",
              "From": "+12349013030", "To": "+18005551212"}
    sig = vc.twilio_signature(token, url, params)
    assert sig == "0/KCTR6DLpKmkAf8muzZqo1nDgQ="
    assert vc.valid_twilio_signature(token, url, params, sig)
    assert not vc.valid_twilio_signature(token, url, {**params, "Digits": "1"}, sig)
    assert not vc.valid_twilio_signature("", url, params, sig)


def test_clip_key_is_content_addressed():
    a = vc.clip_key("שלום", "v1")
    assert a == vc.clip_key("שלום", "v1") and a != vc.clip_key("שלום", "v2")
    assert a.startswith("voice/") and a.endswith(".mp3")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
