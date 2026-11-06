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
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import List, Optional

import psycopg2
import psycopg2.extras

from dataclasses import dataclass, field
from typing import Dict, Set

from planner.config import PlannerConfig
from planner.models import CampaignRequest, CampaignType, PlanContext, PlanResult
from planner.windows import classify, resolve_window, default_priority
from planner.send_window import adjust_minute_into_window, day_is_sendable, day_ranges, next_window_open
import audience_sql

logger = logging.getLogger("planner.runtime")

# Plans that never auto-send (Venue Edition is manual-share only).
NON_AUTOSEND_PLANS = {"venue"}

# Campaign times are the owner's local wall clock. Days are planned and batches
# released in this zone - NOT UTC (which released batches at 02:00-03:00 IL).
LOCAL_TZ_NAME = os.getenv("SEND_WINDOW_TZ", "Asia/Jerusalem")
DEFAULT_RELEASE_TIME = dtime(9, 0)


def local_tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(LOCAL_TZ_NAME)
    except Exception:  # no tzdata: Israel standard time
        return timezone(timedelta(hours=2))


def local_today() -> date:
    return datetime.now(timezone.utc).astimezone(local_tz()).date()


def _local(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)   # timestamptz read back naive
    return value.astimezone(local_tz())


def local_now() -> datetime:
    return datetime.now(timezone.utc).astimezone(local_tz())


def release_instant(day: date, schedule_time: Optional[datetime], *,
                    event_day: Optional[date] = None, target: Optional[date] = None,
                    now: Optional[datetime] = None) -> datetime:
    """The moment a batch planned for `day` is released: that day at the
    campaign's own local send time-of-day (Asia/Jerusalem), moved INSIDE the
    send window (SEND_WINDOW) when that time-of-day is outside it (next range
    start that day, else the day's first range start). Volume carried onto the
    EVENT DAY (day != target) goes out at the window's first opening - the
    event-day morning. Aware UTC datetime."""
    local = _local(schedule_time)
    tod = local.timetz().replace(tzinfo=None) if local else DEFAULT_RELEASE_TIME
    minute = tod.hour * 60 + tod.minute
    if event_day is not None and day == event_day and target is not None and day != target:
        ranges = day_ranges(day)
        minute = ranges[0][0] if ranges else DEFAULT_RELEASE_TIME.hour * 60
    adjusted = adjust_minute_into_window(day, minute)
    if adjusted != minute or (local is None) or (event_day is not None and day == event_day and day != target):
        tod = dtime(adjusted // 60, adjusted % 60) if adjusted < 24 * 60 else dtime(23, 59)
    out = datetime.combine(day, tod, tzinfo=local_tz()).astimezone(timezone.utc)
    # A round whose own time is still ahead must never fire by surprise: when
    # the window clamp lands in the past (e.g. 23:24 today -> 09:00 today, read
    # at 15:00) it goes out at the window's next opening after its own time.
    now = now or datetime.now(timezone.utc)
    if schedule_time is not None and out <= now < _aware_utc(schedule_time):
        nxt = next_window_open(_aware_utc(schedule_time))
        out = nxt.astimezone(timezone.utc) if nxt is not None else _aware_utc(schedule_time)
    return out


def _aware_utc(value: datetime) -> datetime:
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


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
        # Exact release instant (local send time on release_date) + stuck-release
        # retry counter (scheduler sweeper). Also ensured by scheduler-service.
        cur.execute("ALTER TABLE campaign_releases ADD COLUMN IF NOT EXISTS release_at TIMESTAMPTZ")
        cur.execute("ALTER TABLE campaign_releases ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0")
        # The campaign's LAST planned batch with nothing left unplaced: the
        # worker sends ALL remaining eligible guests on it (no `limit`), so a
        # stale/short count never silently leaves guests un-messaged.
        cur.execute("ALTER TABLE campaign_releases ADD COLUMN IF NOT EXISTS is_final BOOLEAN NOT NULL DEFAULT false")
        # Reason column the planner writes ('capacity_unplaced'); also ensured by
        # scheduler-service / campaign-worker.
        cur.execute("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status_reason TEXT")
        # Rolling-24h capacity counts scan messages_sent by time.
        try:
            cur.execute("CREATE INDEX IF NOT EXISTS ix_messages_sent_sent_at ON messages_sent (sent_at)")
        except Exception as exc:  # table owned by shared/campaign-worker; may not exist yet
            logger.warning("messages_sent index skipped: %s", exc)

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
        cur.execute("CREATE INDEX IF NOT EXISTS idx_planner_runs_ran_at ON planner_runs (ran_at)")
        import meta_tier
        meta_tier.ensure_state_table(cur)


def _as_date(value) -> Optional[date]:
    """Local (Israel) calendar day of a timestamp (campaign schedule_time,
    event_date)."""
    if isinstance(value, datetime):
        return _local(value).date()
    return value


# --------------------------------------------------------------------------
# Capacity already used (prefill) + rolling 24h usage
# --------------------------------------------------------------------------
# Business-initiated WhatsApp conversations Meta counts against the tier =
# distinct recipients of campaign messages in the last 24h. Messages that never
# reached Meta (invalid phone / build failure) do not count. Kept in sync with
# scheduler-service/db.py ROLLING_24H_SQL.
ROLLING_24H_SQL = """
    SELECT COUNT(DISTINCT m.guest_id)
    FROM messages_sent m
    JOIN campaigns c ON c.id = m.campaign_id
    WHERE m.sent_at > NOW() - INTERVAL '24 hours'
      AND lower(trim(c.channel)) = 'whatsapp'
      AND NOT (m.status = 'failed' AND COALESCE(m.error_code, '') IN ('invalid_phone', 'build_failed'))
"""


def rolling_24h_used(cur) -> int:
    cur.execute(ROLLING_24H_SQL)
    used = int(cur.fetchone()[0] or 0)
    # In-flight batches (claimed by the scheduler, not yet executed).
    cur.execute("SELECT COALESCE(SUM(count), 0) FROM campaign_releases "
                "WHERE status = 'queued' AND lower(trim(channel)) = 'whatsapp'")
    return used + int(cur.fetchone()[0] or 0)


def compute_prefill(conn, today: date) -> Dict[str, Dict[date, int]]:
    """Volume already spent TODAY per channel, packed under before planning:
    max(releases released today, rolling-24h recipients + in-flight batches).
    Using the rolling figure for today means a big batch sent yesterday evening
    keeps today's capacity occupied until it ages out of Meta's 24h window."""
    midnight_utc = datetime.combine(today, dtime(0, 0), tzinfo=local_tz()).astimezone(timezone.utc)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COALESCE(SUM(count), 0) FROM campaign_releases "
            "WHERE status IN ('queued', 'sent') AND lower(trim(channel)) = 'whatsapp' "
            "AND (release_date = %s OR updated_at >= %s)",
            (today, midnight_utc),
        )
        released_today = int(cur.fetchone()[0] or 0)
        rolling = rolling_24h_used(cur)
    used = max(released_today, rolling)
    return {"whatsapp": {today: used}} if used else {"whatsapp": {}}


