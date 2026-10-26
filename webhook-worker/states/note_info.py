from typing import Any, Dict
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from states.base_state import BaseState

logger = logging.getLogger(__name__)

# Guest-written notes are APPENDED under this prefix - guests.notes is also the
# owner's own field, and overwriting it erased what the owner had typed.
GUEST_NOTE_PREFIX = "הערת אורח (וואטסאפ): "
GUEST_NOTE_MAX = 500
NOTES_TOTAL_MAX = 4000


class NoteInfoState(BaseState):
    id = "note_info"
    next_states = {
        "*": "rsvp_done",
    }

    async def process_incoming(self, session: AsyncSession, message: Dict[str, Any], conversation: Any) -> None:
        await super().process_incoming(session, message, conversation)
        text_content = (message.get("text") or "").strip()
        if not text_content:
            return
        note = GUEST_NOTE_PREFIX + text_content[:GUEST_NOTE_MAX]
        # Append; no status write (attending was recorded in rsvp_count - see
        # rsvp_done for why later states must not re-write it).
        await self._append_note(session, conversation, note)

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
