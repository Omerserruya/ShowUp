"""Guest opt-out (STOP / UNSUBSCRIBE) - detection, suppression, and audit.

WhatsApp Business policy requires honouring an opt-out, and Meta factors
opt-out-after-message signals into the WABA quality rating. Before this module
the codebase had no concept of it at all: a guest who replied STOP kept
receiving every subsequent round.

Two halves, deliberately in one place:

* `is_opt_out_text` / `is_opt_in_text` - the recognition vocabulary, applied by
  webhook-worker when an inbound free-text message arrives.
* `OPT_OUT_SQL_PREDICATE` / the ORM equivalent - the suppression rule, applied by
  BOTH audience implementations (campaign-worker's raw SQL and core's ORM). The
  rule lives here so the two can never drift; the fix is worthless if only one
  of the two send paths honours it.

Opting out never deletes anything. `guests.opted_out_at` is set and the guest
timeline records who/why, so the history survives and an owner can re-enable a
guest who asks to be added back.
"""
from __future__ import annotations

from typing import Optional

# Latin and Hebrew stop words. Matched on the WHOLE normalized message: a guest
# writing "stop asking me to bring a plus one" is making conversation, not
# opting out, and silently suppressing them would lose a real RSVP.
#
# Only UNAMBIGUOUS removal requests belong here. Words that are also natural RSVP
# answers ("ביטול", "די", "cancel", "end", "לא מעוניין/ת") were removed: a guest
# answering an invitation with "ביטול" means "we're not coming" (it is resolved
# as a DECLINE by shared/domain/rsvp.py), and treating it as an opt-out silently
# suppressed them while their RSVP stayed "confirmed".
_OPT_OUT_WORDS = {
    # English / international (Meta's documented conventions)
    "stop", "unsubscribe", "stopall", "quit", "optout", "opt out", "opt-out",
    # Hebrew
    "הסר", "הסרה", "הסר אותי", "הסירו אותי", "תסירו אותי", "תסיר אותי",
    "הסירו אותי מהרשימה", "הסר אותי מהרשימה", "תסירו אותי מהרשימה",
    "אל תשלחו", "אל תשלחו לי", "אל תשלחו לי הודעות", "תפסיקו לשלוח", "תפסיקו לשלוח לי",
    "הפסיקו לשלוח", "הפסיקו לשלוח לי", "תפסיקו", "הפסיקו",
}

_OPT_IN_WORDS = {
    "start", "unstop", "subscribe", "resume", "optin", "opt in",
    "התחל", "הצטרף", "חדש", "כן שלחו", "אפשר לשלוח",
}


_NIQQUD = "".join(chr(c) for c in range(0x0591, 0x05C8))


def _normalize(text: Optional[str]) -> str:
    """Lowercase, trim, drop niqqud and surrounding punctuation/emoji noise, and
    collapse inner whitespace, so "STOP!", " stop. " and "הסירו  אותי 🙏" match."""
    if not text:
        return ""
    cleaned = "".join(ch for ch in str(text) if ch not in _NIQQUD).strip().lower()
    # Strip leading/trailing characters that are not letters/digits (punctuation,
    # emoji, quotes) so a trailing "!" or "🙏" does not defeat the match.
    start, end = 0, len(cleaned)
    while start < end and not cleaned[start].isalnum():
        start += 1
    while end > start and not cleaned[end - 1].isalnum():
        end -= 1
    return " ".join(cleaned[start:end].split())


def is_opt_out_text(text: Optional[str]) -> bool:
    """True when an inbound message is an unambiguous opt-out request."""
    return _normalize(text) in _OPT_OUT_WORDS


def is_opt_in_text(text: Optional[str]) -> bool:
    """True when a previously opted-out guest asks to resume messages."""
    return _normalize(text) in _OPT_IN_WORDS


# Suppression rule, for raw-SQL audience queries. `g` is the guests alias.
# NULL means "never opted out" - the overwhelmingly common case - so this stays
# index-friendly and defaults to sending.
OPT_OUT_SQL_PREDICATE = "g.opted_out_at IS NULL"


# Idempotent DDL. Nullable columns only, so existing guests are subscribed by
# default and nothing is retroactively suppressed.
ENSURE_GUEST_OPTOUT_DDL = (
    "ALTER TABLE guests ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ",
    "ALTER TABLE guests ADD COLUMN IF NOT EXISTS opted_out_reason TEXT",
    "ALTER TABLE guests ADD COLUMN IF NOT EXISTS opted_out_source VARCHAR(30)",
    "CREATE INDEX IF NOT EXISTS ix_guests_opted_out_at ON guests (opted_out_at)",
)


def ensure_guest_optout_schema(cursor) -> None:
    """Apply the opt-out DDL with an open DB-API cursor. Safe to re-run."""
    for stmt in ENSURE_GUEST_OPTOUT_DDL:
        cursor.execute(stmt)