def closed_days(today: date, now_local: datetime, horizon_days: int) -> Set[date]:
    """Days the send window never opens (or today after its last close)."""
    out: Set[date] = set()
    now_min = now_local.hour * 60 + now_local.minute
    for i in range(0, horizon_days + 15):
        d = today + timedelta(days=i)
        if not day_is_sendable(d, now_min if i == 0 else None):
            out.add(d)
    return out


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------
@dataclass
class CampaignMeta:
    schedule_time: Optional[datetime]
    event_day: Optional[date]
    target: date
    original_target: date
    ctype: CampaignType
    has_messages: bool
    queued_volume: int
    status_reason: Optional[str]
    window_empty: bool
    deadline: Optional[date]


@dataclass
class PlanInputs:
    requests: List[CampaignRequest] = field(default_factory=list)
    meta: Dict[str, CampaignMeta] = field(default_factory=dict)
    # Started campaigns with nothing left to send and nothing in flight: the
    # planner drops their pending batches and hands them to the finalizer.
    finalize_ids: List[str] = field(default_factory=list)
    # Campaigns that can never be placed (deadline passed / after the event).
    dead: Dict[str, CampaignMeta] = field(default_factory=dict)
    context: PlanContext = field(default_factory=PlanContext)


CANDIDATES_SQL = """
    SELECT c.id, c.event_id, c.name, c.template, c.channel, c.schedule_time, c.created_at,
           c.recipient_count, c.campaign_type, c.priority, c.stage_id,
           c.audience, c.audience_filter, c.status_reason,
           e.plan_id, e.event_date,
           EXISTS (SELECT 1 FROM messages_sent m WHERE m.campaign_id = c.id) AS has_messages,
           COALESCE((SELECT SUM(r.count) FROM campaign_releases r
                     WHERE r.campaign_id = c.id AND r.status = 'queued'), 0) AS queued_volume
    FROM campaigns c
    JOIN events e ON e.id = c.event_id
    WHERE c.status = 'pending'
      AND c.schedule_time IS NOT NULL
      AND e.active = true
"""


