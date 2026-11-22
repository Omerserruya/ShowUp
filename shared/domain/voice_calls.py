"""Automated RSVP phone calls - the pure domain logic (no I/O).

A call is a short IVR: one personal opening clip per guest ("היי דנה! ...",
generated as ONE TTS clip so the name doesn't sound spliced), then fixed
per-event-type clips (menu repeat, "how many", thanks...). The guest answers
with the keypad (DTMF) - no speech recognition: cheaper, and reliable with
accents and background noise.

    menu:  1 = coming -> count, 2 = not coming, 3 = not sure yet
    count: digits then # (or just wait) -> confirmed with that many people

Everything here is deterministic and unit-tested; the worker / webhook only do
I/O around it (TTS, storage, Twilio REST, DB writes).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Mapping, Optional, Tuple
from xml.sax.saxutils import escape, quoteattr

from .messaging.event_types import EventType, event_type_of

# ---- TTS defaults -------------------------------------------------------------

TTS_MODEL = "eleven_v3"            # multilingual_v2 produces unintelligible Hebrew
TTS_LANGUAGE = "he"
TTS_OUTPUT_FORMAT = "mp3_22050_32"  # phone audio is 8kHz anyway; small files, Twilio plays mp3
DEFAULT_VOICE_NAME = "Nimrod"       # resolved to a voice_id by name (my voices, then the shared library)
# speed 1.15 (API max 1.2) + tts.TEMPO afterwards: at 1.0 the voice sounded slow
# and sleepy on a call. Changing these re-voices every clip (they key the cache).
VOICE_SETTINGS = {"stability": 0.5, "similarity_boost": 0.75, "style": 0.35, "use_speaker_boost": True,
                  "speed": 1.15}

# ---- call policy -------------------------------------------------------------

MAX_ATTEMPTS = 2           # per guest per round
MAX_COUNT = 99             # largest party size accepted on the keypad (2 digits)
CALL_HOURS = (10, 20)      # local Israel time, [start, end)
FRIDAY_LAST_HOUR = 13
MENU_TRIES = 2             # how many times the menu is offered before hanging up
COUNT_TRIES = 2

# Phone rounds included per plan (plans otherwise differ only by guest cap and
# message rounds): basic 0, plus 1, pro 3. Unknown plans fail CLOSED, like
# rounds.included_rounds. Overridable via VOICE_CALL_ROUNDS_JSON, e.g. {"plus": 2}.
MAX_CALL_ROUNDS = 3
_DEFAULT_CALL_ROUNDS: Dict[str, int] = {"basic": 0, "plus": 1, "pro": MAX_CALL_ROUNDS, "legacy": MAX_CALL_ROUNDS}
OVERRIDE_CALL_ROUNDS = MAX_CALL_ROUNDS   # an admin switching phone calls on for an event


def included_call_rounds(plan_id, override: Optional[bool] = None) -> int:
    """How many phone rounds an event may run. `override` is the per-event admin
    switch: True grants OVERRIDE_CALL_ROUNDS, False blocks, None = the plan."""
    if override is True:
        return OVERRIDE_CALL_ROUNDS
    if override is False:
        return 0
    table = dict(_DEFAULT_CALL_ROUNDS)
    raw = os.getenv("VOICE_CALL_ROUNDS_JSON")
    if raw:
        try:
            table = {str(k).lower(): int(v) for k, v in json.loads(raw).items()}
        except (ValueError, TypeError, AttributeError):
            pass
    key = str(plan_id).strip().lower() if plan_id else ""
    return max(0, min(MAX_CALL_ROUNDS, table.get(key, 0)))


class CallResult:
    CONFIRMED = "confirmed"
    DECLINED = "declined"
    MAYBE = "maybe"
    NO_INPUT = "no_input"      # answered but never pressed a valid key
    NO_ANSWER = "no_answer"
    BUSY = "busy"
    FAILED = "failed"
    MACHINE = "machine"        # voicemail - hung up without playing
    CANCELED = "canceled"
    WHATSAPP = "whatsapp"      # pressed 9 - the invitation went to WhatsApp, they answer there

    RSVP = (CONFIRMED, DECLINED, MAYBE)
    RETRYABLE = (NO_ANSWER, BUSY, MACHINE, NO_INPUT)


# ---- spoken Hebrew text ------------------------------------------------------

_WEEKDAYS = {0: "שני", 1: "שלישי", 2: "רביעי", 3: "חמישי", 4: "שישי", 5: "שבת", 6: "ראשון"}
_MONTHS = {1: "בינואר", 2: "בפברואר", 3: "במרץ", 4: "באפריל", 5: "במאי", 6: "ביוני",
           7: "ביולי", 8: "באוגוסט", 9: "בספטמבר", 10: "באוקטובר", 11: "בנובמבר", 12: "בדצמבר"}


def _as_datetime(value) -> Optional[datetime]:
    """The event time in ISRAEL time (stored in UTC: an event at 00:30 is the
    previous day in UTC)."""
    if not value:
        return None
    if not isinstance(value, datetime):
        try:
            value = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if value.tzinfo is not None:
        from zoneinfo import ZoneInfo
        value = value.astimezone(ZoneInfo("Asia/Jerusalem"))
    return value


# Day of the month in words, as correct Hebrew says it: ordinal for 1-10
# ("השלישי בנובמבר"), masculine cardinal from 11 ("השלושה עשר", "העשרים ואחד").
# Digits made the voice read "השלוש בנובמבר".
_ORDINAL = ("", "הראשון", "השני", "השלישי", "הרביעי", "החמישי", "השישי", "השביעי", "השמיני",
            "התשיעי", "העשירי")
_UNITS_M = ("", "אחד", "שניים", "שלושה", "ארבעה", "חמישה", "שישה", "שבעה", "שמונה", "תשעה")
_TEENS_M = ("", "אחד עשר", "שנים עשר", "שלושה עשר", "ארבעה עשר", "חמישה עשר", "שישה עשר",
            "שבעה עשר", "שמונה עשר", "תשעה עשר")


def day_words(day: int) -> str:
    if 1 <= day <= 10:
        return _ORDINAL[day]
    if day < 20:
        return "ה" + _TEENS_M[day - 10]
    tens = "העשרים" if day < 30 else "השלושים"
    unit = day % 10
    return tens if unit == 0 else f"{tens} ו{_UNITS_M[unit]}"


def spoken_date(value) -> str:
    """'ביום חמישי, השנים עשר בנובמבר' - how a person says it (not '12.11.26')."""
    dt = _as_datetime(value)
    if not dt:
        return ""
    day = _WEEKDAYS[dt.weekday()]
    prefix = "בשבת" if day == "שבת" else f"ביום {day}"
    return f"{prefix}, {day_words(dt.day)} {_MONTHS[dt.month]}"


def couple_with_last_names(subjects: Optional[dict]) -> str:
    """The couple as said on the phone, with last names when known - with no
    invitation in front of them, the guest needs to know WHICH Michal and Yossi:
    'מיכל לוי ויוסי כהן', a shared name once ('מיכל ויוסי לוי'). '' when there is
    no first name (the caller then uses the usual host label)."""
    s = subjects or {}
    p1, p2 = (s.get("p1") or "").strip(), (s.get("p2") or "").strip()
    l1, l2 = (s.get("ln1") or "").strip(), (s.get("ln2") or "").strip()
    if not (p1 and p2):
        return ""
    if l1 and l1 == l2:
        return f"{p1} ו{p2} {l1}"
    a = f"{p1} {l1}".strip()
    b = f"{p2} {l2}".strip()
    return f"{a} ו{b}"


def first_name(guest_name: str) -> str:
    """The name to say. Imported lists hold junk ("7", "-", "0501234567"); a
    name with no letters is not said at all."""
    parts = (guest_name or "").strip().split()
    name = parts[0].strip(".,-_()") if parts else ""
    if name in _FAMILY_WORDS and len(parts) > 1:   # "משפחת כהן" -> said whole, not "היי משפחת!"
        name = f"משפחת {parts[1].strip('.,-_()')}"
    return name if sum(ch.isalpha() for ch in name) >= 2 else ""


_FAMILY_WORDS = {"משפחת", "משפ'", "משפ׳", "משפחה", "מש'"}


# ---- scripts per event type ----------------------------------------------------
# eleven_v3 audio tags ([excited], [warmly], [breathes], [short pause]) steer the
# delivery; they are not read aloud. The speaker is a woman (first person,
# feminine: "מתקשרת", "רשמתי") with breaths and pauses so it sounds like a real
# person, not an IVR. Each tone keeps the same structure so the state machine is shared.

@dataclass(frozen=True)
class Tone:
    tag: str                 # audio tag opening every clip
    hello: str               # "היי {name}!"
    hello_no_name: str
    thanks_yes: str
    thanks_no: str
    thanks_maybe: str


_OCCASION = {
    EventType.WEDDING: "לחתונה שלהם",
    EventType.BRIT: "לברית",
    EventType.BRITA: "לבריתה",
    EventType.BAR: "לבר המצווה",
    EventType.BAT: "לבת המצווה",
    EventType.BIRTHDAY: "ליום ההולדת",
    EventType.CORPORATE: "לאירוע",
    EventType.OTHER: "לאירוע",
}

_TONES: Dict[str, Tone] = {
    "celebration": Tone(
        tag="[warmly]",
        hello="היי {name},",
        hello_no_name="היי,",
        thanks_yes="[warmly] מעולה, רשמתי. מחכים לכם, נתראה בשמחות.",
        thanks_no="[warmly] אוקיי, תודה שעדכנתם, רשמתי. יום נפלא.",
        thanks_maybe="[warmly] בסדר גמור, אין לחץ. כשתדעו, אפשר לעדכן בוואטסאפ, או פשוט לחזור אלינו למספר הזה. יום נפלא.",
    ),
    "family": Tone(
        tag="[warmly]",
        hello="היי {name}, שלום!",
        hello_no_name="שלום!",
        thanks_yes="[warmly] מעולה, רשמתי. מחכים לכם, נתראה בשמחה.",
        thanks_no="[warmly] אוקיי, תודה שעדכנתם, רשמתי. יום טוב.",
        thanks_maybe="[warmly] בסדר גמור, אין לחץ. כשתדעו, אפשר לעדכן בוואטסאפ, או לחזור אלינו למספר הזה. יום טוב.",
    ),
    "business": Tone(
        tag="[friendly]",
        hello="שלום {name},",
        hello_no_name="שלום,",
        thanks_yes="[friendly] תודה, רשמתי את ההגעה. נתראה באירוע!",
        thanks_no="[friendly] תודה על העדכון, רשמתי שלא תגיעו. יום טוב.",
        thanks_maybe="[friendly] בסדר, רשמתי שעוד לא בטוחים. כשתדעו, אפשר לעדכן בוואטסאפ או להתקשר חזרה למספר הזה. יום טוב.",
    ),
}

# The landing-page sample call ("נסו שיחת טלפון"): a visitor asked to hear it,
# so the opening says so up front, then plays a pretend wedding invitation.
# Nothing is written anywhere - it is a test call.
_TONES["demo"] = Tone(
    tag="[warmly]",
    hello="היי {name},",
    hello_no_name="היי,",
    thanks_yes="[warmly] מעולה, רשמתי. וזהו, ככה זה נרשם אצל בעלי השמחה, בלי שאף אחד הרים טלפון. "
               "רוצים שנעשה את זה גם לאורחים שלכם? נכנסים ל־ShowUp ופותחים אירוע. יום נפלא.",
    thanks_no="[warmly] אוקיי, גם תשובה כזאת נרשמת מיד. "
              "רוצים שנעשה את זה גם לאורחים שלכם? נכנסים ל־ShowUp ופותחים אירוע. יום נפלא!",
    thanks_maybe="[warmly] אין בעיה, גם את זה רושמים. "
                 "רוצים שנעשה את זה גם לאורחים שלכם? נכנסים ל־ShowUp ופותחים אירוע. יום נפלא!",
)
DEMO_INTRO = ("כאן ShowUp. ביקשתם לשמוע איך נשמעת שיחה שלנו לאורחים, אז בואו נדמיין: "
              "מיכל ויוסי מתחתנים ביום חמישי הבא, ואני מתקשרת לשאול אם תגיעו.")

_TONE_OF = {
    EventType.WEDDING: "celebration",
    EventType.BAR: "celebration",
    EventType.BAT: "celebration",
    EventType.BIRTHDAY: "celebration",
    EventType.BRIT: "family",
    EventType.BRITA: "family",
    EventType.OTHER: "family",
    EventType.CORPORATE: "business",
}

# Spoken like a person, not an IVR: "תלחצו" (everyday) instead of "הקישו",
# no "ואז סולמית" - the count gather submits on its own after a short silence.
MENU_TEXT = ("אם אתם מגיעים, פשוט תלחצו אחת. אם לא, שתיים. ואם עוד לא בטוחים, שלוש. "
             "ואם נוח לכם יותר בוואטסאפ, תלחצו תשע ואשלח לכם את ההזמנה.")
COUNT_TEXT = "מעולה. כמה תהיו, כולל אתכם? פשוט תלחצו את המספר."
COUNT_INVALID_TEXT = "סליחה, לא הצלחתי לקלוט. כמה תהיו? תלחצו מספר, למשל שתיים."
MENU_INVALID_TEXT = "סליחה, לא קלטתי."
GOODBYE_TEXT = "נראה שזה לא זמן טוב, אין בעיה. אפשר לענות לנו גם בוואטסאפ. יום טוב."
# "9": the invitation is sent on WhatsApp, the guest answers there.
WHATSAPP_SENT_TEXT = "[warmly] שלחתי לכם עכשיו את ההזמנה בוואטסאפ, ואפשר לאשר הגעה ישר משם. יום נפלא."
WHATSAPP_FAILED_TEXT = ("[warmly] סליחה, משהו השתבש בשליחה. אפשר להתקשר חזרה למספר הזה מתי שנוח, "
                        "ונסיים את זה בטלפון. יום נפלא!")
WHATSAPP_TEST_TEXT = "[warmly] בשיחה אמיתית, עכשיו הייתה נשלחת אליכם ההזמנה בוואטסאפ. יום נפלא."
# Occasions that read better with the honoree's name ("ליום ההולדת של מיכל").
_WITH_HONOREE = {EventType.BAR, EventType.BAT, EventType.BIRTHDAY, EventType.BRIT, EventType.BRITA}


def tone_key(event_type) -> str:
    et = event_type_of(event_type) or EventType.OTHER
    return _TONE_OF.get(et, "family")


def _about(et, hosts: str, event_date, honoree: str) -> str:
    """'נועה ויונתן מזמינים אתכם לחתונה שלהם ביום שלישי, ה-3 בנובמבר.'"""
    when = spoken_date(event_date)
    when = f" {when}" if when else ""
    hosts = (hosts or "").strip()
    honoree = (honoree or "").strip()
    occasion = _OCCASION.get(et, "לאירוע")
    if et == EventType.WEDDING and not hosts:
        occasion = "לחתונה"
    if et in _WITH_HONOREE and honoree and honoree not in hosts:
        occasion = f"{occasion} של {honoree}"
    return f"{hosts} מזמינים אתכם {occasion}{when}." if hosts else f"זה לגבי ההזמנה {occasion}{when}."


def opening_text(event_type, guest_name: str, hosts: str, event_date=None, honoree: str = "",
                 inbound: bool = False) -> str:
    """The personal clip: greeting, who we are ("ShowUp, אישורי הגעה" - so the
    guest knows at once what the call is), whose event, then the menu - ONE
    utterance so the name flows into the rest. Generated per guest (cached)."""
    et = event_type_of(event_type) or EventType.OTHER
    tone = _TONES[tone_key(et)]
    name = first_name(guest_name)
    hello = tone.hello.format(name=name) if name else tone.hello_no_name
    who = (f"כאן ShowUp, אישורי הגעה, {INBOUND_THANKS}" if inbound
           else "מדברת מ־ShowUp, אישורי הגעה.")
    return f"{tone.tag} {hello} {who} {_about(et, hosts, event_date, honoree)} {MENU_TEXT}"


def opening_parts(event_type, guest_name: str, hosts: str, event_date=None, honoree: str = "",
                  inbound: bool = False) -> List[str]:
    """The opening as separately voiced clips, each cached by its exact text:
      1. greeting with the first name + who we are - one clip per name, shared
         by every event (and one with no name);
      2. whose event and when - one clip per event;
      3. the menu - the tone's fixed clip.
    The joins fall at sentence ends, where a pause sounds like a breath; a join
    between the name and the rest of its sentence was clearly audible.
    Only a name or an event never voiced before costs a new generation. Played
    back to back they say the same words as opening_text()."""
    et = event_type_of(event_type) or EventType.OTHER
    tk = tone_key(et)
    tone = _TONES[tk]
    name = first_name(guest_name)
    hello = tone.hello.format(name=name) if name else tone.hello_no_name
    # no [breathes] here: inside a short clip it came out as an audible sigh
    who = f"כאן ShowUp, אישורי הגעה, {INBOUND_THANKS}" if inbound else "מדברת מ־ShowUp, אישורי הגעה."
    return [f"{tone.tag} {hello} {who}", f"{tone.tag} {_about(et, hosts, event_date, honoree)}",
            fixed_texts(tk)["menu"]]


# ---- calls back to our number (inbound) ---------------------------------------------

INBOUND_THANKS = "תודה שחזרתם אלינו."
UNKNOWN_CALLER_TEXT = ("[warmly] שלום! [breathes] הגעתם ל־ShowUp, מערכת אישורי הגעה לאירועים. [short pause] "
                       "אם קיבלתם מאיתנו הזמנה, אפשר לענות עליה גם בהודעת הוואטסאפ ששלחנו. תודה, ויום נפלא!")
_DIGIT_WORDS = {1: "אחת", 2: "שתיים", 3: "שלוש"}
MAX_INBOUND_CHOICES = len(_DIGIT_WORDS)


def inbound_opening_text(event_type, guest_name: str, hosts: str, event_date=None, honoree: str = "") -> str:
    """A guest called our number back: greet, say which invitation this is about,
    then the same menu as the outbound call."""
    return opening_text(event_type, guest_name, hosts, event_date, honoree, inbound=True)


def inbound_choice_text(hosts_list: List[str]) -> str:
    """The caller is invited to several upcoming events and we did not call them
    recently: let them pick which invitation they are answering."""
    parts = [f"אם זה לגבי ההזמנה של {h or 'אירוע אחר'}, הַקִּישׁוּ {_DIGIT_WORDS[i]}."
             for i, h in enumerate(hosts_list[:MAX_INBOUND_CHOICES], start=1)]
    return f"[warmly] היי! [breathes] כאן ShowUp, אישורי הגעה, {INBOUND_THANKS} [short pause] " + " ".join(parts)


def demo_name(raw: str) -> str:
    """The visitor's typed name, said aloud on a call to a number they typed.
    Only a short, letters-only first name is spoken - anything else is dropped,
    so the form can't be used to make us say arbitrary text to someone."""
    name = first_name(raw)
    return name if len(name) <= 15 and all(ch.isalpha() or ch in "'-" for ch in name) else ""


