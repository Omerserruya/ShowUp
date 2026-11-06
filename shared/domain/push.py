"""Mobile push notifications (the Android/iOS app wraps the website).

The app registers its Firebase token after login (core: POST /push/devices ->
`push_devices`). Anything that wants to tell an owner something INSERTs into
`push_outbox` through `queue_push` / `queue_push_for_event`; scheduler-service
drains the outbox each cycle and sends through Firebase Cloud Messaging.

Rows are queued only for users who have a registered device, so nothing piles
up before anyone installs the app. Sending is off until FCM_SERVICE_ACCOUNT_B64
(the Firebase service-account JSON, base64) is set.

Works with any DB-API (psycopg2) cursor, plain or RealDict.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import time
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger("push")

DEVICES_SQL = """
CREATE TABLE IF NOT EXISTS push_devices (
    token TEXT PRIMARY KEY,
    user_id UUID NOT NULL,
    platform VARCHAR(16) NOT NULL DEFAULT 'android',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""
OUTBOX_SQL = """
CREATE TABLE IF NOT EXISTS push_outbox (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT,
    event_id UUID,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    dedupe_key VARCHAR(200) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ
)
"""
INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices (user_id)",
    "CREATE INDEX IF NOT EXISTS idx_push_outbox_pending ON push_outbox (created_at) WHERE status = 'pending'",
)

MAX_ATTEMPTS = 5
BATCH_SIZE = 100
# Pending rows older than this are dropped, not sent: a "guest confirmed" push
# a day late is noise.
STALE_HOURS = 12


def ensure_tables(cur) -> None:
    cur.execute(DEVICES_SQL)
    cur.execute(OUTBOX_SQL)
    for sql in INDEX_SQL:
        cur.execute(sql)


def _first(row) -> Any:
    if row is None:
        return None
    return next(iter(row.values())) if isinstance(row, dict) else row[0]


def register_device(cur, user_id: str, token: str, platform: str = "android") -> None:
    """Bind a device token to a user (a phone that switches account moves with it)."""
    ensure_tables(cur)
    cur.execute(
        """INSERT INTO push_devices (token, user_id, platform) VALUES (%s, %s, %s)
           ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id,
               platform = EXCLUDED.platform, last_seen_at = now()""",
        (token, str(user_id), (platform or "android")[:16]),
    )


def unregister_device(cur, token: str) -> None:
    ensure_tables(cur)
    cur.execute("DELETE FROM push_devices WHERE token = %s", (token,))


def queue_push(cur, user_ids: Iterable[str], title: str, body: str, *, url: Optional[str] = None,
               event_id: Optional[str] = None, dedupe_key: Optional[str] = None) -> int:
    """Queue one push per user that has a device. Returns how many were queued."""
    ids = sorted({str(u) for u in user_ids if u})
    if not ids:
        return 0
    cur.execute("SELECT to_regclass('public.push_devices') IS NOT NULL AS ok")
    if not _first(cur.fetchone()):
        return 0  # no app installed anywhere yet
    ensure_tables(cur)
    cur.execute(
        """INSERT INTO push_outbox (user_id, title, body, url, event_id, dedupe_key)
           SELECT DISTINCT d.user_id, %s, %s, %s, %s::uuid,
                  CASE WHEN %s::text IS NULL THEN NULL ELSE %s || ':' || d.user_id END
           FROM push_devices d WHERE d.user_id::text = ANY(%s)
           ON CONFLICT (dedupe_key) DO NOTHING""",
        (title[:120], body[:400], url, event_id, dedupe_key, dedupe_key, ids),
    )
    return cur.rowcount or 0


def event_owner_ids(cur, event_id: str) -> List[str]:
    cur.execute("SELECT owners FROM events WHERE id = %s", (str(event_id),))
    owners = _first(cur.fetchone())
    if isinstance(owners, str):
        try:
            owners = json.loads(owners)
        except ValueError:
            owners = []
    return [str(o) for o in (owners or []) if o]


def event_url(event_id: Optional[str], path: str) -> str:
    """App deep link: the app selects the event, then opens the page."""
    return f"{path}?event={event_id}" if event_id else path


def queue_push_for_event(cur, event_id: str, title: str, body: str, *, path: str = "/overview",
                         dedupe_key: Optional[str] = None) -> int:
    return queue_push(cur, event_owner_ids(cur, event_id), title, body,
                      url=event_url(str(event_id), path), event_id=str(event_id), dedupe_key=dedupe_key)


