import os
import time
import json
import logging
import threading
from logging.config import dictConfig

from fastapi import FastAPI
import uvicorn

from db import (
    connect as db_connect,
    fetch_and_mark_due,
    fetch_and_mark_due_releases,
    revert_to_pending,
    revert_release_to_pending,
)
from mq import connect as mq_connect, publish_campaign, is_connection_healthy, reconnect_rabbitmq, send_heartbeat
from daily_summary import ensure_daily_summary_table, run_daily_summary_check
from notifications import ensure_owner_notifications_table, dispatch_owner_notifications
from payment_reconciliation import run_payment_reconciliation
from campaign_finalizer import finalize_campaigns


def configure_logging():
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        fmt='level=%(levelname)s ts=%(asctime)s logger=%(name)s msg="%(message)s"',
        datefmt='%Y-%m-%dT%H:%M:%SZ'
    )
    handler.setFormatter(formatter)
    root.addHandler(handler)


def log_json(logger: logging.Logger, level: int, message: str, **fields):
    if fields:
        message = f"{message} | data={json.dumps(fields, default=str)}"
    logger.log(level, message)


def run_loop():
    configure_logging()
    logger = logging.getLogger("scheduler")
    check_interval = int(os.getenv("CHECK_INTERVAL", "30"))
    queue_name = os.getenv("CAMPAIGNS_QUEUE", "campaigns")
    outpost_queue = os.getenv("OUTPOST_QUEUE_NAME", os.getenv("OUTPOST_QUEUE", "outpost_queue"))

    log_json(logger, logging.INFO, "Scheduler started", interval=check_interval, queue=queue_name)
    try:
        from shared.obs import bootstrap
        bootstrap("scheduler")
    except Exception:
        pass
    conn = db_connect()
    ensure_daily_summary_table(conn)
    ensure_owner_notifications_table(conn)
    rabbit, channel = reconnect_rabbitmq()
    
    # Heartbeat interval (every 30 seconds to stay well under 60s heartbeat timeout)
    heartbeat_interval = 30
    last_heartbeat = time.time()

    try:
        while True:
            current_time = time.time()
            
            # Send heartbeat if needed
            if current_time - last_heartbeat >= heartbeat_interval:
                if send_heartbeat(rabbit):
                    last_heartbeat = current_time
                else:
                    log_json(logger, logging.WARNING, "Heartbeat failed, reconnecting...")
                    rabbit, channel = reconnect_rabbitmq()
                    last_heartbeat = current_time
            
            rows = fetch_and_mark_due(conn)
            log_json(logger, logging.INFO, "Cycle fetched", count=len(rows))
            
            for row in rows:
                msg = {
                    "campaign_id": str(row["id"]),
                    "event_id": str(row["event_id"]),
                    "payload": {
                        "name": row["name"],
                        "template": row["template"],
                        "channel": row["channel"],
                        "schedule_time": row["schedule_time"].isoformat() if row["schedule_time"] else None,
                    },
                }
                
                try:
                    # Check connection health and reconnect if needed
                    if not is_connection_healthy(rabbit) or channel.is_closed:
                        log_json(logger, logging.WARNING, "RabbitMQ connection unhealthy, reconnecting...")
                        rabbit, channel = reconnect_rabbitmq()
                        last_heartbeat = current_time
                    
                    publish_campaign(channel, queue_name, msg)
                    log_json(logger, logging.INFO, "Published", campaign_id=msg["campaign_id"])
                    
                except Exception as e:
                    log_json(logger, logging.ERROR, "Publish failed; reverting to pending", campaign_id=row["id"], error=str(e))
                    try:
                        revert_to_pending(conn, str(row["id"]))
                    except Exception as revert_error:
                        log_json(logger, logging.ERROR, "Failed to revert campaign to pending", campaign_id=row["id"], error=str(revert_error))
                    
                    # Try to reconnect after publish failure
                    try:
                        rabbit, channel = reconnect_rabbitmq()
                        last_heartbeat = current_time
                        log_json(logger, logging.INFO, "Reconnected to RabbitMQ after failure")
                    except Exception as reconnect_error:
                        log_json(logger, logging.ERROR, "Failed to reconnect to RabbitMQ", error=str(reconnect_error))

            # Planner-released batches: the planner already decided the day + size;
            # publish each due release with its per-batch `limit` and `release_id`.
            releases = fetch_and_mark_due_releases(conn)
            if releases:
                log_json(logger, logging.INFO, "Releases due", count=len(releases))
            for rel in releases:
                msg = {
                    "campaign_id": str(rel["campaign_id"]),
                    "event_id": str(rel["event_id"]),
                    "release_id": str(rel["release_id"]),
                    "limit": int(rel["count"]),
                    "payload": {
                        "name": rel["name"],
                        "template": rel["template"],
                        "channel": rel["channel"],
                        "release_date": rel["release_date"].isoformat() if rel["release_date"] else None,
                    },
                }
                try:
                    if not is_connection_healthy(rabbit) or channel.is_closed:
                        rabbit, channel = reconnect_rabbitmq()
                        last_heartbeat = current_time
                    publish_campaign(channel, queue_name, msg)
                    log_json(logger, logging.INFO, "Published release",
                             release_id=msg["release_id"], campaign_id=msg["campaign_id"], limit=msg["limit"])
                except Exception as e:
                    log_json(logger, logging.ERROR, "Release publish failed; reverting", release_id=str(rel["release_id"]), error=str(e))
                    try:
                        revert_release_to_pending(conn, str(rel["release_id"]))
                    except Exception as revert_error:
                        log_json(logger, logging.ERROR, "Failed to revert release", release_id=str(rel["release_id"]), error=str(revert_error))
                    try:
                        rabbit, channel = reconnect_rabbitmq()
                        last_heartbeat = current_time
                    except Exception as reconnect_error:
                        log_json(logger, logging.ERROR, "Failed to reconnect to RabbitMQ", error=str(reconnect_error))

            # Daily 20:00 owner summaries - claimed once per event per local day,
            # sent only when confirmations changed since the previous summary.
            try:
                if not is_connection_healthy(rabbit) or channel.is_closed:
                    rabbit, channel = reconnect_rabbitmq()
                    last_heartbeat = current_time
                summarized = run_daily_summary_check(
                    conn, lambda msg: publish_campaign(channel, outpost_queue, msg)
                )
                if summarized:
                    log_json(logger, logging.INFO, "Daily summaries dispatched", events=summarized)
            except Exception as e:
                log_json(logger, logging.ERROR, "Daily summary cycle failed", error=str(e))
                try:
                    from shared.obs import capture
                    capture(e, operation="daily_summary", flow="scheduler", worker="scheduler")
                except Exception:
                    pass

            # Owner-notification outbox (team invites, assistant intro, ...):
            # rows inserted by core/aub, published here through outpost.
            try:
                if not is_connection_healthy(rabbit) or channel.is_closed:
                    rabbit, channel = reconnect_rabbitmq()
                    last_heartbeat = current_time
                dispatch_owner_notifications(
                    conn, lambda msg: publish_campaign(channel, outpost_queue, msg)
                )
            except Exception as e:
                log_json(logger, logging.ERROR, "Owner notifications cycle failed", error=str(e))
                try:
                    from shared.obs import capture
                    capture(e, operation="owner_notifications", flow="scheduler", worker="scheduler")
                except Exception:
                    pass

            # Resolve campaigns from real delivery outcomes: 'sending' becomes
            # 'sent' only if Meta accepted at least one message, else 'failed'.
            try:
                finalized = finalize_campaigns(conn)
                if finalized.get("finalized_failed"):
                    log_json(logger, logging.ERROR, "Campaigns finished with NO successful deliveries",
                             count=finalized["finalized_failed"])
                    try:
                        from shared.ops.errors import record_error, SEVERITY_WARNING
                        record_error("campaign-worker",
                                     f"{finalized['finalized_failed']} campaign(s) delivered zero messages",
                                     severity=SEVERITY_WARNING, error_type="campaign_all_failed",
                                     context={"count": finalized["finalized_failed"]})
                    except Exception:
                        pass
            except Exception as e:
                log_json(logger, logging.ERROR, "Campaign finalization cycle failed", error=str(e))
                try:
                    from shared.obs import capture
                    capture(e, operation="campaign_finalization", flow="scheduler", worker="scheduler")
                except Exception:
                    pass

            # Payment reconciliation: recover orders whose iCount IPN was lost,
            # so a charged customer is never left without an event. Self-throttled
            # to its own interval; a no-op on most cycles.
            try:
                summary = run_payment_reconciliation()
                if summary and summary.get("provisioned"):
                    log_json(logger, logging.WARNING, "Reconciled unprovisioned paid orders",
                             orders=summary["provisioned"])
            except Exception as e:
                log_json(logger, logging.ERROR, "Payment reconciliation cycle failed", error=str(e))
                try:
                    from shared.obs import capture
                    capture(e, operation="payment_reconciliation", flow="scheduler", worker="scheduler")
                except Exception:
                    pass

            time.sleep(check_interval)
    finally:
        try:
            channel.close()
            rabbit.close()
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass


app = FastAPI()


@app.get("/healthz")
def health():
    return {"status": "ok"}


def main():
    # Start loop in a thread, expose health via uvicorn
    t = threading.Thread(target=run_loop, daemon=True)
    t.start()
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "5008")))


if __name__ == "__main__":
    main()