def demo_opening_text(visitor_name: str) -> str:
    tone = _TONES["demo"]
    name = demo_name(visitor_name)
    hello = tone.hello.format(name=name) if name else tone.hello_no_name
    return f"{tone.tag} {hello} {DEMO_INTRO} {MENU_TEXT}"


# Sample calls go out only at hours a stranger would accept a call.
DEMO_HOURS = (9, 21)
DEMO_FRIDAY_LAST_HOUR = 14


def is_demo_call_time(local: datetime) -> bool:
    wd = local.weekday()
    if wd == 5:
        return False
    start, end = DEMO_HOURS
    if wd == 4:
        end = DEMO_FRIDAY_LAST_HOUR
    return start <= local.hour < end


def fixed_texts(event_type_or_tone) -> Dict[str, str]:
    """The per-event-type clips shared by all guests (generated once, cached).
    Accepts an event type or a tone key (what a call row stores)."""
    tone = _TONES.get(str(event_type_or_tone)) or _TONES[tone_key(event_type_or_tone)]
    t = tone.tag
    return {
        "menu": f"{t} {MENU_TEXT}",
        "menu_invalid": f"{t} {MENU_INVALID_TEXT} {MENU_TEXT}",
        "count": f"{t} {COUNT_TEXT}",
        "count_invalid": f"{t} {COUNT_INVALID_TEXT.format(max=MAX_COUNT)}",
        "thanks_yes": tone.thanks_yes,
        "thanks_no": tone.thanks_no,
        "thanks_maybe": tone.thanks_maybe,
        "goodbye": f"{t} {GOODBYE_TEXT}",
        "whatsapp_sent": WHATSAPP_SENT_TEXT,
        "whatsapp_failed": WHATSAPP_FAILED_TEXT,
        "whatsapp_test": WHATSAPP_TEST_TEXT,
    }


