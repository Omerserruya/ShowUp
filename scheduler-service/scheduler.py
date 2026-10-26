import os
import sys
import time
import json
import logging
import threading
from logging.config import dictConfig

from fastapi import FastAPI
from fastapi.responses import JSONResponse
import uvicorn
import psycopg2

from db import (
    connect as db_connect,
    fetch_and_mark_due,
    fetch_and_mark_due_releases,
    revert_to_pending,
    revert_release_to_pending,
    sweep_stuck_processing,
)
from mq import (
    connect as mq_connect, publish_campaign, is_connection_healthy, reconnect_rabbitmq,
    send_heartbeat, queue_depth,
)
from daily_summary import ensure_daily_summary_table, run_daily_summary_check
from notifications import ensure_owner_notifications_table, dispatch_owner_notifications
from payment_reconciliation import run_payment_reconciliation
from campaign_finalizer import finalize_campaigns
from send_window import is_within_send_window, next_window_open


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


# Liveness of the scheduling loop itself (not just the HTTP server). /healthz and
# the ops heartbeat both read this, so a loop wedged on a dead DB connection is
# reported as unhealthy instead of "ok" forever.
LOOP_STALE_SECONDS = int(os.getenv("SCHEDULER_LOOP_STALE_SECONDS", "180"))
WATCHDOG_SECONDS = int(os.getenv("SCHEDULER_WATCHDOG_SECONDS", "900"))
LOOP_STATE = {
    "started_at": time.time(),
    "last_ok": None,          # epoch of the last fully successful iteration
    "iterations": 0,
    "consecutive_failures": 0,
    "last_error": None,
    "thread_alive": False,
}


def loop_age_seconds() -> float:
    ref = LOOP_STATE["last_ok"] or LOOP_STATE["started_at"]
    return time.time() - ref


def loop_healthy() -> bool:
    return LOOP_STATE["thread_alive"] and loop_age_seconds() <= LOOP_STALE_SECONDS


def _capture(e, operation):
    try:
        from shared.obs import capture
        capture(e, operation=operation, flow="scheduler", worker="scheduler")
    except Exception:
        pass


class _Ctx:
    """Mutable connections shared across iterations (reconnected on failure)."""

    def __init__(self):
        self.conn = None
        self.rabbit = None
        self.channel = None
        self.last_heartbeat = time.time()
        self.window_logged_closed = False

    def ensure_db(self):
        if self.conn is None or self.conn.closed:
            self.conn = db_connect()
            ensure_daily_summary_table(self.conn)
            ensure_owner_notifications_table(self.conn)
        return self.conn

    def reset_db(self):
        try:
            if self.conn is not None:
                self.conn.close()
        except Exception:
            pass
        self.conn = None

    def ensure_mq(self):
        if self.rabbit is None or not is_connection_healthy(self.rabbit) \
                or self.channel is None or self.channel.is_closed:
            try:
                if self.rabbit is not None:
                    self.rabbit.close()
            except Exception:
                pass
            self.rabbit, self.channel = reconnect_rabbitmq()
            self.last_heartbeat = time.time()
        return self.channel