def load_plan_inputs(conn, config: PlannerConfig, now: date,
                     now_local: Optional[datetime] = None) -> PlanInputs:
    """Build the planning input from all currently-schedulable campaigns.

    A campaign is schedulable when it is still pending, its event is active and
    on an auto-sending plan, its channel has configured limits and its target is
    within the planning horizon.

    Volume = the LIVE remaining audience (same semantics as the worker), minus
    batches already in flight - not the stored recipient_count (0/NULL for many
    rounds, stale as soon as guests change). Started campaigns are re-planned
    too: their already-sent volume is excluded via messages_sent and counted in
    today's prefill, so it is never double-counted (they used to be dropped from
    planning while their pending batches still consumed capacity unseen).
    A never-started campaign is planned with at least 1 so the worker resolves
    an empty audience (0-guest guard) instead of it waiting forever."""
    now_local = now_local or local_now()
    horizon_end = now + timedelta(days=config.horizon_days)
    supported = set(config.channels.keys())
    out = PlanInputs()

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(CANDIDATES_SQL)
        rows = cur.fetchall()

    with conn.cursor() as cur:
        for r in rows:
            cid = str(r["id"])
            channel = (r["channel"] or "").strip().lower()
            if channel not in supported:
                continue
            plan = (r["plan_id"] or "").strip().lower()
            if plan in NON_AUTOSEND_PLANS:
                continue
            original = _as_date(r["schedule_time"])
            if original is None:
                continue
            # Overdue targets collapse to "today" (never plan in the past).
            target = max(original, now)
            if target > horizon_end:
                continue

            ctype = classify(r["name"], r["template"], r["stage_id"] or r["campaign_type"])
            event_day = _as_date(r["event_date"])
            window = resolve_window(target, ctype, config, now, event_date=event_day,
                                    original_target=original)
            priority = r["priority"] if r["priority"] is not None else default_priority(ctype)
            has_messages = bool(r["has_messages"])
            queued = int(r["queued_volume"] or 0)

            remaining = audience_sql.remaining_audience(
                cur, cid, str(r["event_id"]), r["audience"], r["audience_filter"])
            if remaining is None:   # audience query failed: fall back to the stored size
                remaining = int(r["recipient_count"] or 0)
            volume = max(0, remaining - queued)
            if not has_messages and queued == 0:
                volume = max(volume, 1)

            meta = CampaignMeta(
                schedule_time=r["schedule_time"], event_day=event_day, target=window.target,
                original_target=original, ctype=ctype, has_messages=has_messages,
                queued_volume=queued, status_reason=r["status_reason"],
                window_empty=window.is_empty, deadline=window.hard_latest,
            )
            if volume <= 0:
                if queued == 0 and has_messages:
                    out.finalize_ids.append(cid)
                continue
            if window.is_empty:
                out.dead[cid] = meta
                continue
            out.meta[cid] = meta
            out.requests.append(CampaignRequest(
                campaign_id=cid,
                event_id=str(r["event_id"]),
                channel=channel,
                campaign_type=ctype,
                priority=int(priority),
                volume=int(volume),
                window=window,
                plan=plan,
                label=r["name"] or "",
                event_date=event_day,
                created_at=r["created_at"],
            ))

    out.context = PlanContext(
        prefill=compute_prefill(conn, now),
        closed_days=closed_days(now, now_local, config.horizon_days),
    )
    return out


def load_requests(conn, config: PlannerConfig, now: date) -> List[CampaignRequest]:
    """Back-compat wrapper (requests only)."""
    return load_plan_inputs(conn, config, now).requests


