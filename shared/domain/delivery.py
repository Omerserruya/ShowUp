"""Per-message delivery state - the SSOT for "did this message actually send?".

Before this module, reaching RabbitMQ counted as "sent": campaign-worker marked
`messages_sent` and set the campaign to 'sent' the moment it enqueued, while
outpost-service caught Meta's rejection, logged it, and acked the AMQP message.
A 300-guest round could deliver zero messages and report success, and nobody -
owner, admin, or the system - could tell the difference.

`messages_sent` now carries the delivery lifecycle instead of merely recording
that an attempt happened. It stays the same table that already provided
send-once semantics, so there is exactly one row per (campaign, guest) and one
place to ask what happened to it.

Lifecycle:

    QUEUED    claimed by campaign-worker and published to outpost.
    ACCEPTED  Meta accepted the message and returned a wamid. This - not
              enqueue - is what "sent" means.
    DELIVERED Meta delivery receipt received (webhook).
    READ      Meta read receipt received (webhook).
    FAILED    Meta rejected it, or the send raised, or Meta ACCEPTED it and
              later reported it undeliverable (status webhook). `error_code` /
              `error_detail` say why. Never silently discarded.

Receipts only move a message forward along QUEUED < ACCEPTED < FAILED <
DELIVERED < READ (see `status_rank`): a late 'failed' overrides 'accepted',
never 'delivered'/'read'.

Terminal-ish states are ACCEPTED/DELIVERED/READ (success) and FAILED. QUEUED
messages older than a few minutes indicate outpost is not draining.

`replied_at` sits alongside the status because a reply is NOT a further step of
the same ladder: WhatsApp users can switch read receipts off, so a guest can
answer a message that never reached READ. Keeping it as its own timestamp lets
the campaign funnel report "received / saw / answered" honestly instead of
pretending answers are a subset of reads.
"""
from __future__ import annotations

from enum import Enum


class MessageDeliveryStatus(str, Enum):
    QUEUED = "queued"
    ACCEPTED = "accepted"
    DELIVERED = "delivered"
    READ = "read"
    FAILED = "failed"

    @classmethod
    def successful_values(cls) -> set[str]:
        """States that mean Meta took the message. Use for "sent" counts."""
        return {cls.ACCEPTED.value, cls.DELIVERED.value, cls.READ.value}

    @classmethod
    def in_flight_values(cls) -> set[str]:
        return {cls.QUEUED.value}


# Ranked so a late-arriving receipt can never move a message backwards (Meta may
# deliver 'delivered' and 'read' webhooks out of order).
#
# FAILED sits ABOVE ACCEPTED: Meta first accepts a message (send API returns a
# wamid -> ACCEPTED) and may later report it undeliverable via a 'failed' status
# webhook (blocked number, not on WhatsApp, re-engagement window). That receipt
# must win, otherwise the owner sees "sent" for a message that never arrived.
# FAILED stays BELOW DELIVERED/READ: once Meta confirmed delivery, a late or
# duplicate 'failed' can't un-deliver it.
_RANK = {
    MessageDeliveryStatus.QUEUED.value: 0,
    MessageDeliveryStatus.ACCEPTED.value: 1,
    MessageDeliveryStatus.FAILED.value: 2,
    MessageDeliveryStatus.DELIVERED.value: 3,
    MessageDeliveryStatus.READ.value: 4,
}


def status_rank(status) -> int:
    return _RANK.get(str(status or ""), -1)


def can_transition(current, new) -> bool:
    """True when a receipt `new` may overwrite the stored status `current`."""
    return status_rank(new) > status_rank(current)


# The same ladder as a SQL expression over a status column, so raw-SQL writers
# (webhook-worker receipts, outpost) rank exactly like `status_rank`.
def status_rank_sql(column: str = "status") -> str:
    cases = " ".join(f"WHEN '{k}' THEN {v}" for k, v in _RANK.items())
    return f"(CASE {column} {cases} ELSE -1 END)"


# Idempotent DDL. `messages_sent` predates this module with just
# (campaign_id, guest_id, sent_at), so every added column is nullable or
# defaulted and existing rows read as ACCEPTED - they were sent under the old
# code, which only ever inserted after a successful publish.
ENSURE_MESSAGES_SENT_DDL = (
    """
    CREATE TABLE IF NOT EXISTS messages_sent (
        campaign_id uuid NOT NULL,
        guest_id uuid NOT NULL,
        sent_at timestamptz NOT NULL DEFAULT NOW(),
        PRIMARY KEY (campaign_id, guest_id)
    );
    """,
    "ALTER TABLE messages_sent ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'accepted'",
    "ALTER TABLE messages_sent ADD COLUMN IF NOT EXISTS wa_message_id TEXT",
    "ALTER TABLE messages_sent ADD COLUMN IF NOT EXISTS error_code TEXT",
    "ALTER TABLE messages_sent ADD COLUMN IF NOT EXISTS error_detail TEXT",
    "ALTER TABLE messages_sent ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW()",
    # When this recipient answered the message. NULL = no reply yet.
    "ALTER TABLE messages_sent ADD COLUMN IF NOT EXISTS replied_at timestamptz",
    # Times this row was re-sent after a retry-later failure (RETRY_LATER_CODES).
    "ALTER TABLE messages_sent ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0",
    # Delivery receipts arrive keyed by wamid only.
    "CREATE INDEX IF NOT EXISTS ix_messages_sent_wa_message_id ON messages_sent (wa_message_id)",
    # Campaign statistics group by status.
    "CREATE INDEX IF NOT EXISTS ix_messages_sent_campaign_status ON messages_sent (campaign_id, status)",
    # Reply attribution looks up a guest's most recent campaign message.
    "CREATE INDEX IF NOT EXISTS ix_messages_sent_guest_recent ON messages_sent (guest_id, sent_at DESC)",
)


