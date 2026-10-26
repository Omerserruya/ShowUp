"""Host-defined questions for guests ("שאלות לאורחים", e.g. shuttle).

After the guest confirms and gives a party size, the bot asks every event
question (event_field_defs.ask_in_rsvp = true, data_type 'enum') the guest has
not answered yet, ordered by sort_order, then continues to rsvp_info_question.

* <= 3 options -> reply buttons, 4..10 -> an interactive list. Every choice id
  is `qans__<field_id>__<option index>`; flow_manager handles that prefix BEFORE
  the RSVP resolver, so an answer like "לא, תודה" can never change the RSVP.
* Free text while a question is pending: matched against the option labels
  (normalized). No match -> re-ask once (question_answer_retry), then skip.
* A skipped question is stored as a NULL value, so it is not asked again and
  reads as "unanswered" in the host's results.

Only guests who confirm from now on are asked: reaching guests who confirmed
earlier needs a Meta-approved template (we are outside their 24h window).
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState

logger = logging.getLogger(__name__)

QANS_PREFIX = "qans__"
QUESTION_STATES = ("question_answer", "question_answer_retry")
MAX_BUTTON_OPTIONS = 3
MAX_OPTIONS = 10
BUTTON_TITLE_MAX = 20   # Meta: reply-button title
ROW_TITLE_MAX = 24      # Meta: list-row title



# ---------------------------------------------------------------------------
# Pure helpers (unit-tested without a DB)
# ---------------------------------------------------------------------------

def make_answer_id(field_id: Any, index: int) -> str:
    return f"{QANS_PREFIX}{field_id}__{index}"


def parse_answer_id(button_id: Optional[str]) -> Optional[Tuple[str, int]]:
    """`qans__<field_id>__<idx>` -> (field_id, idx); None if malformed."""
    if not button_id or not str(button_id).startswith(QANS_PREFIX):
        return None
    rest = str(button_id)[len(QANS_PREFIX):]
    field_id, sep, idx = rest.rpartition("__")
    if not sep or not field_id:
        return None
    try:
        return field_id, int(idx)
    except ValueError:
        return None


# Option matching lives in shared/domain/flow_graph.py (one implementation for
# this legacy state and the flow-graph interpreter / admin simulator).
from shared.domain.flow_graph import match_option, normalize_answer  # noqa: E402,F401


def build_question_interactive(field_id: Any, label: str, options: List[str], *, prefix: str = "") -> Dict[str, Any]:
    """WhatsApp interactive body: buttons for <=3 options, a list for 4..10."""
    body = f"{prefix}{label}".strip()
    opts = list(options or [])[:MAX_OPTIONS]
    if len(opts) <= MAX_BUTTON_OPTIONS:
        return {
            "type": "button",
            "body": {"text": body},
            "action": {"buttons": [
                {"type": "reply", "reply": {"id": make_answer_id(field_id, i), "title": str(o)[:BUTTON_TITLE_MAX]}}
                for i, o in enumerate(opts)
            ]},
        }
    return {
        "type": "list",
        "body": {"text": body},
        "action": {
            "button": "בחירת תשובה",
            "sections": [{
                "title": "אפשרויות",
                "rows": [
                    {"id": make_answer_id(field_id, i), "title": str(o)[:ROW_TITLE_MAX]}
                    for i, o in enumerate(opts)
                ],
            }],
        },
    }


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

async def resolve_guest_id(session: AsyncSession, conversation: Any) -> Optional[str]:
    gid = getattr(conversation, "guest_id", None)
    if gid:
        return str(gid)
    from shared.domain.delivery import canonical_phone_digits, canonical_phone_sql
    from utils.phone import normalize_phone
    phone = canonical_phone_digits(normalize_phone(getattr(conversation, "guest_phone", None)))
    event_id = str(getattr(conversation, "event_id", "") or "")
    if not phone or not event_id:
        return None
    res = await session.execute(
        text(
            "SELECT id::text FROM guests WHERE CAST(event_id AS text) = :eid "
            f"AND {canonical_phone_sql('phone')} = :phone LIMIT 1"
        ),
        {"eid": event_id, "phone": phone},
    )
    row = res.first()
    return row[0] if row else None


def _options(raw: Any) -> List[str]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return []
    return [str(o) for o in raw] if isinstance(raw, list) else []


async def fetch_pending_question(session: AsyncSession, conversation: Any) -> Optional[Dict[str, Any]]:
    """The next ask_in_rsvp question this guest has no stored row for."""
    guest_id = await resolve_guest_id(session, conversation)
    if not guest_id:
        return None
    try:
        res = await session.execute(
            text(
                """
                SELECT f.id::text, f.label, f.options
                FROM event_field_defs f
                WHERE CAST(f.event_id AS text) = :eid
                  AND f.ask_in_rsvp = TRUE
                  AND f.data_type = 'enum'
                  AND NOT EXISTS (
                      SELECT 1 FROM guest_custom_values v
                      WHERE v.field_def_id = f.id AND v.guest_id = CAST(:gid AS uuid)
                  )
                ORDER BY f.sort_order, f.created_at
                """
            ),
            {"eid": str(conversation.event_id), "gid": guest_id},
        )
    except Exception as exc:  # column not migrated yet etc. -> never block the RSVP
        logger.warning("Question lookup failed, skipping questions: %s", exc)
        await session.rollback()
        return None
    for fid, label, options in res.all():
        opts = _options(options)
        if len(opts) >= 2:
            return {"id": fid, "label": label, "options": opts[:MAX_OPTIONS], "guest_id": guest_id}
    return None


async def fetch_field(session: AsyncSession, field_id: str) -> Optional[Dict[str, Any]]:
    try:
        res = await session.execute(
            text("SELECT id::text, event_id::text, label, options FROM event_field_defs WHERE id = CAST(:fid AS uuid)"),
            {"fid": field_id},
        )
    except Exception:
        await session.rollback()
        return None
    row = res.first()
    if not row:
        return None
    return {"id": row[0], "event_id": row[1], "label": row[2], "options": _options(row[3])}


async def store_answer(session: AsyncSession, guest_id: str, field_id: str, value: Optional[str]) -> None:
    """Upsert on uq_value_guest_field. value None = skipped."""
    await session.execute(
        text(
            """
            INSERT INTO guest_custom_values (id, guest_id, field_def_id, value)
            VALUES (gen_random_uuid(), CAST(:gid AS uuid), CAST(:fid AS uuid), CAST(:v AS json))
            ON CONFLICT (guest_id, field_def_id) DO UPDATE SET value = EXCLUDED.value
            """
        ),
        {"gid": guest_id, "fid": field_id, "v": json.dumps(value, ensure_ascii=False) if value is not None else None},
    )
    await session.commit()
    logger.info("Guest question answered (field=%s, skipped=%s)", field_id, value is None)


# ---------------------------------------------------------------------------
# States
# ---------------------------------------------------------------------------

class QuestionAnswerState(BaseState):
    """Waiting for the guest's answer to the pending host question."""
    id = "question_answer"
    ask_prefix = "עוד שאלה קטנה ונסיים 🙂\n\n"

    def __init__(self, flow: Any):
        super().__init__(flow)
        self._outcome = "none"

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        await super().process_incoming(session, message, conversation)
        pending = await fetch_pending_question(session, conversation)
        if not pending:
            self._outcome = "none"
            return
        idx: Optional[int] = None
        parsed = parse_answer_id(message.get("button_id"))
        if parsed and parsed[0] == pending["id"] and 0 <= parsed[1] < len(pending["options"]):
            idx = parsed[1]
        if idx is None:
            idx = match_option(message.get("text"), pending["options"])
        if idx is not None:
            await store_answer(session, pending["guest_id"], pending["id"], pending["options"][idx])
            self._outcome = "answered"
        elif self.id == "question_answer_retry":
            await store_answer(session, pending["guest_id"], pending["id"], None)
            self._outcome = "skipped"
        else:
            self._outcome = "retry"

    def get_next_state(self, message: Dict[str, Any]) -> str:
        if self._outcome == "retry":
            return "question_answer_retry"
        # flow_manager's question gate turns this into rsvp_info_question when
        # nothing is left to ask.
        return "question_answer"

    async def send(self, session: AsyncSession, conversation: Any) -> Optional[Dict[str, Any]]:
        pending = await fetch_pending_question(session, conversation)
        if not pending:
            return None
        return {
            "platform": "WA",
            "recipient": conversation.guest_phone,
            "message_type": "interactive",
            "interactive": build_question_interactive(
                pending["id"], pending["label"], pending["options"], prefix=self.ask_prefix),
            "event_id": str(conversation.event_id),
            "state": self.id,
            "source": "webhook_worker",
        }


class QuestionAnswerRetryState(QuestionAnswerState):
    """Second (last) try; an unmatched reply now skips the question."""
    id = "question_answer_retry"
    ask_prefix = "לא הצלחנו להבין את התשובה 😅 אפשר לבחור באחת האפשרויות:\n\n"
