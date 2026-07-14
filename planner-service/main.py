"""Planner service entrypoint.

Runs two things:
  * a background loop that every PLANNER_INTERVAL_SECONDS recomputes the whole
    delivery plan across all events and persists it (continuous rebalancing);
  * the read-only monitoring API (FastAPI/uvicorn).

The service makes NO send decisions beyond planning - it writes campaign_releases
and lets the scheduler release them and the worker execute them.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone

import uvicorn

from planner.config import load_config
from planner.engine import Planner
from api import app
import runtime


def configure_logging():
    logging.basicConfig(
        level=logging.INFO,
        format='level=%(levelname)s ts=%(asctime)s logger=%(name)s msg="%(message)s"',
        datefmt="%Y-%m-%dT%H:%M:%SZ",
    )


def plan_once(conn, planner: Planner) -> None:
    now = datetime.now(timezone.utc).date()
    requests = runtime.load_requests(conn, planner.config, now)
    result = planner.plan(requests, now)
    runtime.persist_plan(conn, result, planner.config, now)
    logging.getLogger("planner").info(
        "planned campaigns=%d placed=%d moved=%d unplaced=%d delayed=%d strategy=%s",
        len(requests), result.total_planned(), result.total_moved(),
        result.total_unplaced(), len(result.delayed_campaigns()), result.strategy,
    )


def run_loop():
    configure_logging()
    log = logging.getLogger("planner")
    config = load_config()
    planner = Planner(config)
    log.info("planner loop started interval=%ss strategy=%s", config.interval_seconds, config.strategy)
    conn = runtime.connect()
    while True:
        try:
            plan_once(conn, planner)
        except Exception as exc:  # keep the loop alive; log and retry next tick
            log.error("planning cycle failed: %s", exc)
            try:
                conn = runtime.connect()
            except Exception as reconnect_exc:
                log.error("reconnect failed: %s", reconnect_exc)
        time.sleep(config.interval_seconds)


def main():
    import os
    t = threading.Thread(target=run_loop, daemon=True)
    t.start()
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "5010")))


if __name__ == "__main__":
    main()
