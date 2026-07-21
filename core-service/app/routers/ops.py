"""Internal Operations dashboard API (admin only).

One place to answer: is ShowUp healthy, are customers succeeding, is anything
broken, what needs attention now. Every service writes to one shared Postgres, so
almost every metric here is a SQL aggregation over live data - events, guests,
messages_sent (the delivery source of truth), orders, campaigns, conversations,
audit_log, entitlements, owner_notifications - plus:

* worker liveness from `service_heartbeats` (real heartbeats, not activity guesses),
* captured failures from `ops_errors`,
* infra reachability by socket probe (Redis / RabbitMQ) and SELECT 1 (Postgres),
* host CPU/RAM/disk + API latency from `app.ops_metrics`.

All endpoints are admin-gated. This is not customer-facing.
"""
from __future__ import annotations

import os
import socket
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.ops_metrics import host_metrics, latency_stats
from shared.auth.admin import get_admin_user_id

router = APIRouter(prefix="/admin/ops", tags=["admin-ops"])

# Local business day for "today" metrics (matches the daily-summary timezone).
_TZ = os.getenv("OPS_TIMEZONE", "Asia/Jerusalem")

# Services expected to be running, with the label the dashboard shows.
EXPECTED_SERVICES = [
    ("core", "Core API"),
    ("aub", "Auth / Billing"),
    ("assistant-worker", "Assistant Worker"),
    ("campaign-worker", "Campaign Worker"),
    ("outpost", "Outpost"),
    ("planner", "Planner"),
    ("scheduler", "Scheduler"),
    ("webhook-handler", "Webhook Handler"),
    ("webhook-worker", "Webhook Worker"),
    ("contact-import-worker", "Contact Import Worker"),
]

# Heartbeat freshness thresholds (heartbeat interval is ~20s).
_HEALTHY_SECONDS = 60
_WARNING_SECONDS = 180


def _today(col: str) -> str:
    """SQL predicate: `col` falls on the current LOCAL business day."""
    return (f"({col} AT TIME ZONE '{_TZ}')::date = (NOW() AT TIME ZONE '{_TZ}')::date")


def _scalar(db: Session, sql: str, **params) -> int:
    return int(db.execute(text(sql), params).scalar() or 0)


def _table_exists(db: Session, name: str) -> bool:
    return bool(db.execute(text("SELECT to_regclass(:n)"), {"n": name}).scalar())


# --------------------------------------------------------------------------
# Section builders (each returns a plain dict; combined by /summary)
# --------------------------------------------------------------------------

def _overview(db: Session) -> Dict[str, Any]:
    row = db.execute(text(f"""
        SELECT
          COUNT(*) FILTER (WHERE active) AS active_events,
          COUNT(*) FILTER (WHERE {_today('created_at')}) AS events_today,
          COUNT(*) FILTER (WHERE payment_status = 'pending') AS waiting_payment,
          COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_events,
          COUNT(*) FILTER (WHERE active AND event_date IS NOT NULL
                           AND event_date BETWEEN NOW() AND NOW() + INTERVAL '7 days') AS upcoming_7d,
          COUNT(*) FILTER (WHERE state IN ('completed','archived')
                           OR (event_date IS NOT NULL AND event_date < NOW())) AS finished_events
        FROM events
    """)).mappings().first()

    guests = db.execute(text(f"""
        SELECT
          COUNT(*) AS total_guests,
          COUNT(*) FILTER (WHERE {_today('created_at')}) AS imported_today,
          COUNT(*) FILTER (WHERE status IN ('confirmed','attending')) AS confirmed,
          COUNT(*) FILTER (WHERE status IN ('confirmed','attending','declined','maybe')) AS responded
        FROM guests
    """)).mappings().first()

    sent_today = _scalar(db, f"""
        SELECT COUNT(*) FROM messages_sent
        WHERE status IN ('accepted','delivered','read') AND {_today('sent_at')}
    """) if _table_exists(db, "messages_sent") else 0
    failed_today = _scalar(db, f"""
        SELECT COUNT(*) FROM messages_sent
        WHERE status = 'failed' AND {_today('sent_at')}
    """) if _table_exists(db, "messages_sent") else 0

    dau = 0
    if _table_exists(db, "audit_log"):
        dau = _scalar(db, f"""
            SELECT COUNT(DISTINCT actor_id) FROM audit_log
            WHERE actor_type = 'user' AND actor_id IS NOT NULL AND {_today('occurred_at')}
        """)

    total = int(guests["total_guests"] or 0)
    confirmed = int(guests["confirmed"] or 0)
    responded = int(guests["responded"] or 0)
    return {
        "active_events": int(row["active_events"] or 0),
        "events_today": int(row["events_today"] or 0),
        "waiting_payment": int(row["waiting_payment"] or 0),
        "paid_events": int(row["paid_events"] or 0),
        "upcoming_7d": int(row["upcoming_7d"] or 0),
        "finished_events": int(row["finished_events"] or 0),
        "total_guests": total,
        "guests_imported_today": int(guests["imported_today"] or 0),
        "rsvp_rate": round(100.0 * confirmed / responded, 1) if responded else 0.0,
        "rsvp_rate_of_all": round(100.0 * confirmed / total, 1) if total else 0.0,
        "messages_sent_today": sent_today,
        "messages_failed_today": failed_today,
        "daily_active_users": dau,
    }