# ---- Firebase Cloud Messaging (HTTP v1) --------------------------------------------

_FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_token_cache: Dict[str, Any] = {"token": None, "exp": 0.0}


def _service_account() -> Optional[Dict[str, Any]]:
    raw = os.getenv("FCM_SERVICE_ACCOUNT_B64", "").strip()
    if not raw:
        return None
    try:
        return json.loads(base64.b64decode(raw).decode("utf-8"))
    except Exception:
        logger.error("FCM_SERVICE_ACCOUNT_B64 is not valid base64 JSON")
        return None


def configured() -> bool:
    return _service_account() is not None


def _access_token(info: Dict[str, Any]) -> str:
    if _token_cache["token"] and time.time() < _token_cache["exp"] - 60:
        return _token_cache["token"]
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request

    creds = service_account.Credentials.from_service_account_info(info, scopes=[_FCM_SCOPE])
    creds.refresh(Request())
    _token_cache["token"] = creds.token
    _token_cache["exp"] = creds.expiry.timestamp() if creds.expiry else time.time() + 3000
    return creds.token


class InvalidToken(Exception):
    """The device uninstalled the app / the token was rotated - forget it."""


def fcm_send(token: str, title: str, body: str, data: Dict[str, str]) -> None:
    import requests

    info = _service_account()
    if info is None:
        raise RuntimeError("FCM not configured")
    resp = requests.post(
        f"https://fcm.googleapis.com/v1/projects/{info['project_id']}/messages:send",
        headers={"Authorization": f"Bearer {_access_token(info)}"},
        json={"message": {
            "token": token,
            "notification": {"title": title, "body": body},
            "data": {k: str(v) for k, v in data.items() if v is not None},
            "android": {"priority": "high", "notification": {"channel_id": "showup", "sound": "default"}},
            "apns": {"payload": {"aps": {"sound": "default"}}},
        }},
        timeout=10,
    )
    if resp.status_code in (404, 400) and ("UNREGISTERED" in resp.text or "INVALID_ARGUMENT" in resp.text):
        raise InvalidToken(resp.text[:200])
    if resp.status_code >= 300:
        raise RuntimeError(f"FCM {resp.status_code}: {resp.text[:200]}")


def dispatch(conn, send=fcm_send) -> int:
    """Send pending outbox rows (scheduler-service, autocommit connection).
    Returns how many pushes reached at least one device."""
    if send is fcm_send and not configured():
        return 0
    import psycopg2.extras

    sent = 0
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT to_regclass('public.push_outbox') IS NOT NULL AS ok")
        if not cur.fetchone()["ok"]:
            return 0
        cur.execute("BEGIN")
        cur.execute(
            "UPDATE push_outbox SET status = 'stale' WHERE status = 'pending' "
            "AND created_at < now() - make_interval(hours => %s)", (STALE_HOURS,))
        cur.execute(
            """SELECT id, user_id, title, body, url, event_id, attempts FROM push_outbox
               WHERE status = 'pending' ORDER BY created_at LIMIT %s FOR UPDATE SKIP LOCKED""",
            (BATCH_SIZE,))
        rows = cur.fetchall()
        for row in rows:
            cur.execute("SELECT token FROM push_devices WHERE user_id = %s", (row["user_id"],))
            tokens = [r["token"] for r in cur.fetchall()]
            ok, error = 0, None
            for token in tokens:
                try:
                    send(token, row["title"], row["body"],
                         {"url": row["url"] or "", "event_id": str(row["event_id"] or "")})
                    ok += 1
                except InvalidToken:
                    cur.execute("DELETE FROM push_devices WHERE token = %s", (token,))
                except Exception as e:  # network / FCM hiccup - retry next cycle
                    error = e
            if ok or not tokens or error is None:
                cur.execute("UPDATE push_outbox SET status = %s, sent_at = now() WHERE id = %s",
                            ("sent" if ok else "no_device", row["id"]))
                sent += 1 if ok else 0
            else:
                attempts = int(row["attempts"] or 0) + 1
                cur.execute("UPDATE push_outbox SET attempts = %s, status = %s WHERE id = %s",
                            (attempts, "failed" if attempts >= MAX_ATTEMPTS else "pending", row["id"]))
                logger.error("push failed | id=%s attempt=%s error=%s", row["id"], attempts, error)
        cur.execute("COMMIT")
    if sent:
        logger.info("push dispatched | sent=%s", sent)
    return sent
