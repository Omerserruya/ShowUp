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
    FAILED    Meta rejected it, or the send raised. `error_code` /
              `error_detail` say why. Never silently discarded.

Terminal-ish states are ACCEPTED/DELIVERED/READ (success) and FAILED. QUEUED
messages older than a few minutes indicate outpost is not draining.
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
_RANK = {
    MessageDeliveryStatus.QUEUED.value: 0,
    MessageDeliveryStatus.FAILED.value: 1,
    MessageDeliveryStatus.ACCEPTED.value: 2,
    MessageDeliveryStatus.DELIVERED.value: 3,
    MessageDeliveryStatus.READ.value: 4,
}


def status_rank(status) -> int:
    return _RANK.get(str(status or ""), -1)


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
    # Delivery receipts arrive keyed by wamid only.
    "CREATE INDEX IF NOT EXISTS ix_messages_sent_wa_message_id ON messages_sent (wa_message_id)",
    # Campaign statistics group by status.
    "CREATE INDEX IF NOT EXISTS ix_messages_sent_campaign_status ON messages_sent (campaign_id, status)",
)


def ensure_messages_sent_schema(cursor) -> None:
    """Apply the DDL with an already-open DB-API cursor. Safe to re-run."""
    for stmt in ENSURE_MESSAGES_SENT_DDL:
        cursor.execute(stmt)
