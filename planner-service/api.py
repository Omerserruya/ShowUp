"""Monitoring API for the Global Delivery Planner.

Read-only visibility into what the planner has decided: current capacity, what is
reserved, planned load per day (heatmap), moved/delayed campaigns, queue depth of
pending releases, and the platform-wide estimated completion. Consumed by the
admin console (System Admin › Monitoring).
"""
from __future__ import annotations

import os
from datetime import date

import psycopg2
import psycopg2.extras
from fastapi import FastAPI

from planner.config import load_config

app = FastAPI(title="ShowUp Delivery Planner")


def _conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"), user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"), dbname=os.getenv("DB_NAME"),
    )


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/planner/config")
def planner_config():
    """The live limits/knobs the planner is running with (all from env)."""
    cfg = load_config()
    channels = {}
    for name, lim in cfg.channels.items():
        channels[name] = {
            "messages_per_second": lim.messages_per_second,
            "new_conversations_per_24h": lim.new_conversations_per_24h,
            "tier": lim.tier,
            "quality_rating": lim.quality_rating,
            "raw_daily_capacity": lim.raw_daily_capacity,
            "planner_daily_capacity": cfg.planner_daily_capacity(name),
            "reserved_daily_capacity": cfg.reserved_daily_capacity(name),
        }
    return {
        "strategy": cfg.strategy,
        "safety_margin_percent": cfg.safety_margin_percent,
        "max_early_send_days": cfg.max_early_send_days,
        "max_late_send_days": cfg.max_late_send_days,
        "interval_seconds": cfg.interval_seconds,
        "horizon_days": cfg.horizon_days,
        "channels": channels,
    }


@app.get("/planner/status")
def planner_status():
    """Latest run snapshot + live queue depth of pending releases."""
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT ran_at, strategy, total_planned, total_moved, total_unplaced, "
                "delayed_campaigns, estimated_completion, metrics "
                "FROM planner_runs ORDER BY ran_at DESC LIMIT 1"
            )
            run = cur.fetchone()
            cur.execute(
                "SELECT status, COUNT(*) c, COALESCE(SUM(count),0) vol "
                "FROM campaign_releases GROUP BY status"
            )
            queue = {r["status"]: {"releases": r["c"], "messages": int(r["vol"])} for r in cur.fetchall()}
    return {
        "last_run": run,
        "queue": queue,                                   # pending/queued/sent depth
        "pending_messages": queue.get("pending", {}).get("messages", 0),
    }


@app.get("/planner/heatmap")
def planner_heatmap(channel: str = "whatsapp"):
    """Upcoming per-day capacity utilisation for a channel (from the latest run)."""
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT metrics FROM planner_runs ORDER BY ran_at DESC LIMIT 1")
            row = cur.fetchone()
    metrics = (row or {}).get("metrics") or {}
    ch = (metrics.get("channels") or {}).get(channel, {})
    return {
        "channel": channel,
        "capacity_per_day": ch.get("capacity_per_day", 0),
        "reserved_per_day": ch.get("reserved_per_day", 0),
        "heatmap": ch.get("heatmap", {}),
    }


@app.get("/planner/delayed")
def planner_delayed(limit: int = 100):
    """Campaigns whose messages were moved off their target day (from live plan)."""
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT campaign_id, event_id, channel,
                       MIN(release_date) first_send, MAX(release_date) last_send,
                       MAX(target_date) target_date,
                       SUM(count) total, SUM(count) FILTER (WHERE moved) moved
                FROM campaign_releases
                WHERE status <> 'sent'
                GROUP BY campaign_id, event_id, channel
                HAVING BOOL_OR(moved)
                ORDER BY last_send
                LIMIT %s
                """,
                (limit,),
            )
            rows = cur.fetchall()
    return {"delayed": rows, "count": len(rows)}