def _iteration(ctx: _Ctx, logger, queue_name: str, outpost_queue: str, priority_queue: str):
    conn = ctx.ensure_db()
    ctx.ensure_mq()

    # Keep the AMQP connection alive between cycles.
    if time.time() - ctx.last_heartbeat >= 30:
        if send_heartbeat(ctx.rabbit):
            ctx.last_heartbeat = time.time()
        else:
            log_json(logger, logging.WARNING, "Heartbeat failed, reconnecting...")
            ctx.rabbit = None
            ctx.ensure_mq()

    # Sending window: campaign rounds only START inside it (quiet hours + Shabbat).
    # Outside it nothing is claimed, so due campaigns simply wait for it to open.
    in_window = is_within_send_window()
    if not in_window:
        if not ctx.window_logged_closed:
            log_json(logger, logging.INFO, "Outside campaign send window; holding due campaigns",
                     opens_at=next_window_open())
            ctx.window_logged_closed = True
    else:
        ctx.window_logged_closed = False

    if in_window:
        rows = fetch_and_mark_due(conn)
        if rows:
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
                publish_campaign(ctx.ensure_mq(), queue_name, msg)
                log_json(logger, logging.INFO, "Published", campaign_id=msg["campaign_id"])
            except Exception as e:
                log_json(logger, logging.ERROR, "Publish failed; reverting to pending",
                         campaign_id=row["id"], error=str(e))
                revert_to_pending(conn, str(row["id"]))
                ctx.rabbit = None

        # Planner-released batches: the planner already decided the day + size;
        # publish each due release with its per-batch `limit` and `release_id`.
        deferred = []
        releases = fetch_and_mark_due_releases(conn, deferred_out=deferred)
        if releases:
            log_json(logger, logging.INFO, "Releases due", count=len(releases))
        if deferred:
            # Rolling-24h WhatsApp capacity reached: held, not sent (planner re-plans).
            log_json(logger, logging.WARNING, "Releases deferred: rolling 24h capacity reached",
                     count=len(deferred), messages=sum(int(d["count"] or 0) for d in deferred),
                     release_ids=[str(d["id"]) for d in deferred][:20])
        for rel in releases:
            msg = {
                "campaign_id": str(rel["campaign_id"]),
                "event_id": str(rel["event_id"]),
                "release_id": str(rel["release_id"]),
                "limit": int(rel["count"]),
                # Last batch of a fully-placed campaign: the worker sends ALL
                # remaining eligible guests (it also re-reads this from the DB).
                "final": bool(rel.get("is_final")),
                "payload": {
                    "name": rel["name"],
                    "template": rel["template"],
                    "channel": rel["channel"],
                    "release_date": rel["release_date"].isoformat() if rel["release_date"] else None,
                },
            }
            try:
                publish_campaign(ctx.ensure_mq(), queue_name, msg)
                log_json(logger, logging.INFO, "Published release",
                         release_id=msg["release_id"], campaign_id=msg["campaign_id"], limit=msg["limit"])
            except Exception as e:
                log_json(logger, logging.ERROR, "Release publish failed; reverting",
                         release_id=str(rel["release_id"]), error=str(e))
                revert_release_to_pending(conn, str(rel["release_id"]))
                ctx.rabbit = None

    # Stuck work: campaigns in 'processing' / releases in 'queued' > 30 min.
    try:
        swept = sweep_stuck_processing(conn)
        if any(swept.values()):
            log_json(logger, logging.WARNING, "Swept stuck campaigns/releases", **swept)
            if swept.get("failed") or swept.get("releases_failed"):
                try:
                    from shared.ops.errors import record_error, SEVERITY_ERROR
                    record_error("scheduler", "campaign(s) failed after being stuck in processing",
                                 severity=SEVERITY_ERROR, error_type="campaign_stuck_processing",
                                 context=swept)
                except Exception:
                    pass
    except (psycopg2.OperationalError, psycopg2.InterfaceError):
        raise
    except Exception as e:
        log_json(logger, logging.ERROR, "Stuck-campaign sweep failed", error=str(e))
        _capture(e, "stuck_sweep")

    # Daily 20:00 owner summaries + owner-notification outbox. Owner-facing, so
    # they ride the PRIORITY outpost lane (never stuck behind a campaign backlog)
    # and are not subject to the campaign send window.
    try:
        summarized = run_daily_summary_check(
            conn, lambda m: publish_campaign(ctx.ensure_mq(), priority_queue, m)
        )
        if summarized:
            log_json(logger, logging.INFO, "Daily summaries dispatched", events=summarized)
    except (psycopg2.OperationalError, psycopg2.InterfaceError):
        raise
    except Exception as e:
        log_json(logger, logging.ERROR, "Daily summary cycle failed", error=str(e))
        _capture(e, "daily_summary")

    try:
        dispatch_owner_notifications(
            conn, lambda m: publish_campaign(ctx.ensure_mq(), priority_queue, m)
        )
    except (psycopg2.OperationalError, psycopg2.InterfaceError):
        raise
    except Exception as e:
        log_json(logger, logging.ERROR, "Owner notifications cycle failed", error=str(e))
        _capture(e, "owner_notifications")

    # Resolve campaigns from real delivery outcomes: 'sending' becomes 'sent'
    # only if Meta accepted at least one message, else 'failed'. Never sweeps
    # 'queued' rows while outpost still has a backlog.
    retry_tiers = int(os.getenv("OUTPOST_RETRY_TIERS", "5"))
    backlog_queues = [outpost_queue] + [f"{outpost_queue}.retry.{i}" for i in range(1, retry_tiers + 1)]
    try:
        finalized = finalize_campaigns(conn, lambda: queue_depth(ctx.rabbit, backlog_queues))
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
    except (psycopg2.OperationalError, psycopg2.InterfaceError):
        raise
    except Exception as e:
        log_json(logger, logging.ERROR, "Campaign finalization cycle failed", error=str(e))
        _capture(e, "campaign_finalization")

    # Payment reconciliation (self-throttled; a no-op on most cycles).
    try:
        summary = run_payment_reconciliation()
        if summary and summary.get("provisioned"):
            log_json(logger, logging.WARNING, "Reconciled unprovisioned paid orders",
                     orders=summary["provisioned"])
    except Exception as e:
        log_json(logger, logging.ERROR, "Payment reconciliation cycle failed", error=str(e))
        _capture(e, "payment_reconciliation")


