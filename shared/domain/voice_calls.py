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
from typing import Dict, Mapping, Optional, Tuple
from xml.sax.saxutils import escape, quoteattr

from .messaging.event_types import EventType, event_type_of

# ---- TTS defaults -------------------------------------------------------------

TTS_MODEL = "eleven_v3"            # multilingual_v2 produces unintelligible Hebrew
TTS_LANGUAGE = "he"
TTS_OUTPUT_FORMAT = "mp3_22050_32"  # phone audio is 8kHz anyway; small files, Twilio plays mp3
DEFAULT_VOICE_NAME = "Nimrod"       # resolved to a voice_id by name (my voices, then the shared library)
VOICE_SETTINGS = {"stability": 0.5, "similarity_boost": 0.75, "style": 0.35, "use_speaker_boost": True}

# ---- call policy -------------------------------------------------------------

MAX_ATTEMPTS = 2           # per guest per round
MAX_COUNT = 30             # largest party size accepted on the keypad
CALL_HOURS = (10, 20)      # local Israel time, [start, end)
FRIDAY_LAST_HOUR = 13
MENU_TRIES = 2             # how many times the menu is offered before hanging up
COUNT_TRIES = 2

# Phone rounds included per plan (plans otherwise differ only by guest cap and
# message rounds). Unknown plans fail CLOSED, like rounds.included_rounds.
# Overridable via VOICE_CALL_ROUNDS_JSON, e.g. {"plus": 1, "pro": 2}.
_DEFAULT_CALL_ROUNDS: Dict[str, int] = {"pro": 1, "legacy": 1}
OVERRIDE_CALL_ROUNDS = 2   # an admin switching phone calls on for an event


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
    return max(0, table.get(key, 0))


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

    RSVP = (CONFIRMED, DECLINED, MAYBE)
    RETRYABLE = (NO_ANSWER, BUSY, MACHINE, NO_INPUT)


# ---- spoken Hebrew text ------------------------------------------------------

_WEEKDAYS = {0: "שני", 1: "שלישי", 2: "רביעי", 3: "חמישי", 4: "שישי", 5: "שבת", 6: "ראשון"}
_MONTHS = {1: "בינואר", 2: "בפברואר", 3: "במרץ", 4: "באפריל", 5: "במאי", 6: "ביוני",
           7: "ביולי", 8: "באוגוסט", 9: "בספטמבר", 10: "באוקטובר", 11: "בנובמבר", 12: "בדצמבר"}


