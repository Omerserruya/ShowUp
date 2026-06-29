"""
VAT / pricing helpers.

Plan prices in plans.json are VAT-INCLUSIVE (the amount actually charged). For
display we break that gross figure into the net (before-VAT) price and the VAT
component, using a configurable tax rate. Displaying before-VAT does NOT change
what is charged — only how it's presented.

    net = gross / (1 + TAX_RATE)
    vat = gross - net

TAX_RATE is read from the environment (default 0.18 — Israeli VAT) and is never
hardcoded at call sites.
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional


DEFAULT_TAX_RATE = 0.18


def get_tax_rate() -> float:
    """Current VAT rate as a fraction (e.g. 0.18). Falls back to the default
    on a missing/invalid value."""
    try:
        rate = float(os.getenv("TAX_RATE", str(DEFAULT_TAX_RATE)))
        return rate if rate >= 0 else DEFAULT_TAX_RATE
    except (TypeError, ValueError):
        return DEFAULT_TAX_RATE


def vat_breakdown(gross: float, discount: float = 0.0) -> Dict[str, float]:
    """Split a VAT-inclusive gross amount into net + vat, after applying an
    optional (VAT-inclusive) discount.

    Returns the original `subtotal`, the `discount` applied, and the final
    `gross` actually charged together with its `net`/`vat` components. All
    monetary values rounded to 2 decimals; `tax_rate` is echoed back for the
    client. With no discount, `subtotal == gross` so existing callers are
    unaffected.
    """
    rate = get_tax_rate()
    subtotal = max(float(gross or 0.0), 0.0)
    discount = min(max(float(discount or 0.0), 0.0), subtotal)
    final = subtotal - discount
    net = final / (1 + rate) if rate else final
    vat = final - net
    return {
        "subtotal": round(subtotal, 2),
        "discount": round(discount, 2),
        "gross": round(final, 2),
        "net": round(net, 2),
        "vat": round(vat, 2),
        "tax_rate": rate,
    }


def price_before_vat(amount: float) -> float:
    """Strip VAT from a VAT-inclusive amount: ``amount / (1 + TAX_RATE)``
    (e.g. divide by 1.18 at the default rate), rounded to 2 decimals.

    Used right before sending a charge to iCount: the PayPage adds VAT itself, so
    we hand it the before-VAT figure and the customer ends up paying the original
    VAT-inclusive price.
    """
    rate = get_tax_rate()
    amount = max(float(amount or 0.0), 0.0)
    net = amount / (1 + rate) if rate else amount
    return round(net, 2)


def load_coupons() -> Dict[str, Dict[str, Any]]:
    """Coupon catalogue from the COUPONS_JSON env var (never hardcoded).

    Expected shape (codes are matched case-insensitively):

        {"WELCOME10": {"type": "percent", "value": 10, "label": "..."},
         "SAVE50": {"type": "amount", "value": 50}}

    Returns an empty catalogue when unset or invalid (coupons simply disabled).
    """
    raw = (os.getenv("COUPONS_JSON") or "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {
        str(code).strip().upper(): meta
        for code, meta in data.items()
        if isinstance(meta, dict)
    }


def _compute_discount(coupon: Dict[str, Any], gross: float) -> float:
    """Discount amount (VAT-inclusive) for a coupon against a gross total."""
    ctype = str(coupon.get("type", "")).lower()
    try:
        value = float(coupon.get("value", 0))
    except (TypeError, ValueError):
        return 0.0
    if value <= 0:
        return 0.0
    if ctype == "percent":
        discount = gross * (value / 100.0)
    elif ctype in ("amount", "fixed"):
        discount = value
    else:
        return 0.0
    return round(min(max(discount, 0.0), gross), 2)


def validate_coupon(code: Optional[str], gross: float) -> Optional[Dict[str, Any]]:
    """Validate a coupon code against a gross total.

    Returns ``{code, type, value, discount, label}`` for a valid code that
    yields a positive discount, else ``None`` (unknown code / no effect).
    """
    if not code:
        return None
    coupon = load_coupons().get(str(code).strip().upper())
    if not coupon:
        return None
    discount = _compute_discount(coupon, gross)
    if discount <= 0:
        return None
    return {
        "code": str(code).strip().upper(),
        "type": str(coupon.get("type", "")).lower(),
        "value": float(coupon.get("value", 0)),
        "discount": discount,
        "label": coupon.get("label"),
    }