def clip_key(text: str, voice_id: str, model: str = TTS_MODEL, fmt: str = TTS_OUTPUT_FORMAT) -> str:
    """Content address of a clip - same text+voice is generated once, ever."""
    h = hashlib.sha256(f"{model}|{fmt}|{voice_id}|{text}".encode("utf-8")).hexdigest()
    return f"voice/{h[:2]}/{h}.mp3"


# ---- the IVR state machine -------------------------------------------------------
# Steps: "open" (call answered) -> "menu" (digit pressed or timeout) -> "count".
# Each step returns what to play next and, when final, the result.

@dataclass(frozen=True)
class Step:
    play: Tuple[str, ...]            # clip names ("opening" or a fixed_texts key)
    gather: Optional[str] = None     # "menu" | "count" - collect digits into this step
    tries: int = 0                   # tries already used for the gather step
    result: Optional[str] = None     # set when the call has an outcome
    count: Optional[int] = None      # party size, with CONFIRMED
    hangup: bool = False


def parse_count(digits: str) -> Optional[int]:
    d = (digits or "").strip().rstrip("#").lstrip("0")
    if not d.isdigit():
        return None
    n = int(d)
    return n if 1 <= n <= MAX_COUNT else None


def on_answer() -> Step:
    return Step(play=("opening",), gather="menu", tries=1)


