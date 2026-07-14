"""Meta (WhatsApp Cloud API) template-management client - WhatsApp only.

Creates/queries message-template DEFINITIONS on a WhatsApp Business Account
(WABA). This is the ONLY code that talks to Meta's `/message_templates` graph
endpoint. It is entirely separate from message SENDING (outpost-service) - this
manages template shells; the send path (planner → worker → outpost) is untouched.

Config (env):
    WA_WABA_ID       - WhatsApp Business Account id (template management target)
    WA_API_B         - Graph API access token (reused from the sender)
    WA_APP_ID        - Meta app id (only needed to upload IMAGE-header handles)
    WA_GRAPH_VERSION - Graph API version (default v22.0)

If WABA id / token are absent, or a call is made with dry_run=True, the client
runs in SIMULATION mode: it performs no network I/O and returns a simulated
result (status 'pending', no id). This keeps QA/preview and un-provisioned
environments safe.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


class MetaTemplateResult:
    def __init__(self, *, ok: bool, simulated: bool, meta_id: Optional[str] = None,
                 meta_status: str = "pending", category: Optional[str] = None,
                 rejection_reason: Optional[str] = None, error: Optional[str] = None,
                 raw: Optional[dict] = None):
        self.ok = ok
        self.simulated = simulated
        self.meta_id = meta_id
        self.meta_status = meta_status
        self.category = category
        self.rejection_reason = rejection_reason
        self.error = error
        self.raw = raw or {}

    def to_dict(self) -> dict:
        return {
            "ok": self.ok, "simulated": self.simulated, "meta_id": self.meta_id,
            "meta_status": self.meta_status, "category": self.category,
            "rejection_reason": self.rejection_reason, "error": self.error,
        }


class MetaTemplateClient:
    def __init__(self):
        self.waba_id = os.getenv("WA_WABA_ID")
        self.token = os.getenv("WA_API_B")
        self.app_id = os.getenv("WA_APP_ID")  # needed only for IMAGE header uploads
        self.version = os.getenv("WA_GRAPH_VERSION", "v22.0")
        self.base = f"https://graph.facebook.com/{self.version}"

    @property
    def configured(self) -> bool:
        return bool(self.waba_id and self.token)

    def upload_header_handle(self, image_url: str, *, timeout: float = 30.0) -> Optional[str]:
        """Upload a sample header image via Meta's Resumable Upload API and return
        the media HANDLE required as an IMAGE-header example. Returns None when the
        app id/token is missing or the upload fails (caller then skips the handle).

        Flow: create an upload session on the app, then POST the raw bytes and read
        back the `h` handle."""
        if not (self.token and self.app_id and image_url):
            return None
        try:
            img = httpx.get(image_url, timeout=timeout)
            img.raise_for_status()
            data = img.content
            mime = img.headers.get("content-type", "image/jpeg").split(";")[0]
            # 1) create upload session
            sess = httpx.post(
                f"{self.base}/{self.app_id}/uploads",
                params={"file_name": "header.jpg", "file_length": len(data), "file_type": mime},
                headers={"Authorization": f"Bearer {self.token}"}, timeout=timeout,
            )
            session_id = (sess.json() or {}).get("id")
            if not session_id:
                logger.warning("meta upload: no session id (%s)", sess.text[:200])
                return None
            # 2) upload the bytes, read back the handle
            up = httpx.post(
                f"{self.base}/{session_id}",
                headers={"Authorization": f"OAuth {self.token}", "file_offset": "0"},
                content=data, timeout=timeout,
            )
            handle = (up.json() or {}).get("h")
            if not handle:
                logger.warning("meta upload: no handle (%s)", up.text[:200])
            return handle
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("meta upload_header_handle failed: %s", exc)
            return None

    def create_template(self, payload: dict, *, dry_run: bool = False,
                        timeout: float = 20.0) -> MetaTemplateResult:
        """POST a template definition to Meta. Simulates when unconfigured/dry_run."""
        if dry_run or not self.configured:
            return MetaTemplateResult(
                ok=True, simulated=True, meta_id=None, meta_status="pending",
                category=payload.get("category"),
                error=None if (dry_run or self.configured) else "meta_not_configured",
            )
        url = f"{self.base}/{self.waba_id}/message_templates"
        headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
        try:
            resp = httpx.post(url, json=payload, headers=headers, timeout=timeout)
        except httpx.HTTPError as exc:  # network-level failure
            logger.warning("meta create_template network error: %s", exc)
            return MetaTemplateResult(ok=False, simulated=False, meta_status="none", error=str(exc))

        data = {}
        try:
            data = resp.json()
        except Exception:  # pragma: no cover
            data = {"raw": resp.text}

        if resp.status_code >= 400 or "error" in data:
            err = (data.get("error") or {})
            msg = err.get("error_user_msg") or err.get("message") or f"HTTP {resp.status_code}"
            return MetaTemplateResult(ok=False, simulated=False, meta_status="rejected",
                                      rejection_reason=msg, error=msg, raw=data)

        return MetaTemplateResult(
            ok=True, simulated=False, meta_id=data.get("id"),
            meta_status=(data.get("status") or "pending").lower(),
            category=data.get("category"), raw=data,
        )

    def fetch_status(self, name: str, *, timeout: float = 20.0) -> MetaTemplateResult:
        """GET the current Meta review status for a template name (for /sync)."""
        if not self.configured:
            return MetaTemplateResult(ok=False, simulated=True, meta_status="none",
                                      error="meta_not_configured")
        url = f"{self.base}/{self.waba_id}/message_templates"
        headers = {"Authorization": f"Bearer {self.token}"}
        try:
            resp = httpx.get(url, params={"name": name}, headers=headers, timeout=timeout)
            data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            return MetaTemplateResult(ok=False, simulated=False, meta_status="none", error=str(exc))
        rows = (data or {}).get("data") or []
        match = next((r for r in rows if r.get("name") == name), rows[0] if rows else None)
        if not match:
            return MetaTemplateResult(ok=False, simulated=False, meta_status="none",
                                      error="not_found", raw=data)
        return MetaTemplateResult(
            ok=True, simulated=False, meta_id=match.get("id"),
            meta_status=(match.get("status") or "pending").lower(),
            category=match.get("category"),
            rejection_reason=match.get("rejected_reason") or match.get("rejection_reason"),
            raw=match,
        )
