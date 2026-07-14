"""Conversation engine consumes SEMANTIC actions, not button text.

The state machine routes on the resolved RsvpAction; the displayed label is only a
last-resort legacy fallback. This locks:
  * semantic routing wins over (even contradictory) text
  * legacy title text still routes when no action is present (backward compatible)
  * states without a semantic map are unaffected

`sqlalchemy` is a container-only dependency; get_next_state is pure, so we stub it.
Standalone: `python3 webhook-worker/tests/test_semantic_routing.py`
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
_WORKER = os.path.dirname(_HERE)
_ROOT = os.path.dirname(_WORKER)
sys.path.insert(0, _WORKER)
sys.path.insert(0, _ROOT)

# Stub sqlalchemy (Docker-only dep). get_next_state never touches the DB.
_sa = types.ModuleType("sqlalchemy"); _sa.text = lambda *a, **k: None
_ext = types.ModuleType("sqlalchemy.ext")
_aio = types.ModuleType("sqlalchemy.ext.asyncio"); _aio.AsyncSession = object
sys.modules.setdefault("sqlalchemy", _sa)
sys.modules.setdefault("sqlalchemy.ext", _ext)
sys.modules.setdefault("sqlalchemy.ext.asyncio", _aio)

from states.rsvp_invite import RsvpInviteState  # noqa: E402
from states.base_state import BaseState  # noqa: E402
from shared.domain.enums import RsvpAction  # noqa: E402


class _FakeFlow:
    fallback_state_id = "didnt_understand"
    initial_state = "rsvp_invite"


_P = []
def check(name, cond):
    _P.append(bool(cond))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")


invite = RsvpInviteState(_FakeFlow())
def route(**msg):
    return invite.get_next_state(msg)

print("== semantic routing (label-independent) ==")
check("CONFIRMED -> rsvp_count", route(action=RsvpAction.CONFIRMED) == "rsvp_count")
check("CONFIRMED wins over contradictory/garbage text",
      route(action=RsvpAction.CONFIRMED, text="???anything???") == "rsvp_count")
check("DECLINED -> rsvp_decline", route(action=RsvpAction.DECLINED) == "rsvp_decline")
check("MAYBE -> rsvp_decline", route(action=RsvpAction.MAYBE) == "rsvp_decline")

print("== legacy text is a LAST-RESORT fallback (backward compatible) ==")
check("UNKNOWN action falls back to legacy title text",
      route(action=RsvpAction.UNKNOWN, text="ברור שאני בא!") == "rsvp_count")
check("no action key at all still routes by text",
      route(text="ברור שאני בא!") == "rsvp_count")
check("unknown text -> wildcard didnt_understand", route(text="blah") == "didnt_understand")

print("== a state without a semantic map is unaffected ==")
class _Plain(BaseState):
    id = "plain"
    next_states = {"hi": "there", "*": "fb"}
check("plain state ignores action, routes by text",
      _Plain(_FakeFlow()).get_next_state({"action": RsvpAction.CONFIRMED, "text": "hi"}) == "there")

passed = sum(_P)
print(f"\nRESULT: {passed}/{len(_P)} checks passed")
sys.exit(0 if passed == len(_P) else 1)