def on_digits(step: str, digits: str, tries: int) -> Step:
    """Advance on a <Gather> callback. Empty digits = the gather timed out."""
    digits = (digits or "").strip()
    if step == "menu":
        key = digits[:1]
        if key == "1":
            return Step(play=("count",), gather="count", tries=1)
        if key == "2":
            return Step(play=("thanks_no",), result=CallResult.DECLINED, hangup=True)
        if key == "3":
            return Step(play=("thanks_maybe",), result=CallResult.MAYBE, hangup=True)
        if key == "9":   # the caller sends it (and may swap the clip if sending fails)
            return Step(play=("whatsapp_sent",), result=CallResult.WHATSAPP, hangup=True)
        if tries >= MENU_TRIES:
            return Step(play=("goodbye",), result=CallResult.NO_INPUT, hangup=True)
        return Step(play=("menu_invalid" if digits else "menu",), gather="menu", tries=tries + 1)
    if step == "count":
        n = parse_count(digits)
        if n is not None:
            return Step(play=("thanks_yes",), result=CallResult.CONFIRMED, count=n, hangup=True)
        if tries >= COUNT_TRIES:
            # They pressed 1 - coming - but no usable number: record as coming with
            # the invited party size (caller decides), never drop the answer.
            return Step(play=("thanks_yes",), result=CallResult.CONFIRMED, count=None, hangup=True)
        return Step(play=("count_invalid",), gather="count", tries=tries + 1)
    return Step(play=("goodbye",), result=CallResult.NO_INPUT, hangup=True)