def run_loop():
    logger = logging.getLogger("scheduler")
    check_interval = int(os.getenv("CHECK_INTERVAL", "30"))
    queue_name = os.getenv("CAMPAIGNS_QUEUE", "campaigns")
    outpost_queue = os.getenv("OUTPOST_QUEUE_NAME", os.getenv("OUTPOST_QUEUE", "outpost_queue"))
    priority_queue = os.getenv("OUTPOST_PRIORITY_QUEUE", "outpost_priority_queue")

    log_json(logger, logging.INFO, "Scheduler started", interval=check_interval, queue=queue_name,
             priority_queue=priority_queue)
    ctx = _Ctx()
    backoff = check_interval
    while True:
        try:
            _iteration(ctx, logger, queue_name, outpost_queue, priority_queue)
            LOOP_STATE["last_ok"] = time.time()
            LOOP_STATE["iterations"] += 1
            LOOP_STATE["consecutive_failures"] = 0
            LOOP_STATE["last_error"] = None
            backoff = check_interval
            time.sleep(check_interval)
        except Exception as e:
            # Every failure is survivable: drop the (possibly broken) connections
            # and retry with exponential backoff. Previously one DB blip killed
            # the thread silently while /healthz kept answering "ok".
            LOOP_STATE["consecutive_failures"] += 1
            LOOP_STATE["last_error"] = f"{type(e).__name__}: {e}"[:500]
            log_json(logger, logging.ERROR, "Scheduler iteration failed; reconnecting",
                     error=LOOP_STATE["last_error"], failures=LOOP_STATE["consecutive_failures"],
                     retry_in=backoff)
            if LOOP_STATE["consecutive_failures"] in (1, 5, 20):
                _capture(e, "scheduler_iteration")
            ctx.reset_db()
            ctx.rabbit = None
            time.sleep(backoff)
            backoff = min(backoff * 2, 300)


def _run_loop_or_die():
    """Thread target: if the loop ever exits, kill the process so the container
    restart policy brings up a fresh scheduler (a dead loop behind a live HTTP
    server is the worst failure mode: nothing is sent and nothing alarms)."""
    LOOP_STATE["thread_alive"] = True
    try:
        run_loop()
    except BaseException as e:  # noqa: BLE001
        logging.getLogger("scheduler").critical(f"Scheduler loop died: {e}", exc_info=True)
        _capture(e, "scheduler_loop_died")
    finally:
        LOOP_STATE["thread_alive"] = False
        logging.getLogger("scheduler").critical("Scheduler loop exited; terminating process")
        os._exit(1)


def _loop_heartbeat():
    """Ops heartbeat that reflects the LOOP, not the process: it only beats while
    the loop has completed an iteration within LOOP_STALE_SECONDS, so the ops
    dashboard shows the scheduler as warning/offline when the loop is wedged."""
    import datetime as dt
    try:
        from shared.ops.heartbeat import _beat_once, _dsn, INTERVAL_SECONDS
    except Exception:
        return
    started_at = dt.datetime.now(dt.timezone.utc)
    version = os.getenv("SERVICE_VERSION") or os.getenv("GIT_SHA")
    while True:
        # Watchdog: an iteration wedged (e.g. a query hanging on a half-dead
        # socket) or failing for this long -> exit so the restart policy starts
        # a fresh process. Restart policies act on exit, not on /healthz.
        if loop_age_seconds() > WATCHDOG_SECONDS:
            logging.getLogger("scheduler").critical(
                f"Scheduler loop stale for {int(loop_age_seconds())}s; terminating process")
            os._exit(1)
        try:
            dsn = _dsn()
            if dsn and loop_healthy():
                meta = json.dumps({"loop_age_s": round(loop_age_seconds()),
                                   "iterations": LOOP_STATE["iterations"]})
                _beat_once(dsn, "scheduler", started_at, version, meta)
        except Exception:
            pass
        time.sleep(INTERVAL_SECONDS)


app = FastAPI()


@app.get("/healthz")
def health():
    body = {
        "status": "ok" if loop_healthy() else "unhealthy",
        "loop_alive": LOOP_STATE["thread_alive"],
        "loop_age_seconds": round(loop_age_seconds()),
        "iterations": LOOP_STATE["iterations"],
        "consecutive_failures": LOOP_STATE["consecutive_failures"],
        "last_error": LOOP_STATE["last_error"],
    }
    return JSONResponse(body, status_code=200 if loop_healthy() else 503)


def main():
    configure_logging()
    try:
        # Sentry only - the generic process heartbeat is replaced by
        # _loop_heartbeat so liveness reflects the scheduling loop.
        from shared.obs import init_sentry
        init_sentry("scheduler")
    except Exception:
        pass
    threading.Thread(target=_loop_heartbeat, name="scheduler-heartbeat", daemon=True).start()
    t = threading.Thread(target=_run_loop_or_die, name="scheduler-loop", daemon=True)
    t.start()
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "5008")))


if __name__ == "__main__":
    main()