# --------------------------------------------------------------------------
# Persisting
# --------------------------------------------------------------------------
UNPLACED_REASON = "capacity_unplaced"
SNAPSHOT_MIN_SECONDS = int(os.getenv("PLANNER_RUN_SNAPSHOT_SECONDS", "60") or 60)
RUNS_RETENTION_DAYS = int(os.getenv("PLANNER_RUNS_RETENTION_DAYS", "7") or 7)
_last_snapshot = {"at": None}


def persist_plan(conn, result: PlanResult, config: PlannerConfig, now: date,
                 inputs: Optional[PlanInputs] = None) -> List[dict]:
    """Replace the pending release plan for every campaign in `result` (and the
    finalize/dead ones in `inputs`), and record a run snapshot. Releases already
    in flight (queued/sent) are never touched.

    The DELETE + INSERTs run in ONE transaction: the scheduler must never
    observe a campaign with its pending releases deleted but not yet
    re-inserted. Returns the ops alerts to record (after commit)."""
    prev_autocommit = conn.autocommit
    conn.autocommit = False
    try:
        alerts = _persist_plan_tx(conn, result, config, now, inputs or PlanInputs())
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.autocommit = prev_autocommit
    for a in alerts:
        _record_ops(a)
    return alerts


def _persist_plan_tx(conn, result: PlanResult, config: PlannerConfig, now: date,
                     inputs: PlanInputs) -> List[dict]:
    alerts: List[dict] = []
    planned_ids = [a.campaign_id for a in result.allocations]
    clear_ids = planned_ids + list(inputs.finalize_ids) + list(inputs.dead.keys())
    schedule_times = {cid: m.schedule_time for cid, m in inputs.meta.items()}
    missing = [cid for cid in planned_ids if cid not in schedule_times]
    if missing:
        with conn.cursor() as cur:
            cur.execute("SELECT id, schedule_time FROM campaigns WHERE id = ANY(%s::uuid[])", (missing,))
            schedule_times.update({str(r[0]): r[1] for r in cur.fetchall()})
    with conn.cursor() as cur:
        if clear_ids:
            # Clear only not-yet-released rows for these campaigns, then rewrite.
            cur.execute(
                "DELETE FROM campaign_releases WHERE status = 'pending' AND campaign_id = ANY(%s::uuid[])",
                (clear_ids,),
            )
        for alloc in result.allocations:
            meta = inputs.meta.get(alloc.campaign_id)
            ev_day = meta.event_day if meta else None
            sched = schedule_times.get(alloc.campaign_id)
            first = alloc.first_send
            last = alloc.last_send
            for day, count in sorted(alloc.by_day.items()):
                if count <= 0:
                    continue
                cur.execute(
                    """
                    INSERT INTO campaign_releases
                        (campaign_id, event_id, channel, release_date, release_at, target_date,
                         count, moved, status, is_final)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending', %s)
                    """,
                    (alloc.campaign_id, alloc.event_id, alloc.channel, day,
                     release_instant(day, sched, event_day=ev_day, target=alloc.target),
                     alloc.target, count, day != alloc.target,
                     bool(day == last and alloc.unplaced == 0)),
                )
            # planned_send_time = when the campaign begins sending (first batch).
            cur.execute(
                "UPDATE campaigns SET planned_send_time = %s WHERE id = %s",
                (release_instant(first, sched, event_day=ev_day, target=alloc.target) if first else None,
                 alloc.campaign_id),
            )
            prev_reason = meta.status_reason if meta else None
            if alloc.unplaced > 0:
                if prev_reason != UNPLACED_REASON:
                    cur.execute("UPDATE campaigns SET status_reason = %s WHERE id = %s AND status = 'pending'",
                                (UNPLACED_REASON, alloc.campaign_id))
                    urgent = meta is not None and (
                        meta.ctype in (CampaignType.LAST_REMINDER, CampaignType.REMINDER)
                        or (meta.deadline is not None and (meta.deadline - now).days <= 1))
                    alerts.append({
                        "severity": "critical" if urgent else "warning",
                        "error_type": "campaign_capacity_unplaced",
                        "event_id": alloc.event_id,
                        "message": (f"{alloc.unplaced} message(s) of campaign {alloc.campaign_id} do not fit "
                                    f"in WhatsApp daily capacity before its deadline "
                                    f"{meta.deadline if meta else '?'}"),
                        "context": {"campaign_id": alloc.campaign_id, "unplaced": alloc.unplaced,
                                    "placed": alloc.placed, "deadline": str(meta.deadline) if meta else None,
                                    "type": meta.ctype.value if meta else None},
                    })
            elif prev_reason == UNPLACED_REASON:
                cur.execute("UPDATE campaigns SET status_reason = NULL WHERE id = %s AND status_reason = %s",
                            (alloc.campaign_id, UNPLACED_REASON))

        if inputs.finalize_ids:
            # Started, nothing left, nothing in flight -> the finalizer resolves
            # 'sending' to sent/failed from the per-message outcomes.
            cur.execute(
                "UPDATE campaigns SET status = 'sending' WHERE status = 'pending' AND id = ANY(%s::uuid[])",
                (list(inputs.finalize_ids),),
            )

        for cid, meta in inputs.dead.items():
            if meta.deadline is not None and meta.deadline < now:
                # Can never be sent any more (its last allowed day has passed).
                reason = UNPLACED_REASON if meta.status_reason == UNPLACED_REASON else "deadline_passed"
                cur.execute(
                    "UPDATE campaigns SET status = %s, status_reason = %s, planned_send_time = NULL "
                    "WHERE id = %s AND status = 'pending'",
                    ("sending" if meta.has_messages else "failed", reason, cid),
                )
                alerts.append({
                    "severity": "critical", "error_type": "campaign_deadline_passed",
                    "message": f"campaign {cid} could not be sent before its deadline {meta.deadline} ({reason})",
                    "context": {"campaign_id": cid, "deadline": str(meta.deadline), "type": meta.ctype.value},
                })
            elif meta.status_reason != "scheduled_after_event":
                cur.execute("UPDATE campaigns SET status_reason = 'scheduled_after_event' "
                            "WHERE id = %s AND status = 'pending'", (cid,))
                alerts.append({
                    "severity": "warning", "error_type": "campaign_after_event",
                    "message": f"campaign {cid} ({meta.ctype.value}) is scheduled after its event date - not planned",
                    "context": {"campaign_id": cid, "event_day": str(meta.event_day)},
                })

        # Run snapshot for monitoring (throttled: the loop runs every ~20s).
        nowts = datetime.now(timezone.utc)
        last = _last_snapshot["at"]
        if last is None or (nowts - last).total_seconds() >= SNAPSHOT_MIN_SECONDS:
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
            _last_snapshot["at"] = nowts
    return alerts


