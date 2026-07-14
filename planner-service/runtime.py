"""Service-side glue between the pure planner core and the database.

Responsibilities (I/O only - no scheduling decisions live here):
  * ensure the planner's schema (idempotent, like the other services)
  * load schedulable campaigns as `CampaignRequest`s
  * persist a `PlanResult` as concrete `campaign_releases` rows + a run snapshot

The planner owns timing; this module only reads inputs and writes the plan. The
scheduler-service later releases the due `campaign_releases`, and the worker
executes them. Nothing here talks to the queue.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import List

import psycopg2
import psycopg2.extras

from planner.config import PlannerConfig
from planner.models import CampaignRequest, PlanResult
from planner.windows import classify, resolve_window, default_priority

logger = logging.getLogger("planner.runtime")

# Plans that never auto-send (Venue Edition is manual-share only).
NON_AUTOSEND_PLANS = {"venue"}


def db_url() -> str:
    return (
        f"postgresql://{os.getenv('DB_USER')}:{os.getenv('DB_PASSWORD')}"
        f"@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}"
    )


def connect() -> psycopg2.extensions.connection:
    conn = psycopg2.connect(db_url())
    conn.autocommit = True
    ensure_planner_schema(conn)
    return conn


def ensure_planner_schema(conn) -> None:
    """Add the planner's columns/tables. Idempotent - safe on every boot."""
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")
        # Planner-owned columns on the existing campaigns table.
        for stmt in (
            "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_type VARCHAR(30)",
            "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS priority INTEGER",
            "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS planned_send_time TIMESTAMPTZ",
        ):
            try:
                cur.execute(stmt)
            except Exception as exc:  # pragma: no cover
                logger.warning("schema patch skipped: %s (%s)", stmt, exc)

        # One row per (campaign, day) batch the planner decides to release. This
        # is the planner's output the scheduler consumes; workers send `count`
        # not-yet-messaged recipients per row.
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS campaign_releases (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                campaign_id UUID NOT NULL,
                event_id UUID NOT NULL,
                channel VARCHAR(20) NOT NULL,
                release_date DATE NOT NULL,
                target_date DATE,
                count INTEGER NOT NULL CHECK (count >= 0),
                moved BOOLEAN NOT NULL DEFAULT false,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending|queued|sent
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_releases_due ON campaign_releases (status, release_date)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_releases_campaign ON campaign_releases (campaign_id)")

        # A snapshot of each planner run, for the monitoring API.
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS planner_runs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                strategy VARCHAR(40),
                total_planned INTEGER NOT NULL DEFAULT 0,
                total_moved INTEGER NOT NULL DEFAULT 0,
                total_unplaced INTEGER NOT NULL DEFAULT 0,
                delayed_campaigns INTEGER NOT NULL DEFAULT 0,
                estimated_completion DATE,
                metrics JSONB
            )
            """
        )


def _as_date(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    return value


def load_requests(conn, config: PlannerConfig, now: date) -> List[CampaignRequest]:
    """Build the planning input from all currently-schedulable campaigns.

    A campaign is schedulable when: it is still pending (never released), its
    event is active and on an auto-sending plan, its channel has configured
    limits, it has a target day and a positive recipient count, and its target is
    within the planning horizon."""
    horizon_end = now + timedelta(days=config.horizon_days)
    supported = set(config.channels.keys())
    requests: List[CampaignRequest] = []

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT c.id, c.event_id, c.name, c.template, c.channel, c.schedule_time,
                   c.recipient_count, c.campaign_type, c.priority,
                   e.plan_id, e.event_date
            FROM campaigns c
            JOIN events e ON e.id = c.event_id
            WHERE c.status = 'pending'
              AND c.schedule_time IS NOT NULL
              AND COALESCE(c.recipient_count, 0) > 0
              AND e.active = true
              -- Lock a campaign once any of its releases has started (queued/sent):
              -- its remaining schedule is fixed so already-released volume is never
              -- re-planned or double-counted. Only fully-pending campaigns rebalance.
              AND NOT EXISTS (
                    SELECT 1 FROM campaign_releases r
                    WHERE r.campaign_id = c.id AND r.status <> 'pending'
              )
            """
        )
        rows = cur.fetchall()

    for r in rows:
        channel = (r["channel"] or "").strip().lower()
        if channel not in supported:
            continue
        plan = (r["plan_id"] or "").strip().lower()
        if plan in NON_AUTOSEND_PLANS:
            continue
        target = _as_date(r["schedule_time"])
        if target is None:
            continue
        # Overdue targets collapse to "today" (never plan in the past).
        if target < now:
            target = now
        if target > horizon_end:
            continue

        ctype = classify(r["name"], r["template"], r["campaign_type"])
        window = resolve_window(target, ctype, config, now)
        priority = r["priority"] if r["priority"] is not None else default_priority(ctype)

        requests.append(CampaignRequest(
            campaign_id=str(r["id"]),
            event_id=str(r["event_id"]),
            channel=channel,
            campaign_type=ctype,
            priority=int(priority),
            volume=int(r["recipient_count"]),
            window=window,
            plan=plan,
            label=r["name"] or "",
        ))
    return requests


