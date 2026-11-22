"""How the bot reads a guest's reply depends on the round it answers.

An invitation / RSVP reminder asks "are you coming?", so its replies run the
RSVP flow (conversation state `rsvp_invite`). Every other round - save the date,
the logistics reminder before the event, table assignment, the thank-you - asks
nothing. Before this, those rounds left the conversation in whatever RSVP step it
was in, so a guest writing "תודה" or "היה מושלם" after the thank-you got "how many
will you be?" or "noted, thanks!" (pilot event, 2-4.11.26).

Now such a round moves the conversation to `stage_<stage>` (campaign-worker sets
the message's log_state, outpost moves the conversation). webhook-worker answers
there with that stage's own short reply (flow config `stage_reply.<stage>.text`)
once, keeps the guest's words as a note for the hosts, and stays quiet after
(`stage_<stage>_acked`). A clearly typed RSVP change before the event ("בסוף לא
נוכל להגיע") still updates the answer through the RSVP flow.
"""
from __future__ import annotations

from typing import Any, Optional

STAGE_PREFIX = "stage_"
ACKED_SUFFIX = "_acked"

# Stages whose rounds ask the guest for an RSVP.
RSVP_ASKING_STAGES = ("invitation", "reminder")
# Rounds after the event: a reply is never an RSVP.
POST_EVENT_STAGES = ("thank_you",)


def _value(x: Any) -> str:
    return str(getattr(x, "value", x) or "")


def log_state_for(stage: Any, template: Any = None) -> Optional[str]:
    """Conversation state for a round's message, or None (keep the current one).

    invitation / reminder -> rsvp_invite (unchanged behaviour). A final reminder
    asks for an RSVP only when the template sent has RSVP buttons; the logistics
    one ("see you tomorrow", Waze) does not. Anything else -> stage_<stage>.
    """
    s = _value(stage)
    if not s:
        return None
    if s in RSVP_ASKING_STAGES:
        return "rsvp_invite"
    if s == "final_reminder" and (template is None or _value(getattr(template, "cta_type", "")) == "rsvp"):
        return "rsvp_invite"
    return STAGE_PREFIX + s


def is_stage_state(state: Optional[str]) -> bool:
    return bool(state) and str(state).startswith(STAGE_PREFIX)


def stage_of(state: str) -> str:
    s = str(state)[len(STAGE_PREFIX):]
    return s[: -len(ACKED_SUFFIX)] if s.endswith(ACKED_SUFFIX) else s


def is_acked(state: str) -> bool:
    return str(state).endswith(ACKED_SUFFIX)


def acked_state(stage: str) -> str:
    return f"{STAGE_PREFIX}{stage}{ACKED_SUFFIX}"