# Failures that are about timing, not the guest: Meta's per-user cap on business
# MARKETING messages (131049 "healthy ecosystem engagement") - the person already
# got their share today; it resets after ~24h or once they reply. Such a row is
# re-sent ONCE, by the scheduler, after the delay and only inside the send window
# (scheduler-service/delivery_retry.py -> campaign-worker retry mode). A guest
# blocked twice moves to the front of the next phone-call round instead.
RETRY_LATER_CODES = ("131049",)
RETRY_LATER_AFTER_HOURS = 24
RETRY_LATER_MAX_AGE_DAYS = 7     # older than this, the round's moment has passed
RETRY_LATER_MAX = 1


def ensure_messages_sent_schema(cursor) -> None:
    """Apply the DDL with an already-open DB-API cursor. Safe to re-run."""
    for stmt in ENSURE_MESSAGES_SENT_DDL:
        cursor.execute(stmt)

# --- reply attribution -----------------------------------------------------
#
# Crediting an inbound guest message to the round that prompted it. Both
# statements live here, next to the schema they write, so webhook-worker (which
# issues them) and core-service (which counts the result) can never drift on
# what "answered" means. Named parameters, usable from SQLAlchemy `text()`.

# Highest confidence: the guest replied to a specific message and Meta handed us
# its wamid. `replied_at IS NULL` makes the first reply the one that counts, so a
# chatty guest is one answer, not five.
REPLY_BY_WAMID_SQL = """
    UPDATE messages_sent
    SET replied_at = NOW(), updated_at = NOW()
    WHERE wa_message_id = :wamid AND replied_at IS NULL
"""

# Fallback: credit the most recent campaign message this guest actually received
# for this event. Guest rows store 0501234567 / +972501234567 / 972501234567
# interchangeably, so both sides are canonicalised to full international digits
# (see `canonical_phone_sql`) and compared EXACTLY - a suffix match could credit
# (or opt out) a different person whose number shares the last 9 digits in
# another country. 'queued' is excluded - a message never handed to Meta cannot
# be the one they answered.
def canonical_phone_sql(column: str) -> str:
    """SQL expression: `column` as international digits (972501234567).

    Mirrors `canonical_phone_digits`. Local Israeli formats (0501234567,
    501234567) are lifted to 972..., 00-prefixed international numbers lose the
    00, everything else keeps its digits.
    """
    d = f"regexp_replace(COALESCE({column}, ''), '[^0-9]', '', 'g')"
    return (
        f"(CASE WHEN {d} LIKE '00%' THEN substr({d}, 3) "
        f"WHEN {d} LIKE '0%' THEN '972' || substr({d}, 2) "
        f"WHEN length({d}) = 9 AND {d} LIKE '5%' THEN '972' || {d} "
        f"ELSE {d} END)"
    )


def canonical_phone_digits(phone) -> str:
    """Python twin of `canonical_phone_sql`: '+972 50-123-4567' -> '972501234567'."""
    d = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if d.startswith("00"):
        return d[2:]
    if d.startswith("0"):
        return "972" + d[1:]
    if len(d) == 9 and d.startswith("5"):
        return "972" + d
    return d


REPLY_BY_RECENCY_SQL = f"""
    UPDATE messages_sent
    SET replied_at = NOW(), updated_at = NOW()
    WHERE (campaign_id, guest_id) IN (
        SELECT ms.campaign_id, ms.guest_id
        FROM messages_sent ms
        JOIN campaigns c ON c.id = ms.campaign_id
        JOIN guests g ON g.id = ms.guest_id
        WHERE c.event_id = CAST(:event_id AS uuid)
          AND ms.replied_at IS NULL
          AND ms.status <> 'queued'
          AND {canonical_phone_sql('g.phone')} = :phone
        ORDER BY ms.sent_at DESC
        LIMIT 1
    )
"""


def phone_match_suffix(normalized_phone: str) -> str:
    """DEPRECATED: suffix matching is ambiguous across countries. Kept only for
    callers not yet migrated; use `canonical_phone_digits` + exact match."""
    return (normalized_phone or "")[-9:]
