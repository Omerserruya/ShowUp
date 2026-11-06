from typing import Any, Dict
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from shared.domain.flow_config import is_no_note_reply, is_wants_note_reply
from states.base_state import BaseState

logger = logging.getLogger(__name__)

# Guest-written notes are APPENDED under this prefix - guests.notes is also the
# owner's own field, and overwriting it erased what the owner had typed.
GUEST_NOTE_PREFIX = "הערת אורח (וואטסאפ): "
GUEST_NOTE_MAX = 500
NOTES_TOTAL_MAX = 4000


class NoteInfoState(BaseState):
    """The guest asked to write a note: whatever they type is the note, then
    note_saved echoes it back. "Nothing" ("אין", "לא תודה", an emoji) and an
    empty message end the conversation instead."""
    id = "note_info"
    next_states = {
        "*": "rsvp_done",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        await super().process_incoming(session, message, conversation)
        await save_note_reply(self, session, message, conversation)

    def get_next_state(self, message: Dict[str, Any]) -> str:
        return note_reply_next(message, "rsvp_done")

    async def _append_note(self, session: AsyncSession, conversation: Any, note: str) -> None:
        from sqlalchemy import text as _t
        from shared.domain.delivery import canonical_phone_digits, canonical_phone_sql
        from utils.phone import normalize_phone

        expr = (
            "LEFT(CASE WHEN notes IS NULL OR btrim(notes) = '' THEN :note "
            "ELSE notes || E'\\n' || :note END, :cap)"
        )
        rows = 0
        if conversation.guest_id:
            res = await session.execute(
                _t(f"UPDATE guests SET notes = {expr} WHERE id = CAST(:gid AS uuid)"),
                {"note": note, "cap": NOTES_TOTAL_MAX, "gid": str(conversation.guest_id)},
            )
            rows = res.rowcount or 0
        if not rows:
            phone = canonical_phone_digits(normalize_phone(conversation.guest_phone))
            if phone and conversation.event_id:
                res = await session.execute(
                    _t(
                        f"UPDATE guests SET notes = {expr} "
                        f"WHERE CAST(event_id AS text) = :eid AND {canonical_phone_sql('phone')} = :phone"
                    ),
                    {"note": note, "cap": NOTES_TOTAL_MAX, "eid": str(conversation.event_id), "phone": phone},
                )
                rows = res.rowcount or 0
        await session.commit()
        logger.info("Guest note appended (rows=%d, len=%d)", rows, len(note))

    async def send(self, session: AsyncSession, conversation: Any) -> Dict[str, Any]:
        return await self.build_text(
            session, conversation,
            await self.cfg_text(session, conversation, "after_confirm.ask_notes.note_prompt_text"),
        )


def is_note(message: Dict[str, Any], *, asked: bool = False) -> bool:
    """`asked`: the reply answers "anything we should know?" - a bare "כן"/"יש"
    there means "yes, let me write it", not the note itself."""
    t = message.get("text")
    return not is_no_note_reply(t) and not (asked and is_wants_note_reply(t))


async def save_note_reply(state: BaseState, session: AsyncSession, message: Dict[str, Any], conversation: Any,
                          *, asked: bool = False) -> None:
    """Append the guest's typed reply to guests.notes (no status write: attending
    was recorded in rsvp_count - see rsvp_done for why later states must not
    re-write it) and keep it on the conversation for note_saved's echo."""
    if not is_note(message, asked=asked):
        return
    text_content = (message.get("text") or "").strip()
    await NoteInfoState._append_note(state, session, conversation, GUEST_NOTE_PREFIX + text_content[:GUEST_NOTE_MAX])
    conversation.last_note = text_content


def note_reply_next(message: Dict[str, Any], otherwise: str, *, asked: bool = False) -> str:
    if asked and is_wants_note_reply(message.get("text")):
        return "note_info"
    return "note_saved" if is_note(message, asked=asked) else otherwise
