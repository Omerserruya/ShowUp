"""Resolve campaigns from real delivery outcomes.

campaign-worker moves a campaign to 'sending' once its messages are queued -
deliberately not 'sent', because at that moment outpost has not yet called Meta.
This module closes the loop: once no messages for a campaign remain in flight, it
promotes the campaign to its true terminal state.

    sent    at least one message was accepted by Meta.
    failed  every message failed. Previously indistinguishable from success -
            a 300-guest round could deliver zero and still report "sent".

Messages stuck in 'queued' past a timeout are swept to 'failed' so a campaign
cannot hang in 'sending' forever when outpost dies mid-batch (a queued row would
otherwise never be resolved by anyone).
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict

from shared.domain.delivery import MessageDeliveryStatus

logger = logging.getLogger(__name__)

# How long a message may sit QUEUED before we treat it as lost. Generous: it only
# needs to exceed outpost's realistic drain time for a large batch.
QUEUED_TIMEOUT_MINUTES = int(os.getenv("MESSAGE_QUEUED_TIMEOUT_MINUTES", "60"))


def finalize_campaigns(conn) -> Dict[str, Any]:
    """Promote finished 'sending' campaigns. Returns a summary of what changed."""
    swept = 0
    finalized_sent = 0
    finalized_failed = 0

    with conn.cursor() as cur:
        # 1. Sweep abandoned queued messages so they stop blocking finalization.
        cur.execute(
            f"""
            UPDATE messages_sent
            SET status = %s,
                error_code = COALESCE(error_code, 'queued_timeout'),
                error_detail = COALESCE(error_detail, 'no delivery outcome recorded before timeout'),
                updated_at = NOW()
            WHERE status = %s
              AND sent_at < NOW() - INTERVAL '{QUEUED_TIMEOUT_MINUTES} minutes'
            """,
            (MessageDeliveryStatus.FAILED.value, MessageDeliveryStatus.QUEUED.value),
        )
        swept = cur.rowcount or 0

        # 2. Finalize campaigns with nothing left in flight. A single statement so
        #    the decision and the write cannot drift apart under concurrency.
        cur.execute(
            """
            WITH counts AS (
                SELECT c.id AS campaign_id,
                       COUNT(*) FILTER (WHERE m.status = ANY(%s)) AS ok,
                       COUNT(*) FILTER (WHERE m.status = %s)      AS in_flight,
                       COUNT(m.*)                                 AS total
                FROM campaigns c
                LEFT JOIN messages_sent m ON m.campaign_id = c.id
                WHERE c.status = 'sending'
                GROUP BY c.id
            )
            UPDATE campaigns c
            SET status = CASE WHEN counts.ok > 0 THEN 'sent' ELSE 'failed' END,
                recipient_count = counts.ok
            FROM counts
            WHERE c.id = counts.campaign_id
              AND counts.in_flight = 0
              AND counts.total > 0
            RETURNING c.id, c.status
            """,
            (list(MessageDeliveryStatus.successful_values()), MessageDeliveryStatus.QUEUED.value),
        )
        for _cid, status in cur.fetchall():
            if status == "sent":
                finalized_sent += 1
            else:
                finalized_failed += 1

    if swept or finalized_sent or finalized_failed:
        logger.info(
            "campaign finalization: sent=%s failed=%s stale_queued_swept=%s",
            finalized_sent, finalized_failed, swept,
        )
    return {
        "finalized_sent": finalized_sent,
        "finalized_failed": finalized_failed,
        "stale_queued_swept": swept,
    }
