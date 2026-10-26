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
import os
import threading
import time

import uvicorn

from planner.config import load_config
from planner.engine import Planner
from api import app
import meta_tier
import runtime


def configure_logging():
    logging.basicConfig(
        level=logging.INFO,
        format='level=%(levelname)s ts=%(asctime)s logger=%(name)s msg="%(message)s"',
        datefmt="%Y-%m-%dT%H:%M:%SZ",
    )


FAST_POLL_SECONDS = max(1, int(os.getenv("PLANNER_FAST_POLL_SECONDS", "5") or 5))
CLEANUP_EVERY_SECONDS = 3600


def effective_config(conn, base):
    """Env config with the WhatsApp conversation cap lowered to Meta's tier
    when known: min(env META_NEW_CONVERSATIONS_PER_24H, Meta tier)."""
    env_lim = base.channel_limits("whatsapp")
    if env_lim is None:
        return base
    tier_cap, tier, quality = meta_tier.known_limit(conn)
    cfg = base
    if tier_cap:
        cfg = base.with_channel_cap("whatsapp", min(env_lim.new_conversations_per_24h, int(tier_cap)),
                                    tier=tier or "", quality_rating=quality or "")
    lim = cfg.channel_limits("whatsapp")
    meta_tier.store_capacity(conn, env_lim.new_conversations_per_24h, lim.raw_daily_capacity,
                             cfg.planner_daily_capacity("whatsapp"), cfg.safety_margin_percent)
    return cfg


def plan_once(conn, planner: Planner) -> None:
    # Plan in local (Israel) calendar days - the days owners schedule in.
    now_local = runtime.local_now()
    now = now_local.date()
    inputs = runtime.load_plan_inputs(conn, planner.config, now, now_local)
    result = planner.plan(inputs.requests, now, context=inputs.context)
    runtime.persist_plan(conn, result, planner.config, now, inputs)
    logging.getLogger("planner").info(
        "planned campaigns=%d placed=%d moved=%d unplaced=%d delayed=%d finalized=%d dead=%d "
        "prefill_today=%d capacity=%d strategy=%s",
        len(inputs.requests), result.total_planned(), result.total_moved(),
        result.total_unplaced(), len(result.delayed_campaigns()), len(inputs.finalize_ids),
        len(inputs.dead), (inputs.context.prefill.get("whatsapp") or {}).get(now, 0),
        planner.config.planner_daily_capacity("whatsapp"), result.strategy,
    )


def run_loop():
    configure_logging()
    log = logging.getLogger("planner")
    base_config = load_config()
    log.info("planner loop started interval=%ss fast_poll=%ss strategy=%s",
             base_config.interval_seconds, FAST_POLL_SECONDS, base_config.strategy)
    try:
        from shared.obs import bootstrap
        bootstrap("planner")
    except Exception:
        pass
    conn = None
    last_plan = 0.0
    last_tier = 0.0
    last_cleanup = 0.0
    while True:
        try:
            if conn is None or conn.closed:
                conn = runtime.connect()
            t = time.time()
            if t - last_tier >= meta_tier.REFRESH_SECONDS:
                last_tier = t
                try:
                    info = meta_tier.refresh(conn)
                    log.info("meta tier refresh tier=%s quality=%s error=%s",
                             info.get("tier"), info.get("quality"), info.get("error"))
                except Exception as exc:
                    log.warning("meta tier refresh failed: %s", exc)
            due = (t - last_plan >= base_config.interval_seconds)
            if not due:
                # Fast path: a "send now" campaign has no batch until we plan it.
                try:
                    due = runtime.has_unplanned_due(conn)
                except Exception as exc:
                    log.warning("fast-path probe failed: %s", exc)
            if due:
                planner = Planner(effective_config(conn, base_config))
                plan_once(conn, planner)
                last_plan = time.time()
            if t - last_cleanup >= CLEANUP_EVERY_SECONDS:
                last_cleanup = t
                removed = runtime.cleanup_planner_runs(conn)
                if removed:
                    log.info("planner_runs cleanup removed=%d", removed)
        except Exception as exc:  # keep the loop alive; log and retry next tick
            log.error("planning cycle failed: %s", exc)
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass
            conn = None   # reconnect on the next tick (DB may still be down)
            last_plan = time.time()   # back off a full interval after a failure
        time.sleep(FAST_POLL_SECONDS)


def main():
    t = threading.Thread(target=run_loop, daemon=True)
    t.start()
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "5010")))


if __name__ == "__main__":
    main()
