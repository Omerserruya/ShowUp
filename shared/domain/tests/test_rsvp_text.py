"""Free-text RSVP understanding + opt-out vocabulary + delivery ladder.

Locks the readiness-review 3.7 / 2.6 fixes:
  * whole-token matching ("בא" never fires inside "הבא"/"הבאה")
  * negated coming-verbs ("לא באים", "לא נבוא", ...) are DECLINED
  * "ביטול" is an RSVP decline, NOT an opt-out
  * only unambiguous removal requests opt a guest out
  * a Meta 'failed' receipt overrides 'accepted' but never 'delivered'/'read'

Pure python. Run: `python3 shared/domain/tests/test_rsvp_text.py` or pytest.
"""
import os
import sys

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, _ROOT)

from shared.domain.enums import RsvpAction  # noqa: E402
from shared.domain.rsvp import (  # noqa: E402
    GUEST_COUNT_MAX, is_valid_guest_count, parse_guest_count, resolve_rsvp_action, tokenize_reply,
)
from shared.domain.optout import is_opt_in_text, is_opt_out_text  # noqa: E402
from shared.domain.delivery import (  # noqa: E402
    can_transition, canonical_phone_digits, status_rank_sql,
)

C, D, M, U = RsvpAction.CONFIRMED, RsvpAction.DECLINED, RsvpAction.MAYBE, RsvpAction.UNKNOWN

TEXT_CASES = [
    # the review's cases
    ("לא באים", D),
    ("נעדכן בשבוע הבא", U),
    ("באים!", C),
    ("אולי נבוא", M),
    ("כן", C),
    ("לא", D),
    ("ביטול", D),
    # negations
    ("לא בא", D), ("לא באה", D), ("לא נבוא", D), ("לא אבוא", D), ("לא נגיע", D),
    ("אנחנו לא באים", D), ("לצערי לא נוכל להגיע 😢", D), ("לא תודה", D),
    ("כנראה שלא נגיע", D),
    # "בא" only as a whole token
    ("הבאה", U), ("בפעם הבאה", U), ("נדבר בשבוע הבא", U), ("בא", C), ("באה", C),
    # niqqud / emoji / punctuation
    ("בָּאִים", C), ("מגיעים 🎉🎉", C), ("כן!!!", C), ("  אגיע.  ", C),
    # maybe beats confirm, decline beats confirm
    ("אולי אגיע", M), ("לא בטוח שנגיע", M), ("לא יודעת עדיין", M), ("לא אגיע", D),
    # long chatter is not an RSVP
    ("שלום, רציתי לשאול אם יש חניה ליד האולם ואם אפשר להגיע עם עגלה של תינוק", U),
    ("תודה רבה", U),
]


def test_text_actions():
    bad = [(t, exp, resolve_rsvp_action(text=t)) for t, exp in TEXT_CASES if resolve_rsvp_action(text=t) != exp]
    assert not bad, bad


def test_tokenize():
    assert tokenize_reply("בָּאִים!! 🎉") == ["באים"]
    assert tokenize_reply("can't make it") == ["cant", "make", "it"]


def test_button_payload_still_wins():
    assert resolve_rsvp_action(button_payload="rsvp_declined", text="באים") == D
    assert resolve_rsvp_action(button_payload="RSVP_MAYBE") == M


def test_guest_count():
    assert parse_guest_count("3") == 3
    assert parse_guest_count("-1") is None      # pilot: "-1" was read as 1
    assert parse_guest_count("3 אנשים") == 3
    assert parse_guest_count("אנחנו 4") == 4
    assert parse_guest_count("שניים") == 2
    assert parse_guest_count("רק אני") == 1
    assert parse_guest_count("2 או 3") is None
    assert parse_guest_count("המון") is None
    # a pasted phone number parses but is rejected by the range check
    n = parse_guest_count("0501234567")
    assert n is not None and not is_valid_guest_count(n)
    assert not is_valid_guest_count(0)
    assert is_valid_guest_count(GUEST_COUNT_MAX) and not is_valid_guest_count(GUEST_COUNT_MAX + 1)


def test_optout_vocabulary():
    for t in ("STOP", "stop!", "הסר", "הסירו אותי", "תסירו אותי 🙏", "אל תשלחו לי", "unsubscribe"):
        assert is_opt_out_text(t), t
    # ambiguous RSVP words are NOT opt-outs any more
    for t in ("ביטול", "די", "cancel", "end", "לא מעוניין", "לא מעוניינת", "stop asking me"):
        assert not is_opt_out_text(t), t
    assert is_opt_in_text("התחל")


def test_delivery_ladder():
    assert can_transition("accepted", "failed")
    assert not can_transition("delivered", "failed")
    assert not can_transition("read", "failed")
    assert not can_transition("read", "delivered")
    assert can_transition("queued", "accepted")
    assert "WHEN 'failed' THEN 2" in status_rank_sql()


def test_canonical_phone():
    assert canonical_phone_digits("0501234567") == "972501234567"
    assert canonical_phone_digits("+972 50-123-4567") == "972501234567"
    assert canonical_phone_digits("972501234567") == "972501234567"
    assert canonical_phone_digits("00447700900123") == "447700900123"
    # a foreign number sharing the last 9 digits is NOT the same person
    assert canonical_phone_digits("+1 501234567") != canonical_phone_digits("0501234567")


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  [PASS] {name}")
            except AssertionError as e:
                failures += 1
                print(f"  [FAIL] {name}: {e}")
    print("RESULT:", "OK" if not failures else f"{failures} failed")
    sys.exit(1 if failures else 0)


def test_host_name_falls_back_to_the_couple_when_no_inviters():
    from shared.domain.messaging.resolver import VariableResolver
    v = VariableResolver({"inviters": [], "subjects": {"p1": "שני", "p2": "עומר"}}, media_base="", public_base="")
    assert v._event_values["host_name"] == "שני ועומר"
    typed = VariableResolver({"inviters": [{"fn": "נועה", "ln": "כהן"}], "subjects": {"p1": "שני", "p2": "עומר"}},
                             media_base="", public_base="")
    assert typed._event_values["host_name"] == "נועה כהן"     # typed inviters still win
