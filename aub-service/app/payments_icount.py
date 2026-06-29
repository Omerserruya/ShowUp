"""iCount PayPage payment integration — embedded iframe flow.

Replaces the previous GROW (Meshulam) integration. All credentials come from env
vars (nothing committed):
  ICOUNT_BASE_URL  default: https://api.icount.co.il/api/v3.php/
  ICOUNT_API_TOKEN iCount API token (generated in the iCount dashboard). Sent as a
                   Bearer token — no username/password are stored.
  PUBLIC_BASE_URL  public origin used to build success/cancel/ipn URLs
                  (e.g. https://abcd.ngrok.io) — iCount must be able to reach it.

Flow (embedded iframe):
  1. generate_sale -> iCount returns a hosted PayPage `url` we render in an iframe,
     plus a sale id (persisted on the order for verification).
  2. On completion iCount POSTs a server-to-server IPN to our ipn_url; we look the
     sale up via get_sale_info to confirm it was actually paid, then provision.

This module only talks to iCount; persistence + provisioning live in
routers/orders.py. Response parsing is deliberately liberal (iCount has returned
slightly different key spellings across versions / accounts).
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

import httpx

DEFAULT_BASE = "https://api.icount.co.il/api/v3.php/"


def get_config() -> Dict[str, str]:
    return {
        "base_url": os.getenv("ICOUNT_BASE_URL", DEFAULT_BASE).rstrip("/") + "/",
        "api_token": os.getenv("ICOUNT_API_TOKEN", ""),
        "public_base_url": os.getenv("PUBLIC_BASE_URL", "").rstrip("/"),
        # Which iCount PayPage (עמוד סליקה) to charge against. Created in the iCount
        # dashboard; its id must be passed to generate_sale or iCount rejects with
        # "missing_paypage_id".
        "paypage_id": os.getenv("ICOUNT_PAYPAGE_ID", ""),
    }


def is_configured() -> bool:
    return bool(get_config()["api_token"])


def _post(endpoint: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """POST a JSON body to an iCount v3 endpoint and return the parsed response.

    Authentication is the API token, sent as a Bearer header.
    """
    cfg = get_config()
    url = f"{cfg['base_url']}{endpoint}"
    headers = {"Authorization": f"Bearer {cfg['api_token']}"}
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        return resp.json()


def _ok(body: Dict[str, Any]) -> bool:
    """iCount success is signalled by a truthy `status` (true / 1 / "1")."""
    status = body.get("status")
    return status in (True, 1, "1") or str(status).lower() == "true"


def generate_sale(
    *,
    order_id: str,
    amount: float,
    description: str,
    full_name: str,
    phone: str,
    email: Optional[str],
    success_url: str,
    cancel_url: str,
    ipn_url: str,
) -> Dict[str, Any]:
    """Generate an iCount PayPage. Returns {url, sale_id}.

    Raises RuntimeError if iCount isn't configured or the API returns a failure.
    The amount is authoritative and comes from the caller (server-side plan price);
    it is never taken from the client.
    """
    if not is_configured():
        raise RuntimeError("iCount is not configured (set ICOUNT_API_TOKEN)")

    cfg = get_config()
    if not cfg["paypage_id"]:
        raise RuntimeError(
            "No iCount PayPage configured: create a PayPage (עמוד סליקה) in the "
            "iCount dashboard and set ICOUNT_PAYPAGE_ID"
        )

    payload: Dict[str, Any] = {
        "paypage_id": cfg["paypage_id"],
        "doc_type": "invrec",  # tax invoice + receipt on successful charge
        "currency_code": "ILS",
        # Single line item. `unitprice` is BEFORE VAT — iCount adds VAT per the
        # PayPage settings, so the customer pays net + VAT = the displayed price.
        "items": [
            {
                "description": description,
                "unitprice": round(float(amount), 2),
                "quantity": 1,
            }
        ],
        "success_url": success_url,
        "failure_url": cancel_url,
        "cancel_url": cancel_url,
        "ipn_url": ipn_url,
        # Buyer details prefilled on the PayPage.
        "client_name": full_name,
        "email": email or "",
        "phone": phone,
        # Custom field echoed back verbatim in the IPN so we can map sale -> order.
        "custom_order_id": order_id,
    }

    body = _post("paypage/generate_sale", payload)
    if not _ok(body):
        raise RuntimeError(f"iCount generate_sale failed: {body.get('error') or body}")

    # iCount has returned the hosted page under a few different keys; accept any.
    url = (
        body.get("sale_url")
        or body.get("paypage_url")
        or body.get("url")
        or body.get("redirect_url")
        or (body.get("data") or {}).get("paypage_url")
        or (body.get("data") or {}).get("url")
    )
    sale_id = (
        body.get("sale_uniqid")
        or body.get("sale_id")
        or body.get("sale_sid")
        or body.get("id")
        or (body.get("data") or {}).get("sale_id")
        or (body.get("data") or {}).get("id")
    )
    if not url:
        raise RuntimeError(f"iCount generate_sale returned no PayPage url: {body}")

    return {"url": url, "sale_id": str(sale_id) if sale_id is not None else None}


def get_sale_info(sale_id: str) -> Dict[str, Any]:
    """Fetch a sale's status from iCount (server-side authority)."""
    if not is_configured():
        raise RuntimeError("iCount is not configured")
    return _post("paypage/get_sale_info", {"sale_id": str(sale_id)})


def _num(v: Any) -> float:
    try:
        return float(str(v).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


def is_paid(sale_info: Dict[str, Any]) -> bool:
    """True when iCount reports the sale as successfully paid.

    Handles BOTH shapes:
      • the paypage IPN — which has NO top-level `status`, and signals a completed
        charge with a `confirmation_code` + a positive `total_paid`/`cc_total`;
      • a get_sale_info response — which uses a truthy top-level `status`.
    """
    data = sale_info.get("sale") or sale_info.get("data") or sale_info
    if not isinstance(data, dict):
        data = sale_info if isinstance(sale_info, dict) else {}

    # Paypage IPN: a confirmation_code (iCount only issues one on a completed sale)
    # or a positive paid total is proof of payment.
    if str(data.get("confirmation_code") or "").strip():
        return True
    if _num(data.get("total_paid")) > 0 or _num(data.get("cc_total")) > 0:
        return True
    if data.get("paid") in (True, 1, "1"):
        return True
    payment_status = str(data.get("payment_status") or data.get("status") or "").lower()
    if payment_status in ("paid", "success", "completed", "1", "true"):
        return True

    # Fallback: explicit server-side OK status (get_sale_info responses).
    return _ok(sale_info)