def _payments(db: Session) -> Dict[str, Any]:
    if not _table_exists(db, "orders"):
        return {"pending": 0, "completed": 0, "completed_today": 0, "failed": 0, "expired": 0, "refunds": None}
    row = db.execute(text(f"""
        SELECT
          COUNT(*) FILTER (WHERE status = 'payment_pending') AS pending,
          COUNT(*) FILTER (WHERE status = 'paid') AS completed,
          COUNT(*) FILTER (WHERE status = 'paid' AND {_today('updated_at')}) AS completed_today,
          COUNT(*) FILTER (WHERE status = 'underpaid') AS failed,
          COUNT(*) FILTER (WHERE status = 'payment_pending' AND updated_at < NOW() - INTERVAL '24 hours') AS expired
        FROM orders
    """)).mappings().first()
    return {
        "pending": int(row["pending"] or 0),
        "completed": int(row["completed"] or 0),
        "completed_today": int(row["completed_today"] or 0),
        "failed": int(row["failed"] or 0),
        "expired": int(row["expired"] or 0),
        "refunds": None,  # future
    }


def _whatsapp(db: Session) -> Dict[str, Any]:
    if not _table_exists(db, "messages_sent"):
        return {"sent": 0, "delivered": 0, "failed": 0, "meta_errors": 0, "template_errors": 0,
                "opt_outs": 0, "opt_outs_today": 0, "quality_rating": None}
    row = db.execute(text(f"""
        SELECT
          COUNT(*) FILTER (WHERE status IN ('accepted','delivered','read') AND {_today('sent_at')}) AS sent,
          COUNT(*) FILTER (WHERE status IN ('delivered','read') AND {_today('sent_at')}) AS delivered,
          COUNT(*) FILTER (WHERE status = 'failed' AND {_today('sent_at')}) AS failed,
          COUNT(*) FILTER (WHERE status = 'failed' AND error_code LIKE 'http_%' AND {_today('sent_at')}) AS meta_errors,
          COUNT(*) FILTER (WHERE status = 'failed' AND error_code = 'build_failed' AND {_today('sent_at')}) AS template_errors
        FROM messages_sent
    """)).mappings().first()
    optouts = db.execute(text(f"""
        SELECT COUNT(*) FILTER (WHERE opted_out_at IS NOT NULL) AS total,
               COUNT(*) FILTER (WHERE opted_out_at IS NOT NULL AND {_today('opted_out_at')}) AS today
        FROM guests
    """)).mappings().first() if _table_exists(db, "guests") else {"total": 0, "today": 0}
    return {
        "sent": int(row["sent"] or 0),
        "delivered": int(row["delivered"] or 0),
        "failed": int(row["failed"] or 0),
        "meta_errors": int(row["meta_errors"] or 0),
        "template_errors": int(row["template_errors"] or 0),
        "opt_outs": int(optouts["total"] or 0),
        "opt_outs_today": int(optouts["today"] or 0),
        "quality_rating": None,  # future (Meta WABA quality is not exposed to us here)
    }