def _as_datetime(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def spoken_date(value) -> str:
    """'ביום חמישי, ה-12 בנובמבר' - how a person says it (not '12.11.26')."""
    dt = _as_datetime(value)
    if not dt:
        return ""
    day = _WEEKDAYS[dt.weekday()]
    prefix = "בשבת" if day == "שבת" else f"ביום {day}"
    return f"{prefix}, ה-{dt.day} {_MONTHS[dt.month]}"


def first_name(guest_name: str) -> str:
    """The name to say. Imported lists hold junk ("7", "-", "0501234567"); a
    name with no letters is not said at all."""
    parts = (guest_name or "").strip().split()
    name = parts[0].strip(".,-_()") if parts else ""
    return name if sum(ch.isalpha() for ch in name) >= 2 else ""


# ---- scripts per event type ----------------------------------------------------
# eleven_v3 audio tags ([excited], [warmly]) steer the delivery; they are not read
# aloud. Each tone keeps the same structure so the state machine is shared.

@dataclass(frozen=True)
class Tone:
    tag: str                 # audio tag opening every clip
    hello: str               # "היי {name}!"
    hello_no_name: str
    intro: str               # "{hosts} ... {occasion} {date}"
    intro_no_hosts: str      # when the event has no host names
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
        tag="[excited]",
        hello="היי {name}! איזה כיף,",
        hello_no_name="היי! איזה כיף,",
        intro="אנחנו מתקשרים בשם {hosts}, שמזמינים אתכם {occasion}{when}.",
        intro_no_hosts="אנחנו מתקשרים לגבי ההזמנה {occasion}{when}.",
        thanks_yes="[excited] מעולה, רשמנו! מחכים לכם, נתראה בשמחות!",
        thanks_no="[warmly] תודה שעדכנתם, רשמנו שלא תגיעו. המון תודה ויום נפלא!",
        thanks_maybe="[warmly] בסדר גמור, נחזור אליכם קצת יותר קרוב לאירוע. יום נפלא!",
    ),
    "family": Tone(
        tag="[warmly]",
        hello="היי {name}, שלום!",
        hello_no_name="שלום!",
        intro="אנחנו מתקשרים בשם {hosts}, שמזמינים אתכם {occasion}{when}.",
        intro_no_hosts="אנחנו מתקשרים לגבי ההזמנה {occasion}{when}.",
        thanks_yes="[warmly] מעולה, רשמנו! מחכים לכם, נתראה בשמחה!",
        thanks_no="[warmly] תודה שעדכנתם, רשמנו שלא תגיעו. יום טוב!",
        thanks_maybe="[warmly] בסדר גמור, נחזור אליכם קרוב יותר לאירוע. יום טוב!",
    ),
    "business": Tone(
        tag="[friendly]",
        hello="שלום {name},",
        hello_no_name="שלום,",
        intro="מתקשרים בשם {hosts} לגבי ההזמנה {occasion}{when}.",
        intro_no_hosts="מתקשרים לגבי ההזמנה {occasion}{when}.",
        thanks_yes="[friendly] תודה, רשמנו את ההגעה. נתראה באירוע!",
        thanks_no="[friendly] תודה על העדכון, רשמנו שלא תגיעו. יום טוב.",
        thanks_maybe="[friendly] בסדר, נחזור אליכם קרוב יותר לאירוע. יום טוב.",
    ),
}

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

MENU_TEXT = "אם אתם מגיעים, הקישו אחת. אם לא תוכלו להגיע, הקישו שתיים. ואם עוד לא בטוחים, הקישו שלוש."
COUNT_TEXT = "כמה תהיו? הקישו את מספר המגיעים, כולל אתכם, ואז סולמית."
COUNT_INVALID_TEXT = "לא הצלחנו להבין. הקישו מספר בין אחת ל-{max}, ואז סולמית."
MENU_INVALID_TEXT = "לא הצלחנו להבין."
GOODBYE_TEXT = "לא קיבלנו תשובה. אפשר לעדכן אותנו גם בהודעה בוואטסאפ. יום טוב!"
# Occasions that read better with the honoree's name ("ליום ההולדת של מיכל").
_WITH_HONOREE = {EventType.BAR, EventType.BAT, EventType.BIRTHDAY, EventType.BRIT, EventType.BRITA}


def tone_key(event_type) -> str:
    et = event_type_of(event_type) or EventType.OTHER
    return _TONE_OF.get(et, "family")


def opening_text(event_type, guest_name: str, hosts: str, event_date=None, honoree: str = "") -> str:
    """The personal clip: greeting + who/what/when + the menu, as ONE utterance so
    the name flows naturally into the rest. Generated per guest (cached by text)."""
    et = event_type_of(event_type) or EventType.OTHER
    tone = _TONES[tone_key(et)]
    name = first_name(guest_name)
    hello = tone.hello.format(name=name) if name else tone.hello_no_name
    when = spoken_date(event_date)
    hosts = (hosts or "").strip()
    honoree = (honoree or "").strip()
    occasion = _OCCASION.get(et, "לאירוע")
    if et == EventType.WEDDING and not hosts:
        occasion = "לחתונה"
    if et in _WITH_HONOREE and honoree and honoree not in hosts:
        occasion = f"{occasion} של {honoree}"
    template = tone.intro if hosts else tone.intro_no_hosts
    intro = template.format(hosts=hosts, occasion=occasion, when=f" {when}" if when else "")
    return f"{tone.tag} {hello} {intro} {MENU_TEXT}"


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
                 + (' finishOnKey="#" timeout="4" numDigits="2"' if count else ' numDigits="1" timeout="6"'))
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
