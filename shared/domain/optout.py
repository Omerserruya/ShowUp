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
_OPT_OUT_WORDS = {
    # English / international (Meta's documented conventions)
    "stop", "unsubscribe", "cancel", "end", "quit", "stopall", "optout", "opt out",
    # Hebrew
    "הסר", "הסרה", "הפסק", "הפסיקו", "תפסיקו", "הסר אותי", "הסירו אותי",
    "לא מעוניין", "לא מעוניינת", "ביטול", "תסירו אותי", "אל תשלחו", "אל תשלחו לי",
    "די", "עצור",
}

_OPT_IN_WORDS = {
    "start", "unstop", "subscribe", "resume", "optin", "opt in",
    "התחל", "הצטרף", "חדש", "כן שלחו", "אפשר לשלוח",
}


def _normalize(text: Optional[str]) -> str:
    """Lowercase, trim, and drop trailing punctuation/emoji-ish noise."""
    if not text:
        return ""
    cleaned = str(text).strip().lower()
    # Strip common trailing punctuation so "STOP!" and "stop." both match.
    return cleaned.strip(" \t\r\n.!?,;:־-־\"'()[]")


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