def _assistant(db: Session) -> Dict[str, Any]:
    out = {"conversations": 0, "questions_today": 0, "actions_executed": 0,
           "actions_today": 0, "failed_actions": 0, "avg_response_ms": None}
    if _table_exists(db, "audit_log"):
        r = db.execute(text(f"""
            SELECT
              COUNT(*) FILTER (WHERE action = 'assistant.turn') AS turns,
              COUNT(*) FILTER (WHERE action = 'assistant.turn' AND {_today('occurred_at')}) AS turns_today,
              COUNT(*) FILTER (WHERE actor_type = 'assistant' AND action <> 'assistant.turn') AS actions,
              COUNT(*) FILTER (WHERE actor_type = 'assistant' AND action <> 'assistant.turn'
                               AND {_today('occurred_at')}) AS actions_today,
              COUNT(DISTINCT account_id) FILTER (WHERE actor_type = 'assistant') AS conversations,
              AVG( (data->>'duration_ms')::float ) FILTER (
                   WHERE action = 'assistant.turn' AND {_today('occurred_at')}
                   AND (data->>'duration_ms') IS NOT NULL) AS avg_ms
            FROM audit_log
        """)).mappings().first()
        out.update({
            "conversations": int(r["conversations"] or 0),
            "questions_today": int(r["turns_today"] or 0),
            "actions_executed": int(r["actions"] or 0),
            "actions_today": int(r["actions_today"] or 0),
            "avg_response_ms": round(float(r["avg_ms"]), 0) if r["avg_ms"] is not None else None,
        })
    if _table_exists(db, "ops_errors"):
        out["failed_actions"] = _scalar(db, f"""
            SELECT COUNT(*) FROM ops_errors
            WHERE service = 'assistant' AND {_today('occurred_at')}
        """)
    return out


def _health(db: Session) -> Dict[str, Any]:
    beats = {}
    if _table_exists(db, "service_heartbeats"):
        for r in db.execute(text("""
            SELECT service, version, started_at,
                   EXTRACT(EPOCH FROM (NOW() - last_beat)) AS age,
                   last_beat, started_at
            FROM service_heartbeats
        """)).mappings():
            beats[r["service"]] = r

    def classify(age: Optional[float]) -> str:
        if age is None:
            return "offline"
        if age <= _HEALTHY_SECONDS:
            return "healthy"
        if age <= _WARNING_SECONDS:
            return "warning"
        return "offline"

    services: List[Dict[str, Any]] = []
    for key, label in EXPECTED_SERVICES:
        b = beats.get(key)
        age = float(b["age"]) if b else None
        services.append({
            "service": key, "label": label,
            "status": classify(age),
            "last_beat": b["last_beat"].isoformat() if b and b["last_beat"] else None,
            "last_restart": b["started_at"].isoformat() if b and b["started_at"] else None,
            "version": (b["version"] if b else None),
            "heartbeat_age_seconds": round(age) if age is not None else None,
        })

    # Infra reachability.
    def probe(host: Optional[str], port: Optional[str]) -> str:
        if not host or not port:
            return "unknown"
        try:
            with socket.create_connection((host, int(port)), timeout=1.5):
                return "healthy"
        except Exception:
            return "offline"

    # Postgres: we are answering on it, so it's up; confirm with a trivial read.
    pg = "healthy"
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        pg = "offline"

    infra = [
        {"service": "postgres", "label": "PostgreSQL", "status": pg},
        {"service": "redis", "label": "Redis",
         "status": probe(os.getenv("REDIS_HOST"), os.getenv("REDIS_PORT"))},
        {"service": "rabbitmq", "label": "RabbitMQ",
         "status": probe(os.getenv("RABBITMQ_HOST"), os.getenv("RABBITMQ_PORT"))},
    ]

    backlog = _queue_backlog(db)
    return {"services": services, "infra": infra, "queue_backlog": backlog}


def _queue_backlog(db: Session) -> Dict[str, Any]:
    """Work waiting in the pipeline - a DB-derived proxy for queue depth that
    needs no broker credentials in core. These are the numbers an operator cares
    about: messages queued but not yet sent, notifications not yet delivered,
    campaign batches due but unreleased."""
    queued_msgs = _scalar(db, """
        SELECT COUNT(*) FROM messages_sent
        WHERE status = 'queued' AND sent_at < NOW() - INTERVAL '2 minutes'
    """) if _table_exists(db, "messages_sent") else 0
    pending_notif = _scalar(db, """
        SELECT COUNT(*) FROM owner_notifications WHERE status = 'pending'
    """) if _table_exists(db, "owner_notifications") else 0
    due_releases = 0
    if _table_exists(db, "campaign_releases"):
        due_releases = _scalar(db, """
            SELECT COUNT(*) FROM campaign_releases
            WHERE status = 'pending' AND release_date <= (NOW() AT TIME ZONE 'UTC')::date
        """)
    total = queued_msgs + pending_notif + due_releases
    return {"total": total, "stuck_messages": queued_msgs,
            "pending_notifications": pending_notif, "due_campaign_batches": due_releases}