def persist_plan(conn, result: PlanResult, config: PlannerConfig, now: date) -> None:
    """Replace the pending release plan for every campaign in `result`, and record
    a run snapshot. Only campaigns that are still `pending` are (re)planned, so
    releases already in flight (queued/sent) are never disturbed - this is what
    makes continuous re-planning safe."""
    planned_ids = [a.campaign_id for a in result.allocations]
    with conn.cursor() as cur:
        if planned_ids:
            # Clear only not-yet-released rows for these campaigns, then rewrite.
            cur.execute(
                "DELETE FROM campaign_releases WHERE status = 'pending' AND campaign_id = ANY(%s::uuid[])",
                (planned_ids,),
            )
        for alloc in result.allocations:
            first = alloc.first_send
            for day, count in sorted(alloc.by_day.items()):
                if count <= 0:
                    continue
                cur.execute(
                    """
                    INSERT INTO campaign_releases
                        (campaign_id, event_id, channel, release_date, target_date, count, moved, status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, 'pending')
                    """,
                    (alloc.campaign_id, alloc.event_id, alloc.channel, day,
                     alloc.target, count, day != alloc.target),
                )
            # planned_send_time = first day the campaign begins sending.
            cur.execute(
                "UPDATE campaigns SET planned_send_time = %s WHERE id = %s",
                (datetime.combine(first, datetime.min.time(), tzinfo=timezone.utc) if first else None,
                 alloc.campaign_id),
            )

        # Run snapshot for monitoring.
        metrics = _run_metrics(result, config)
        eta = result.estimated_completion()
        cur.execute(
            """
            INSERT INTO planner_runs
                (strategy, total_planned, total_moved, total_unplaced, delayed_campaigns,
                 estimated_completion, metrics)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (result.strategy, result.total_planned(), result.total_moved(),
             result.total_unplaced(), len(result.delayed_campaigns()), eta,
             json.dumps(metrics, default=str)),
        )


def _run_metrics(result: PlanResult, config: PlannerConfig) -> dict:
    """Compact per-channel metrics + heatmap for the monitoring API/snapshot."""
    channels = {}
    for channel in result.day_load:
        heat = result.heatmap(channel)
        channels[channel] = {
            "capacity_per_day": result.capacity.get(channel, 0),
            "reserved_per_day": result.reserved.get(channel, 0),
            "raw_daily_capacity": (config.channel_limits(channel).raw_daily_capacity
                                   if config.channel_limits(channel) else 0),
            "planned_total": sum(result.day_load[channel].values()),
            "heatmap": {d.isoformat(): v for d, v in heat.items()},
        }
    return {
        "strategy": result.strategy,
        "channels": channels,
        "safety_margin_percent": config.safety_margin_percent,
    }
