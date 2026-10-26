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
from typing import Any, Callable, Dict, Optional

from shared.domain.delivery import MessageDeliveryStatus

logger = logging.getLogger(__name__)

# How long a message may sit QUEUED before we treat it as lost. Must exceed the
# realistic outpost drain time of the largest backlog (incl. delayed retries,
# which can add ~70 min). The old 60 min swept everything past message ~7,200
# of a backlog to 'failed' while it was still going to be sent.
QUEUED_TIMEOUT_MINUTES = max(60, int(os.getenv("MESSAGE_QUEUED_TIMEOUT_MINUTES", "360")))


def finalize_campaigns(conn, outpost_backlog: Optional[Callable[[], Optional[int]]] = None) -> Dict[str, Any]:
    """Promote finished 'sending' campaigns. Returns a summary of what changed.

    `outpost_backlog` returns the number of messages still waiting in outpost's
    campaign queue (+ its retry queues), or None if unknown. While anything is
    still queued we never sweep: those 'queued' rows are not lost, just waiting.
    When the depth is unknown (broker unreachable) only rows older than twice
    the timeout are swept.
    """
    swept = 0
    finalized_sent = 0
    finalized_failed = 0

    backlog = None
    if outpost_backlog is not None:
        try:
            backlog = outpost_backlog()
        except Exception as exc:
            logger.warning("outpost backlog check failed: %s", exc)
            backlog = None

    with conn.cursor() as cur:
        # 1. Sweep abandoned queued messages so they stop blocking finalization.
        #    A row swept here can still be resolved by a late Meta acceptance
        #    (outpost treats failed/queued_timeout as resolvable).
        if backlog == 0 or backlog is None:
            timeout = QUEUED_TIMEOUT_MINUTES if backlog == 0 else QUEUED_TIMEOUT_MINUTES * 2
            cur.execute(
                """
                UPDATE messages_sent
                SET status = %s,
                    error_code = COALESCE(error_code, 'queued_timeout'),
                    error_detail = COALESCE(error_detail, 'no delivery outcome recorded before timeout'),
                    updated_at = NOW()
                WHERE status = %s
                  AND sent_at < NOW() - make_interval(mins => %s)
                """,
                (MessageDeliveryStatus.FAILED.value, MessageDeliveryStatus.QUEUED.value, timeout),
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

        # 3. A 'sending' campaign with no message rows at all (empty audience on
        #    an older worker build) would otherwise hang forever: total > 0 above
        #    never becomes true. It sent to nobody - 'sent' with 0 recipients.
        cur.execute(
            """
            UPDATE campaigns c
            SET status = 'sent', recipient_count = 0,
                status_reason = COALESCE(status_reason, 'empty audience')
            WHERE c.status = 'sending'
              AND NOT EXISTS (SELECT 1 FROM messages_sent m WHERE m.campaign_id = c.id)
              AND NOT EXISTS (SELECT 1 FROM campaign_releases r
                              WHERE r.campaign_id = c.id AND r.status IN ('pending', 'queued'))
            """
        )
        finalized_sent += cur.rowcount or 0

    if swept or finalized_sent or finalized_failed:
        logger.info(
            "campaign finalization: sent=%s failed=%s stale_queued_swept=%s",
            finalized_sent, finalized_failed, swept,
        )
    return {
        "finalized_sent": finalized_sent,
        "finalized_failed": finalized_failed,
        "stale_queued_swept": swept,
        "outpost_backlog": backlog,
    }