def _system_metrics(db: Session) -> Dict[str, Any]:
    """Host resources + derived pipeline latencies."""
    avg_send_ms = None
    if _table_exists(db, "messages_sent"):
        v = db.execute(text(f"""
            SELECT AVG(EXTRACT(EPOCH FROM (updated_at - sent_at)) * 1000)
            FROM messages_sent
            WHERE status IN ('accepted','delivered','read')
              AND updated_at IS NOT NULL AND {_today('sent_at')}
        """)).scalar()
        avg_send_ms = round(float(v)) if v is not None else None
    avg_assistant_ms = None
    if _table_exists(db, "audit_log"):
        v = db.execute(text(f"""
            SELECT AVG((data->>'duration_ms')::float) FROM audit_log
            WHERE action = 'assistant.turn' AND (data->>'duration_ms') IS NOT NULL AND {_today('occurred_at')}
        """)).scalar()
        avg_assistant_ms = round(float(v)) if v is not None else None
    return {
        "host": host_metrics(),
        "api_latency": latency_stats(),
        "avg_campaign_send_ms": avg_send_ms,
        "avg_assistant_response_ms": avg_assistant_ms,
    }


def _alerts(db: Session, health: Dict[str, Any], payments: Dict[str, Any],
            whatsapp: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Live, derived alerts - only the ones currently firing. Each is
    {level, key, title, detail, count}."""
    alerts: List[Dict[str, Any]] = []

    # Offline workers.
    offline = [s["label"] for s in health["services"] if s["status"] == "offline"]
    if offline:
        alerts.append({"level": "critical", "key": "offline_workers",
                       "title": "Offline workers", "count": len(offline),
                       "detail": ", ".join(offline)})
    offline_infra = [s["label"] for s in health["infra"] if s["status"] == "offline"]
    if offline_infra:
        alerts.append({"level": "critical", "key": "database_errors" if "PostgreSQL" in offline_infra else "infra_offline",
                       "title": "Infrastructure offline", "count": len(offline_infra),
                       "detail": ", ".join(offline_infra)})

    # Payment failures.
    if payments.get("failed") or payments.get("expired"):
        alerts.append({"level": "warning", "key": "payment_failures",
                       "title": "Payment issues",
                       "count": (payments.get("failed", 0) + payments.get("expired", 0)),
                       "detail": f"{payments.get('failed',0)} underpaid, {payments.get('expired',0)} stale orders"})

    # High WhatsApp failure rate (needs minimum volume to be meaningful).
    sent, failed = whatsapp.get("sent", 0), whatsapp.get("failed", 0)
    if failed and (sent + failed) >= 20:
        rate = 100.0 * failed / (sent + failed)
        if rate >= 20:
            alerts.append({"level": "warning", "key": "high_wa_failure_rate",
                           "title": "High WhatsApp failure rate", "count": failed,
                           "detail": f"{rate:.0f}% of today's messages failed"})

    # Queue backlog.
    backlog = health["queue_backlog"]
    if backlog["total"] >= 100:
        alerts.append({"level": "warning", "key": "queue_backlog",
                       "title": "Queue backlog", "count": backlog["total"],
                       "detail": f"{backlog['stuck_messages']} stuck messages, "
                                 f"{backlog['pending_notifications']} pending notifications"})

    # Campaign failures (recent) + captured errors by class.
    if _table_exists(db, "campaigns"):
        failed_campaigns = _scalar(db, """
            SELECT COUNT(*) FROM campaigns
            WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '24 hours'
        """)
        if failed_campaigns:
            alerts.append({"level": "warning", "key": "campaign_failures",
                           "title": "Failed campaigns (24h)", "count": failed_campaigns,
                           "detail": f"{failed_campaigns} campaign(s) delivered nothing"})

    if _table_exists(db, "ops_errors"):
        for key, title, where in (
            ("webhook_failures", "Webhook failures", "service IN ('webhook-handler','webhook-worker')"),
            ("database_errors", "Database errors", "error_type ILIKE '%db%' OR error_type ILIKE '%operational%'"),
        ):
            n = _scalar(db, f"""
                SELECT COUNT(*) FROM ops_errors
                WHERE NOT resolved AND occurred_at > NOW() - INTERVAL '24 hours' AND ({where})
            """)
            if n:
                alerts.append({"level": "warning", "key": key, "title": title,
                               "count": n, "detail": f"{n} unresolved in the last 24h"})

    # Sort: critical first, then by count.
    alerts.sort(key=lambda a: (0 if a["level"] == "critical" else 1, -a["count"]))
    return alerts


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------

@router.get("/summary")
def ops_summary(db: Session = Depends(get_db), admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """The whole top-of-dashboard in one poll: overview, health, alerts,
    payments, WhatsApp (today), assistant, system metrics."""
    health = _health(db)
    payments = _payments(db)
    whatsapp = _whatsapp(db)
    return {
        "overview": _overview(db),
        "health": health,
        "payments": payments,
        "whatsapp": whatsapp,
        "assistant": _assistant(db),
        "system": _system_metrics(db),
        "alerts": _alerts(db, health, payments, whatsapp),
        "generated_at": db.execute(text("SELECT NOW()")).scalar().isoformat(),
    }


@router.get("/events")
def ops_events(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None, description="active | paid | pending | finished"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    """Active-events operational table with search + filter."""
    where = ["1=1"]
    params: Dict[str, Any] = {}
    if search:
        where.append("e.name ILIKE :q")
        params["q"] = f"%{search}%"
    if status == "active":
        where.append("e.active")
    elif status == "paid":
        where.append("e.payment_status = 'paid'")
    elif status == "pending":
        where.append("e.payment_status = 'pending'")
    elif status == "finished":
        where.append("(e.state IN ('completed','archived') OR (e.event_date IS NOT NULL AND e.event_date < NOW()))")
    where_sql = " AND ".join(where)

    total = _scalar(db, f"SELECT COUNT(*) FROM events e WHERE {where_sql}", **params)
    params.update({"limit": page_size, "offset": (page - 1) * page_size})

    rows = db.execute(text(f"""
        SELECT e.id, e.name, e.plan_id, e.payment_status, e.active, e.state,
               e.event_date, e.account_id, e.owners, e.updated_at,
               a.name AS venue_name, a.type AS account_type,
               (SELECT COUNT(*) FROM guests g WHERE g.event_id::text = e.id::text) AS guests,
               (SELECT COUNT(*) FROM guests g WHERE g.event_id::text = e.id::text
                  AND g.status IN ('confirmed','attending')) AS confirmed,
               (SELECT COALESCE(SUM(quantity),0) FROM usage_events u
                  WHERE u.event_id = e.id AND u.metric = 'round_launched') AS rounds_used,
               (SELECT MAX(COALESCE(g.last_response, g.created_at)) FROM guests g WHERE g.event_id::text = e.id::text) AS last_guest_activity
        FROM events e
        LEFT JOIN accounts a ON a.id = e.account_id
        WHERE {where_sql}
        ORDER BY e.updated_at DESC NULLS LAST, e.created_at DESC
        LIMIT :limit OFFSET :offset
    """), params).mappings().all()

    event_ids = [str(r["id"]) for r in rows]
    # Messages sent per event (via that event's campaigns) in one query.
    sent_by_event: Dict[str, int] = {}
    if event_ids and _table_exists(db, "messages_sent") and _table_exists(db, "campaigns"):
        for r in db.execute(text("""
            SELECT c.event_id::text AS eid, COUNT(*) AS n
            FROM messages_sent m JOIN campaigns c ON c.id = m.campaign_id
            WHERE c.event_id::text = ANY(:ids)
              AND m.status IN ('accepted','delivered','read')
            GROUP BY c.event_id
        """), {"ids": event_ids}).mappings():
            sent_by_event[r["eid"]] = int(r["n"])

    # Owner names (owners live in aub; resolve in one batch).
    owner_ids = []
    for r in rows:
        owners = r["owners"] or []
        if owners:
            owner_ids.append(str(owners[0]))
    from app import user_directory
    names = user_directory.resolve_users_by_ids(
        [uuid.UUID(i) for i in set(owner_ids)]) if owner_ids else {}

    items = []
    for r in rows:
        guests = int(r["guests"] or 0)
        confirmed = int(r["confirmed"] or 0)
        owners = r["owners"] or []
        owner = names.get(str(owners[0])) if owners else None
        owner_name = (f"{(owner or {}).get('first_name') or ''} "
                      f"{(owner or {}).get('last_name') or ''}".strip() or None) if owner else None
        # Health heuristic for the event.
        health = "ok"
        if r["payment_status"] == "pending":
            health = "waiting_payment"
        elif not r["active"]:
            health = "inactive"
        elif guests == 0:
            health = "no_guests"
        items.append({
            "id": str(r["id"]),
            "name": r["name"],
            "owner_name": owner_name,
            "owner_phone": (owner or {}).get("phone") if owner else None,
            "venue_name": r["venue_name"] if r["account_type"] == "venue" else None,
            "plan_id": r["plan_id"],
            "payment_status": r["payment_status"],
            "active": bool(r["active"]),
            "state": r["state"],
            "guests": guests,
            "rsvp_rate": round(100.0 * confirmed / guests, 1) if guests else 0.0,
            "rounds_used": int(r["rounds_used"] or 0),
            "messages_sent": sent_by_event.get(str(r["id"]), 0),
            "last_activity": r["last_guest_activity"].isoformat() if r["last_guest_activity"] else (
                r["updated_at"].isoformat() if r["updated_at"] else None),
            "event_date": r["event_date"].isoformat() if r["event_date"] else None,
            "health": health,
        })
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@router.get("/whatsapp/timeseries")
def ops_whatsapp_timeseries(
    range: str = Query("24h", pattern="^(24h|7d)$"),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    """Sent vs failed message counts over time, for the WhatsApp charts."""
    if not _table_exists(db, "messages_sent"):
        return {"range": range, "points": []}
    if range == "24h":
        bucket, since = "hour", "24 hours"
    else:
        bucket, since = "day", "7 days"
    rows = db.execute(text(f"""
        SELECT date_trunc('{bucket}', sent_at AT TIME ZONE '{_TZ}') AS ts,
               COUNT(*) FILTER (WHERE status IN ('accepted','delivered','read')) AS sent,
               COUNT(*) FILTER (WHERE status = 'delivered' OR status = 'read') AS delivered,
               COUNT(*) FILTER (WHERE status = 'failed') AS failed
        FROM messages_sent
        WHERE sent_at > NOW() - INTERVAL '{since}'
        GROUP BY 1 ORDER BY 1
    """)).mappings().all()
    return {"range": range, "points": [
        {"ts": r["ts"].isoformat(), "sent": int(r["sent"]),
         "delivered": int(r["delivered"]), "failed": int(r["failed"])}
        for r in rows
    ]}


@router.get("/errors")
def ops_errors(
    resolved: Optional[bool] = Query(None),
    service: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    """Latest captured platform errors."""
    if not _table_exists(db, "ops_errors"):
        return {"total": 0, "items": []}
    where = ["1=1"]
    params: Dict[str, Any] = {}
    if resolved is not None:
        where.append("resolved = :resolved")
        params["resolved"] = resolved
    if service:
        where.append("service = :service")
        params["service"] = service
    where_sql = " AND ".join(where)
    total = _scalar(db, f"SELECT COUNT(*) FROM ops_errors WHERE {where_sql}", **params)
    params.update({"limit": page_size, "offset": (page - 1) * page_size})
    rows = db.execute(text(f"""
        SELECT id, occurred_at, service, severity, message, error_type,
               event_id, user_id, stack, context, resolved, resolved_at
        FROM ops_errors WHERE {where_sql}
        ORDER BY occurred_at DESC LIMIT :limit OFFSET :offset
    """), params).mappings().all()
    return {"total": total, "page": page, "page_size": page_size, "items": [
        {
            "id": int(r["id"]),
            "time": r["occurred_at"].isoformat(),
            "service": r["service"], "severity": r["severity"],
            "error": r["message"], "error_type": r["error_type"],
            "event_id": str(r["event_id"]) if r["event_id"] else None,
            "user_id": str(r["user_id"]) if r["user_id"] else None,
            "stack": r["stack"], "context": r["context"] or {},
            "resolved": bool(r["resolved"]),
            "resolved_at": r["resolved_at"].isoformat() if r["resolved_at"] else None,
        } for r in rows
    ]}


@router.post("/errors/{error_id}/resolve")
def resolve_error(
    error_id: int,
    resolved: bool = Query(True),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    if not _table_exists(db, "ops_errors"):
        raise HTTPException(status_code=404, detail="no errors table")
    r = db.execute(text("""
        UPDATE ops_errors
        SET resolved = :res, resolved_at = CASE WHEN :res THEN NOW() ELSE NULL END,
            resolved_by = CASE WHEN :res THEN CAST(:admin AS UUID) ELSE NULL END
        WHERE id = :id RETURNING id
    """), {"res": resolved, "admin": str(admin_id), "id": error_id}).first()
    db.commit()
    if not r:
        raise HTTPException(status_code=404, detail="error not found")
    return {"id": error_id, "resolved": resolved}


@router.get("/search")
def ops_search(
    q: str = Query(..., min_length=2, max_length=100),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    """Global operational search across events, owners, guests, payments, campaigns."""
    like = f"%{q.strip()}%"
    digits = "".join(ch for ch in q if ch.isdigit())
    phone_like = f"%{digits}%" if len(digits) >= 4 else None
    out: Dict[str, List[Dict[str, Any]]] = {
        "events": [], "owners": [], "guests": [], "payments": [], "campaigns": []}

    for r in db.execute(text("""
        SELECT id, name, plan_id, payment_status, event_date
        FROM events WHERE name ILIKE :like OR public_slug ILIKE :like
        ORDER BY updated_at DESC LIMIT 10
    """), {"like": like}).mappings():
        out["events"].append({"id": str(r["id"]), "name": r["name"],
                              "plan_id": r["plan_id"], "payment_status": r["payment_status"],
                              "event_date": r["event_date"].isoformat() if r["event_date"] else None})

    # Owners live in aub's users table (same DB).
    if _table_exists(db, "users"):
        conds = ["first_name ILIKE :like", "last_name ILIKE :like", "email ILIKE :like"]
        params = {"like": like}
        if phone_like:
            conds.append("phone ILIKE :phone")
            params["phone"] = phone_like
        for r in db.execute(text(f"""
            SELECT id, first_name, last_name, phone, email FROM users
            WHERE {' OR '.join(conds)} LIMIT 10
        """), params).mappings():
            out["owners"].append({"id": str(r["id"]),
                                  "name": f"{r['first_name'] or ''} {r['last_name'] or ''}".strip(),
                                  "phone": r["phone"], "email": r["email"]})

    if _table_exists(db, "guests"):
        conds = ["name ILIKE :like", "email ILIKE :like"]
        params = {"like": like}
        if phone_like:
            conds.append("phone ILIKE :phone")
            params["phone"] = phone_like
        for r in db.execute(text(f"""
            SELECT id, event_id, name, phone, email, status FROM guests
            WHERE {' OR '.join(conds)} ORDER BY created_at DESC LIMIT 10
        """), params).mappings():
            out["guests"].append({"id": str(r["id"]), "event_id": str(r["event_id"]),
                                  "name": r["name"], "phone": r["phone"],
                                  "email": r["email"], "status": r["status"]})

    if _table_exists(db, "orders"):
        conds = ["event_name ILIKE :like", "email ILIKE :like", "order_id::text ILIKE :like"]
        params = {"like": like}
        if phone_like:
            conds.append("phone ILIKE :phone")
            params["phone"] = phone_like
        for r in db.execute(text(f"""
            SELECT order_id, event_name, plan, status, phone, order_date FROM orders
            WHERE {' OR '.join(conds)} ORDER BY order_date DESC LIMIT 10
        """), params).mappings():
            out["payments"].append({"id": str(r["order_id"]), "event_name": r["event_name"],
                                    "plan": r["plan"], "status": r["status"], "phone": r["phone"],
                                    "date": r["order_date"].isoformat() if r["order_date"] else None})

    if _table_exists(db, "campaigns"):
        for r in db.execute(text("""
            SELECT id, event_id, name, status, recipient_count FROM campaigns
            WHERE name ILIKE :like ORDER BY updated_at DESC LIMIT 10
        """), {"like": like}).mappings():
            out["campaigns"].append({"id": str(r["id"]), "event_id": str(r["event_id"]),
                                    "name": r["name"], "status": r["status"],
                                    "recipient_count": int(r["recipient_count"] or 0)})

    return out