def cleanup_planner_runs(conn, keep_days: int = RUNS_RETENTION_DAYS) -> int:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM planner_runs WHERE ran_at < NOW() - make_interval(days => %s)",
                    (int(keep_days),))
        return cur.rowcount or 0


def has_unplanned_due(conn, lookahead_seconds: int = 60) -> bool:
    """Cheap fast-path probe: a pending whatsapp campaign due (or about to be)
    with no pending/queued batch - i.e. a "send now" waiting for the planner."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM campaigns c JOIN events e ON e.id = c.event_id
            WHERE c.status = 'pending' AND c.schedule_time IS NOT NULL
              AND c.schedule_time <= NOW() + make_interval(secs => %s)
              AND e.active = true
              AND lower(trim(c.channel)) = 'whatsapp'
              AND lower(COALESCE(e.plan_id, '')) <> ALL(%s)
              AND COALESCE(c.status_reason, '') NOT IN ('capacity_unplaced', 'scheduled_after_event')
              AND NOT EXISTS (SELECT 1 FROM campaign_releases r
                              WHERE r.campaign_id = c.id AND r.status IN ('pending', 'queued'))
            LIMIT 1
            """,
            (int(lookahead_seconds), list(NON_AUTOSEND_PLANS)),
        )
        return cur.fetchone() is not None


def _record_ops(alert: dict) -> None:
    try:
        from shared.ops.errors import record_error
        record_error("planner", alert["message"], severity=alert.get("severity", "warning"),
                     error_type=alert.get("error_type"), event_id=alert.get("event_id"),
                     context=alert.get("context"))
    except Exception:
        logger.warning("ops alert not recorded: %s", alert.get("message"))


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
            "planned_total": sum(result.planned_load(channel).values()),
            "prefill": {d.isoformat(): v for d, v in (result.prefill.get(channel) or {}).items()},
            "heatmap": {d.isoformat(): v for d, v in heat.items()},
        }
    return {
        "strategy": result.strategy,
        "channels": channels,
        "safety_margin_percent": config.safety_margin_percent,
    }
