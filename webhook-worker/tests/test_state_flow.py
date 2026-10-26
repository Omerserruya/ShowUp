"""State-machine routing for the readiness-review fixes (3.6, 3.9, 3.10, P2).

Pure routing (get_next_state) - sqlalchemy is stubbed like test_semantic_routing.
Standalone: `python3 webhook-worker/tests/test_state_flow.py`
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
_WORKER = os.path.dirname(_HERE)
_ROOT = os.path.dirname(_WORKER)
sys.path.insert(0, _WORKER)
sys.path.insert(0, _ROOT)

_sa = types.ModuleType("sqlalchemy"); _sa.text = lambda *a, **k: None
_ext = types.ModuleType("sqlalchemy.ext")
_aio = types.ModuleType("sqlalchemy.ext.asyncio"); _aio.AsyncSession = object
sys.modules.setdefault("sqlalchemy", _sa)
sys.modules.setdefault("sqlalchemy.ext", _ext)
sys.modules.setdefault("sqlalchemy.ext.asyncio", _aio)

from shared.domain.enums import RsvpAction  # noqa: E402
from shared.domain.rsvp import resolve_rsvp_action  # noqa: E402
from states.rsvp_invite import RsvpInviteState  # noqa: E402
from states.rsvp_count import RsvpCountState, RsvpCountRetryState  # noqa: E402
from states.rsvp_decline import RsvpDeclineState  # noqa: E402
from states.rsvp_maybe import RsvpMaybeState  # noqa: E402
from states.rsvp_done import RsvpDoneState  # noqa: E402
from states.rsvp_info_question import RsvpInfoQuestionState  # noqa: E402
from states.rsvp_update import RsvpUpdateState  # noqa: E402
from states.didnt_understand import DidntUnderstandState  # noqa: E402


class _FakeFlow:
    fallback_state_id = "didnt_understand"
    initial_state = "rsvp_invite"


_P = []
def check(name, cond):
    _P.append(bool(cond))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")


def nxt(state_cls, text="", **extra):
    msg = {"text": text, "action": resolve_rsvp_action(text=text, button_id=extra.get("button_id"),
                                                       button_payload=extra.get("button_payload"))}
    msg.update(extra)
    return state_cls(_FakeFlow()).get_next_state(msg)


print("== 3.10 party size 1..50 ==")
check("'3' -> info question", nxt(RsvpCountState, "3") == "rsvp_info_question")
check("'3 אנשים' -> info question", nxt(RsvpCountState, "3 אנשים") == "rsvp_info_question")
check("phone number -> friendly re-ask", nxt(RsvpCountState, "0501234567") == "rsvp_count_retry")
check("'0' -> re-ask", nxt(RsvpCountState, "0") == "rsvp_count_retry")
check("'51' -> re-ask", nxt(RsvpCountState, "51") == "rsvp_count_retry")
check("retry state accepts a valid number", nxt(RsvpCountRetryState, "2") == "rsvp_info_question")

print("== 3.6 maybe has its own state; decline/maybe accept a later yes ==")
check("invite MAYBE -> rsvp_maybe", nxt(RsvpInviteState, button_payload="rsvp_maybe") == "rsvp_maybe")
check("legacy maybe title -> rsvp_maybe", nxt(RsvpInviteState, "עוד מתלבט/ת, תחזרו אלי?") == "rsvp_maybe")
check("didnt_understand MAYBE -> rsvp_maybe", nxt(DidntUnderstandState, "אולי") == "rsvp_maybe")
check("maybe + confirm button -> count", nxt(RsvpMaybeState, "בסוף נוכל להגיע") == "rsvp_count")
check("maybe + typed 'באים' -> count", nxt(RsvpMaybeState, "באים!") == "rsvp_count")
check("maybe + decline button -> decline", nxt(RsvpMaybeState, "לצערי לא נוכל") == "rsvp_decline")
check("maybe + chatter stays", nxt(RsvpMaybeState, "תודה") == "rsvp_maybe")
check("decline + changed mind -> count", nxt(RsvpDeclineState, "בסוף נוכל להגיע") == "rsvp_count")
check("decline + typed 'בסוף באים' -> count", nxt(RsvpDeclineState, "בסוף באים") == "rsvp_count")
check("decline + chatter stays (no invite re-send)", nxt(RsvpDeclineState, "תודה") == "rsvp_decline")

print("== P2: completion states never fall through to re-sending the invite ==")
check("done + 'תודה' stays", nxt(RsvpDoneState, "תודה!") == "rsvp_done")
check("done + update button", nxt(RsvpDoneState, "לעדכן הגעה") == "rsvp_update")
check("info question + chatter re-asks", nxt(RsvpInfoQuestionState, "?") == "rsvp_info_question")
check("update + chatter re-asks", nxt(RsvpUpdateState, "?") == "rsvp_update")

print("== 3.9 rsvp_done no longer writes a status ==")
check("RsvpDoneState does not override process_incoming",
      "process_incoming" not in RsvpDoneState.__dict__)

passed = sum(_P)
print(f"\nRESULT: {passed}/{len(_P)} checks passed")
sys.exit(0 if passed == len(_P) else 1)
