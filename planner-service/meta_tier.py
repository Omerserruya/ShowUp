"""Messaging tier + quality rating read from Meta (Graph API), hourly.

    GET https://graph.facebook.com/{ver}/{phone_number_id}?fields=messaging_limit_tier,quality_rating

The campaign phone number's tier is Meta's real cap on business-initiated
conversations (unique recipients) per rolling 24h. The planner packs against
min(env META_NEW_CONVERSATIONS_PER_24H, Meta tier); on any failure (no token,
network, unknown tier) it keeps the last known value, else the env value.

State lives in `planner_state` (one row, id=1) so the scheduler's rolling-24h
release guard uses the SAME capacity the planner planned with.

Env: WA_API_B (token), CAMPAIGN_WA_PHONE_ID or WA_PHONE_ID, META_GRAPH_VERSION
(default v22.0, same as outpost), META_TIER_REFRESH_SECONDS (default 3600).
"""
from __future__ import annotations

import json
import logging
import os
import urllib.request
from typing import Optional, Tuple

logger = logging.getLogger("planner.meta_tier")

TIER_LIMITS = {
    "TIER_50": 50,
    "TIER_250": 250,
    "TIER_1K": 1000,
    "TIER_2K": 2000,
    "TIER_10K": 10000,
    "TIER_100K": 100000,
    "TIER_UNLIMITED": 10_000_000,
}
BAD_QUALITY = {"YELLOW", "RED"}

REFRESH_SECONDS = int(os.getenv("META_TIER_REFRESH_SECONDS", "3600") or 3600)


def tier_limit(tier: Optional[str]) -> Optional[int]:
    if not tier:
        return None
    return TIER_LIMITS.get(str(tier).strip().upper())


def ensure_state_table(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS planner_state (
            id SMALLINT PRIMARY KEY DEFAULT 1,
            meta_tier VARCHAR(32),
            meta_tier_limit INTEGER,
            meta_quality VARCHAR(16),
            meta_checked_at TIMESTAMPTZ,
            meta_error TEXT,
            env_cap INTEGER,
            raw_capacity INTEGER,          -- min(env, meta) conversations / 24h
            planner_capacity INTEGER,      -- raw minus safety margin (what is planned/released)
            safety_margin_percent REAL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    cur.execute("INSERT INTO planner_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING")


def fetch_meta_tier(timeout: float = 10.0) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """(tier, quality_rating, error). Never raises."""
    token = (os.getenv("WA_API_B") or "").strip()
    phone_id = (os.getenv("CAMPAIGN_WA_PHONE_ID") or os.getenv("WA_PHONE_ID") or "").strip()
    if not token or not phone_id:
        return None, None, "WA_API_B / CAMPAIGN_WA_PHONE_ID|WA_PHONE_ID not configured"
    ver = (os.getenv("META_GRAPH_VERSION") or "v22.0").strip()
    url = f"https://graph.facebook.com/{ver}/{phone_id}?fields=whatsapp_business_manager_messaging_limit,messaging_limit_tier,quality_rating"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8") or "{}")
    except Exception as exc:
        return None, None, f"graph request failed: {type(exc).__name__}: {exc}"[:300]
    # Meta moved the tier to the business-portfolio level field (2025);
    # keep the legacy field as a fallback.
    tier = data.get("whatsapp_business_manager_messaging_limit") or data.get("messaging_limit_tier")
    quality = data.get("quality_rating")
    return (str(tier).upper() if tier else None, str(quality).upper() if quality else None,
            None if tier else "response had no messaging_limit_tier")


def refresh(conn, fetch=fetch_meta_tier) -> dict:
    """Fetch from Meta and persist into planner_state. Records an ops error when
    the quality rating changes to YELLOW/RED (or the tier drops). Returns the
    stored row as a dict."""
    tier, quality, error = fetch()
    with conn.cursor() as cur:
        ensure_state_table(cur)
        cur.execute("SELECT meta_tier, meta_quality FROM planner_state WHERE id = 1")
        prev_tier, prev_quality = cur.fetchone() or (None, None)
        if tier and tier_limit(tier) is not None:
            cur.execute(
                """
                UPDATE planner_state
                SET meta_tier = %s, meta_tier_limit = %s, meta_quality = COALESCE(%s, meta_quality),
                    meta_checked_at = NOW(), meta_error = NULL, updated_at = NOW()
                WHERE id = 1
                """,
                (tier, tier_limit(tier), quality),
            )
        else:
            cur.execute(
                "UPDATE planner_state SET meta_checked_at = NOW(), meta_error = %s, updated_at = NOW() WHERE id = 1",
                (error or f"unknown tier {tier!r}",),
            )
            logger.warning("meta tier refresh failed: %s", error or tier)
    if quality and quality in BAD_QUALITY and quality != (prev_quality or "").upper():
        _ops("WhatsApp quality rating is %s (was %s)" % (quality, prev_quality or "unknown"),
             "critical" if quality == "RED" else "warning", "meta_quality_rating",
             {"quality": quality, "previous": prev_quality, "tier": tier})
    if tier and prev_tier and tier_limit(tier) is not None and tier_limit(prev_tier) is not None \
            and tier_limit(tier) < tier_limit(prev_tier):
        _ops(f"WhatsApp messaging tier dropped {prev_tier} -> {tier}", "warning", "meta_tier_drop",
             {"tier": tier, "previous": prev_tier})
    return {"tier": tier, "quality": quality, "error": error}


def known_limit(conn) -> Tuple[Optional[int], Optional[str], Optional[str]]:
    """Last stored (tier_limit, tier, quality) - None when never fetched."""
    try:
        with conn.cursor() as cur:
            ensure_state_table(cur)
            cur.execute("SELECT meta_tier_limit, meta_tier, meta_quality FROM planner_state WHERE id = 1")
            row = cur.fetchone()
        return (row[0], row[1], row[2]) if row else (None, None, None)
    except Exception as exc:
        logger.warning("planner_state read failed: %s", exc)
        return None, None, None


def store_capacity(conn, env_cap: int, raw: int, planner_cap: int, margin: float) -> None:
    try:
        with conn.cursor() as cur:
            ensure_state_table(cur)
            cur.execute(
                """
                UPDATE planner_state
                SET env_cap = %s, raw_capacity = %s, planner_capacity = %s,
                    safety_margin_percent = %s, updated_at = NOW()
                WHERE id = 1
                """,
                (int(env_cap), int(raw), int(planner_cap), float(margin)),
            )
    except Exception as exc:
        logger.warning("planner_state capacity write failed: %s", exc)


def _ops(message, severity, error_type, context):
    try:
        from shared.ops.errors import record_error
        record_error("planner", message, severity=severity, error_type=error_type, context=context)
    except Exception:
        pass