def result_from_status(call_status: str, answered_by: Optional[str] = None) -> Optional[str]:
    """Map Twilio's final CallStatus (+ AnsweredBy) to a CallResult for calls that
    never reached a keypad outcome. None = the call completed normally and the
    outcome was already recorded by the IVR."""
    s = (call_status or "").lower()
    if (answered_by or "").startswith("machine") or (answered_by or "") == "fax":
        return CallResult.MACHINE
    return {
        "no-answer": CallResult.NO_ANSWER,
        "busy": CallResult.BUSY,
        "failed": CallResult.FAILED,
        "canceled": CallResult.CANCELED,
    }.get(s)


# ---- call window -------------------------------------------------------------------

def is_call_time(local: datetime) -> bool:
    """Israel local time: 10:00-20:00 Sun-Thu, Friday until 13:00, never Saturday.
    (Holidays are the scheduler's job - it already skips them for WhatsApp.)"""
    wd = local.weekday()  # Mon=0 .. Sun=6
    if wd == 5:
        return False
    start, end = CALL_HOURS
    if wd == 4:
        end = FRIDAY_LAST_HOUR
    return start <= local.hour < end


# ---- TwiML ----------------------------------------------------------------------

def twiml(urls: Tuple[str, ...], *, gather_action: Optional[str] = None, count: bool = False,
          hangup: bool = False) -> str:
    """Render the TwiML for one step. Clips play INSIDE <Gather> so the guest can
    press a key mid-sentence (barge-in)."""
    plays = "".join(f"<Play>{escape(u)}</Play>" for u in urls)
    if gather_action:
        attrs = (f' input="dtmf" action={quoteattr(gather_action)} method="POST" actionOnEmptyResult="true"'
                 + (' finishOnKey="#" timeout="3" numDigits="2"' if count else ' numDigits="1" timeout="6"'))
        body = f"<Gather{attrs}>{plays}</Gather>"
    else:
        body = plays
    if hangup:
        body += "<Hangup/>"
    return f'<?xml version="1.0" encoding="UTF-8"?><Response>{body}</Response>'


def twilio_signature(auth_token: str, url: str, params: Mapping[str, str]) -> str:
    """X-Twilio-Signature: base64(HMAC-SHA1(token, url + sorted key+value pairs))."""
    data = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    mac = hmac.new(auth_token.encode("utf-8"), data.encode("utf-8"), hashlib.sha1)
    return base64.b64encode(mac.digest()).decode("ascii")


def valid_twilio_signature(auth_token: str, url: str, params: Mapping[str, str], signature: str) -> bool:
    if not auth_token or not signature:
        return False
    return hmac.compare_digest(twilio_signature(auth_token, url, params), signature)
