"""Host questions ("שאלות לאורחים") - pure helpers + state routing.

sqlalchemy is stubbed like the other routing tests (no DB here; the DB flow is
covered by test_guest_questions_db.py, which needs Postgres).
Standalone: `python3 webhook-worker/tests/test_guest_questions.py`
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
_WORKER = os.path.dirname(_HERE)
_ROOT = os.path.dirname(_WORKER)
sys.path.insert(0, _WORKER)
sys.path.insert(0, _ROOT)

try:  # real sqlalchemy inside the container; stub it on a bare host
    import sqlalchemy  # noqa: F401
    import sqlalchemy.ext.asyncio  # noqa: F401
except Exception:
    _sa = types.ModuleType("sqlalchemy"); _sa.text = lambda *a, **k: None
    _ext = types.ModuleType("sqlalchemy.ext")
    _aio = types.ModuleType("sqlalchemy.ext.asyncio"); _aio.AsyncSession = object
    sys.modules["sqlalchemy"] = _sa
    sys.modules["sqlalchemy.ext"] = _ext
    sys.modules["sqlalchemy.ext.asyncio"] = _aio

from states.question_answer import (  # noqa: E402
    QANS_PREFIX, QuestionAnswerState, QuestionAnswerRetryState,
    build_question_interactive, make_answer_id, match_option, parse_answer_id,
)


class _FakeFlow:
    fallback_state_id = "didnt_understand"
    initial_state = "rsvp_invite"


_P = []
def check(name, cond):
    _P.append(bool(cond))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")


FID = "11111111-2222-3333-4444-555555555555"
SHUTTLE = ["כן, אשמח", "לא, תודה"]
CITIES = ["תל אביב", "ירושלים", "חיפה", "באר שבע", "לא צריך הסעה"]

print("== answer ids ==")
aid = make_answer_id(FID, 1)
check("id has the qans__ prefix", aid.startswith(QANS_PREFIX))
check("id round-trips", parse_answer_id(aid) == (FID, 1))
check("malformed id -> None", parse_answer_id("qans__nope") is None)
check("foreign id -> None", parse_answer_id("evsel__abc") is None)

print("== buttons (<=3) vs list (4..10) ==")
b = build_question_interactive(FID, "צריכים הסעה לאירוע?", SHUTTLE)
check("2 options -> reply buttons", b["type"] == "button" and len(b["action"]["buttons"]) == 2)
check("button ids carry field + index",
      [x["reply"]["id"] for x in b["action"]["buttons"]] == [make_answer_id(FID, 0), make_answer_id(FID, 1)])
check("question text = label", b["body"]["text"] == "צריכים הסעה לאירוע?")
b3 = build_question_interactive(FID, "q", ["א", "ב", "ג"])
check("3 options -> still buttons", b3["type"] == "button")
lst = build_question_interactive(FID, "מאיזו עיר?", CITIES)
rows = lst["action"]["sections"][0]["rows"]
check("5 options -> list", lst["type"] == "list" and len(rows) == 5)
check("list row ids", rows[4]["id"] == make_answer_id(FID, 4))
check("list button label <= 20", len(lst["action"]["button"]) <= 20)
long = build_question_interactive(FID, "q", ["x" * 30, "y" * 30])
check("button title clipped to 20", all(len(x["reply"]["title"]) <= 20 for x in long["action"]["buttons"]))
lst_long = build_question_interactive(FID, "q", ["z" * 30] * 4)
check("row title clipped to 24", all(len(r["title"]) <= 24 for r in lst_long["action"]["sections"][0]["rows"]))
check("more than 10 options are capped",
      len(build_question_interactive(FID, "q", [str(i) for i in range(12)])["action"]["sections"][0]["rows"]) == 10)

print("== free-text matching ==")
check("exact label", match_option("לא, תודה", SHUTTLE) == 1)
check("punctuation/spacing ignored", match_option("  לא תודה!! ", SHUTTLE) == 1)
check("unique prefix 'כן'", match_option("כן", SHUTTLE) == 0)
check("unique prefix 'לא'", match_option("לא", SHUTTLE) == 1)
check("option number", match_option("2", CITIES) == 1)
check("out-of-range number -> None", match_option("9", CITIES) is None)
check("label inside a sentence", match_option("מירושלים בבקשה, ירושלים", CITIES) == 1)
check("unrelated text -> None", match_option("מה השעה?", SHUTTLE) is None)
check("ambiguous prefix -> None", match_option("כן", ["כן, מתל אביב", "כן, מחיפה", "לא"]) is None)
check("empty -> None", match_option("", SHUTTLE) is None)

print("== state routing ==")
s = QuestionAnswerState(_FakeFlow())
s._outcome = "retry"
check("unmatched first try -> retry state", s.get_next_state({}) == "question_answer_retry")
s._outcome = "answered"
check("answered -> question gate", s.get_next_state({}) == "question_answer")
r = QuestionAnswerRetryState(_FakeFlow())
r._outcome = "skipped"
check("retry skipped -> question gate (never loops)", r.get_next_state({}) == "question_answer")

passed = sum(_P)
print(f"\nRESULT: {passed}/{len(_P)} checks passed")
sys.exit(0 if passed == len(_P) else 1)
