"""
Orders API endpoints (pre-payment order flow)
"""
import os
import uuid
import json
import hmac
import hashlib
import secrets
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
import psycopg2
import psycopg2.extras
from fastapi import APIRouter, Body, Header, HTTPException, Path, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.token_utils import create_jwt, verify_jwt
from app.routers.auth import ensure_users_table, get_env as get_auth_env
from app.plans_data import get_plan as get_plan_doc
from app import payments_icount
from app.pricing import vat_breakdown, validate_coupon, price_before_vat


router = APIRouter(prefix="/orders", tags=["orders"])


# --- observability helpers (best-effort; never break the payment flow) ------
def _obs_payment(order_id, *, provider=None, status=None, order=None, amount=None) -> None:
    try:
        from shared.obs import set_payment, set_flow
        set_flow(operation="payment", flow="payment")
        o = order or {}
        set_payment(payment_id=str(order_id), provider=provider, status=status,
                    amount=amount, currency="ILS", entitlement_id=o.get("plan"))
    except Exception:
        pass


def _obs_log(event, *, level="info", **fields) -> None:
    try:
        from shared.obs import log_event
        log_event(event, level=level, **fields)
    except Exception:
        pass


def _obs_capture(exc, **ctx) -> None:
    try:
        from shared.obs import capture
        capture(exc, **ctx)
    except Exception:
        pass


def get_env() -> Dict[str, Any]:
  return {
      "DB_HOST": os.getenv("DB_HOST"),
      "DB_PORT": int(os.getenv("DB_PORT")),
      "DB_USER": os.getenv("DB_USER"),
      "DB_PASSWORD": os.getenv("DB_PASSWORD"),
      "DB_NAME": os.getenv("DB_NAME"),
  }


def ensure_orders_table(env: Dict[str, Any]) -> None:
  ddl = (
      "CREATE TABLE IF NOT EXISTS orders ("
      "order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
      "status TEXT NOT NULL DEFAULT 'draft',"
      "plan TEXT NOT NULL,"
      "event_name TEXT NOT NULL,"
      "event_description TEXT,"
      "event_type TEXT,"
      "event_date TIMESTAMP,"
      "location JSONB,"
      "inviters JSONB,"
      "campaigns JSONB,"
      "first_name TEXT,"
      "last_name TEXT,"
      "phone TEXT,"
      "email TEXT,"
      "order_date TIMESTAMP NOT NULL DEFAULT NOW(),"
      "updated_at TIMESTAMP NOT NULL DEFAULT NOW()"
      ")"
  )
  with psycopg2.connect(
      host=env["DB_HOST"],
      port=env["DB_PORT"],
      user=env["DB_USER"],
      password=env["DB_PASSWORD"],
      dbname=env["DB_NAME"],
  ) as conn:
    conn.autocommit = True
    with conn.cursor() as cur:
      # Ensure pgcrypto for gen_random_uuid
      cur.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")
      cur.execute(ddl)
      
      # Migration: Ensure location, inviters, campaigns columns are JSONB (not TEXT)
      # This handles cases where table was created before JSONB was set
      migration_statements = [
          "ALTER TABLE orders ALTER COLUMN location TYPE JSONB USING location::jsonb",
          "ALTER TABLE orders ALTER COLUMN inviters TYPE JSONB USING inviters::jsonb",
          "ALTER TABLE orders ALTER COLUMN campaigns TYPE JSONB USING campaigns::jsonb",
          # iCount PayPage tracking (maps an iCount sale back to this order).
          "ALTER TABLE orders ADD COLUMN IF NOT EXISTS icount_sale_id TEXT",
          # Applied promo/coupon code (validated + priced server-side).
          "ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT",
          # The core-service event this order was provisioned into (set on payment).
          # Lets the dashboard open the freshly created event instead of guessing.
          "ALTER TABLE orders ADD COLUMN IF NOT EXISTS event_id UUID",
          # For an in-place plan change: the plan the event was on BEFORE this
          # order, so the charge is only the upgrade difference (new - prev).
          "ALTER TABLE orders ADD COLUMN IF NOT EXISTS prev_plan TEXT",
          # Per-order capability token (secret). Orders are created pre-auth, so
          # object-level access is proven by possessing this token rather than by
          # JWT. Returned once from create_order; required on every read/mutate.
          "ALTER TABLE orders ADD COLUMN IF NOT EXISTS access_token TEXT",
          # Event-type-specific subjects (bride/groom/parents/baby/…), forwarded
          # to the event so subject variables resolve at delivery.
          "ALTER TABLE orders ADD COLUMN IF NOT EXISTS subjects JSONB",
          # Order kind: 'plan' (default - new event or plan change) or
          # 'extra_round' (buy one paid message round for an existing event).
          "ALTER TABLE orders ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'plan'",
          # Extra-round pricing: recipient count the price band was resolved from,
          # and the VAT-inclusive charge (never derived from a plan for this kind).
          "ALTER TABLE orders ADD COLUMN IF NOT EXISTS round_recipients INTEGER",
          "ALTER TABLE orders ADD COLUMN IF NOT EXISTS round_amount NUMERIC",
      ]
      for stmt in migration_statements:
        try:
          cur.execute(stmt)
          print(f"[ORDERS_TABLE] Migration applied: {stmt}")
        except Exception as e:
          # Column might already be JSONB or not exist yet - that's OK
          print(f"[ORDERS_TABLE] Migration skipped (expected): {stmt[:50]}... - {e}")
          pass


class CampaignItem(BaseModel):
  label: str
  template_id: Optional[str] = None
  # Optional user-written message body that overrides the template at send time.
  custom_message: Optional[str] = None
  scheduled_at: Optional[datetime] = None


class OrderCreate(BaseModel):
  plan: str
  # When set, this order changes the plan on an EXISTING event (in-place upgrade)
  # instead of provisioning a brand-new event on payment.
  event_id: Optional[uuid.UUID] = None
  # DEPRECATED / ignored: the current plan is resolved server-side from the event
  # (see create_order). Kept for backward compatibility with older clients; the
  # value sent here is never trusted for pricing.
  prev_plan: Optional[str] = None
  event_name: Optional[str] = None
  event_description: Optional[str] = None
  event_type: Optional[str] = None
  event_date: Optional[datetime] = None
  location: Optional[Dict[str, Any]] = None
  inviters: Optional[List[Dict[str, Any]]] = None
  subjects: Optional[Dict[str, Any]] = None
  campaigns: Optional[List[CampaignItem]] = None


class OrderIdentityUpdate(BaseModel):
  first_name: str
  last_name: str
  phone: str
  email: Optional[str] = None  # Optional - can be empty string or None


class OrderOut(BaseModel):
  order_id: uuid.UUID
  status: str
  # The core-service event created on payment (null until provisioned). The
  # checkout uses this to open the new event on the dashboard.
  event_id: Optional[uuid.UUID] = None
  plan: str
  event_name: str
  event_description: Optional[str] = None
  event_type: Optional[str] = None
  event_date: Optional[datetime] = None
  location: Optional[Dict[str, Any]] = None
  inviters: Optional[List[Dict[str, Any]]] = None
  campaigns: Optional[List[Dict[str, Any]]] = None
  first_name: Optional[str] = None
  last_name: Optional[str] = None
  phone: Optional[str] = None
  email: Optional[str] = None
  order_date: datetime
  updated_at: datetime
  # VAT-inclusive charge plus its before-VAT breakdown (computed server-side
  # from the plan price; the client never sets the amount). See app.pricing.
  # `amount_gross` is the final charge AFTER any coupon discount; `amount_subtotal`
  # is the pre-discount total and `amount_discount` the coupon savings.
  amount_subtotal: Optional[float] = None
  amount_discount: Optional[float] = None
  amount_gross: Optional[float] = None
  amount_net: Optional[float] = None
  amount_vat: Optional[float] = None
  tax_rate: Optional[float] = None
  coupon_code: Optional[str] = None
  # 'coupon' (new purchase discount), 'credit' (upgrade current-plan credit) or 'none'.
  adjustment_kind: Optional[str] = None
  currency: str = "ILS"


# Tiers that exist commercially but are NOT self-service purchases. `venue` is
# granted by a venue's own agreement (₪0, unlimited guests) and `legacy`/`starter`
# are internal; allowing them to be ordered would hand out an unlimited plan for
# nothing, since a zero-cost order settles without payment.
_NON_PURCHASABLE_PLANS = {"venue", "legacy", "starter"}


def _require_purchasable_plan(plan_id: Optional[str]) -> None:
  """Reject an order for a plan that is not on sale."""
  key = (str(plan_id or "")).strip().lower()
  if not key:
    raise HTTPException(status_code=422, detail="plan is required")
  if key in _NON_PURCHASABLE_PLANS:
    raise HTTPException(status_code=400, detail="this plan is not available for purchase")
  if not get_plan_doc(key):
    raise HTTPException(status_code=400, detail="unknown plan")


def _caller_user_id(authorization: Optional[str]) -> Optional[str]:
  """The authenticated user id from a Bearer token, or None."""
  if not authorization or not authorization.lower().startswith("bearer "):
    return None
  try:
    claims = verify_jwt(authorization.split(" ", 1)[1].strip())
  except Exception:
    return None
  uid = claims.get("user_id")
  return str(uid) if uid else None


def _require_event_owner(event_id: str, authorization: Optional[str]) -> None:
  """Reject an order targeting an event the caller does not own.

  Checkout is deliberately pre-auth (a new customer buys before they have an
  account), so this router has no blanket auth. But an order carrying an
  `event_id` is a write against an EXISTING event's entitlement - a plan change.
  Without this check anyone could create a paid-plan order for any event id and,
  because a zero-cost order settles without payment, downgrade a paying
  customer's event or grant themselves a free unlimited tier.

  Ownership is resolved by core (the authority on `events.owners`); aub never
  decides it locally.
  """
  user_id = _caller_user_id(authorization)
  if not user_id:
    raise HTTPException(status_code=401, detail="sign in to change this event's plan")
  info = _core_event_partner(str(event_id), user_id=user_id)
  if not info.get("is_owner"):
    # 404, not 403: never confirm that an event id exists to a non-owner.
    raise HTTPException(status_code=404, detail="event not found")


def _core_event_partner(event_id: str, user_id: Optional[str] = None) -> Dict[str, Any]:
  """Ask core-service whether an event belongs to a partner venue, and its
  partner-discount config. Best-effort: {} on any failure."""
  base = os.getenv("CORE_SERVICE_URL")
  secret = os.getenv("INTERNAL_API_SECRET")
  if not base:
    print("[PARTNER] CORE_SERVICE_URL not set; cannot resolve venue partner discount")
    return {}
  if not secret:
    print("[PARTNER] INTERNAL_API_SECRET not set on aub-service; core will reject "
          "the partner lookup and the venue discount will not apply")
  if not event_id:
    return {}
  try:
    with httpx.Client(timeout=6.0) as client:
      r = client.get(
          f"{base.rstrip('/')}/internal/events/{event_id}/partner",
          params={"user_id": user_id} if user_id else None,
          headers={"X-Internal-Secret": secret or ""},
      )
      if r.status_code != 200:
        print(f"[PARTNER] core returned {r.status_code} for event {event_id}: "
              f"{r.text[:200]} - venue discount not applied")
        return {}
      return r.json()
  except Exception as exc:
    print(f"[PARTNER] error resolving venue partner for event {event_id}: {exc}")
    return {}


@router.post("", response_model=Dict[str, str])
def create_order(
    payload: OrderCreate = Body(...),
    authorization: Optional[str] = Header(None),
) -> Dict[str, str]:
  """
  Step 1 – Create order after event approval.
  - Creates a new order row with status 'event_confirmed'
  - Returns the generated order_id

  A NEW purchase needs no authentication - the customer has no account yet. An
  order carrying `event_id` is a plan change against an existing event, so it
  must prove ownership first.
  """
  env = get_env()
  ensure_orders_table(env)

  if payload.event_id:
    _require_event_owner(str(payload.event_id), authorization)

  # Only plans that are actually on sale may be ordered. `get_plan` deliberately
  # resolves inactive/internal tiers (so existing events keep working), which
  # would otherwise let a client order the ₪0 `venue` tier - unlimited guests,
  # zero cost, and a zero-cost order settles without payment.
  _require_purchasable_plan(payload.plan)

  # Resolve the order's CURRENT plan (prev_plan) from SERVER TRUTH, never the
  # client: for an in-place change we ask core for the event's real plan_id. This
  # value controls the upgrade credit, the PayPage, and coupon eligibility, so a
  # forged client value must not be able to manufacture a credit. `partner` is
  # reused for the coupon step below to avoid a second core round-trip.
  partner: Dict[str, Any] = {}
  resolved_prev: Optional[str] = None
  if payload.event_id:
    partner = _core_event_partner(str(payload.event_id))
    resolved_prev = partner.get("plan_id")
    if resolved_prev is None:
      print(f"[ORDER] could not resolve current plan for event {payload.event_id} "
            "from core; treating as NEW PURCHASE (full price, no credit)")
  is_upgrade = _is_paid_plan(resolved_prev)

  # Per-order capability token: the only proof-of-ownership for this pre-auth
  # order. Returned once to the creator; required on every later read/mutate.
  access_token = secrets.token_urlsafe(32)

  with psycopg2.connect(
      host=env["DB_HOST"],
      port=env["DB_PORT"],
      user=env["DB_USER"],
      password=env["DB_PASSWORD"],
      dbname=env["DB_NAME"],
  ) as conn:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
      cur.execute(
          """
          INSERT INTO orders (
              status,
              plan,
              event_id,
              prev_plan,
              event_name,
              event_description,
              event_type,
              event_date,
              location,
              inviters,
              subjects,
              campaigns,
              access_token
          )
          VALUES (
              %s,
              %s,
              %s,
              %s,
              %s,
              %s,
              %s,
              %s,
              %s::jsonb,
              %s::jsonb,
              %s::jsonb,
              %s::jsonb,
              %s
          )
          RETURNING order_id
          """,
          (
              "event_confirmed",
              payload.plan,
              str(payload.event_id) if payload.event_id else None,
              resolved_prev,  # server-resolved current plan (never client-trusted)
              payload.event_name or "",
              payload.event_description,
              payload.event_type,
              payload.event_date,
              psycopg2.extras.Json(payload.location) if payload.location is not None else None,
              psycopg2.extras.Json(payload.inviters) if payload.inviters is not None else None,
              psycopg2.extras.Json(payload.subjects) if payload.subjects is not None else None,
              # Use Pydantic's JSON mode so datetimes become ISO strings before jsonb insert
              psycopg2.extras.Json(
                  [c.model_dump(mode="json") for c in payload.campaigns]
              ) if payload.campaigns else None,
              access_token,
          ),
      )
      row = cur.fetchone()
      order_id = row["order_id"]

  # Venue partner discount - NEW PURCHASE only. Coupons (partner or marketing)
  # never apply to an UPGRADE (an existing paying customer): that price is set
  # purely by the current-plan credit. For a venue-sourced first purchase we auto-
  # attach the venue's coupon (falling back to DEFAULT_VENUE_COUPON) so it flows
  # through the normal coupon path - the customer never types a code. Resolved
  # server-side (not client-trusted). An unknown code is harmless (no discount).
  if payload.event_id and not is_upgrade:
    if partner.get("is_venue"):
      code = partner.get("partner_coupon_code") or os.getenv("DEFAULT_VENUE_COUPON")
      if code:
        try:
          _persist_coupon(env, order_id, str(code).strip().upper())
          print(f"[PARTNER] auto-attached venue coupon '{code}' to new-purchase order {order_id}")
        except Exception as exc:
          print(f"[PARTNER] failed to attach venue coupon '{code}' to order {order_id}: {exc}")
      else:
        print(f"[PARTNER] event {payload.event_id} is venue-sourced but no coupon "
              "configured (venue.partner_coupon_code / DEFAULT_VENUE_COUPON both empty)")
  elif payload.event_id and is_upgrade:
    print(f"[PARTNER] order {order_id} is an UPGRADE (prev_plan={resolved_prev}); "
          "skipping partner/marketing coupons - credit-only pricing")

  # Return the capability token exactly once. The client must store it and send
  # it (X-Order-Token header or ?token=) on every subsequent order call.
  return {"order_id": order_id, "access_token": access_token}


class ExtraRoundOrderCreate(BaseModel):
  event_id: uuid.UUID
  # Audience the round targets - only affects the recipient-based price band.
  audience: Optional[str] = "everyone"


def _core_extra_round_quote(event_id: str, audience: str) -> Dict[str, Any]:
  """Ask core for the authoritative extra-round quote (price is never client-set)."""
  base = os.getenv("CORE_SERVICE_URL")
  secret = os.getenv("INTERNAL_API_SECRET")
  if not base or not event_id:
    return {}
  try:
    with httpx.Client(timeout=6.0) as client:
      r = client.get(
          f"{base.rstrip('/')}/internal/events/{event_id}/extra-round-quote",
          params={"audience": audience or "everyone"},
          headers={"X-Internal-Secret": secret or ""},
      )
      if r.status_code != 200:
        print(f"[EXTRA_ROUND] core quote returned {r.status_code} for event {event_id}: {r.text[:200]}")
        return {}
      return r.json()
  except Exception as exc:
    print(f"[EXTRA_ROUND] core quote failed for event {event_id}: {exc}")
    return {}


@router.post("/extra-round", response_model=Dict[str, str])
def create_extra_round_order(
    payload: ExtraRoundOrderCreate = Body(...),
    authorization: Optional[str] = Header(None),
) -> Dict[str, str]:
  """Create a paid extra-message-round order for an existing event.

  The price is resolved SERVER-SIDE from core's authoritative recipient count and
  the tiered bands - the client never sets the amount. On payment, provisioning
  grants the event one extra-round credit (extra_rounds_allowance += 1)."""
  env = get_env()
  ensure_orders_table(env)

  # Buying rounds for an event is a write against that event's entitlement.
  _require_event_owner(str(payload.event_id), authorization)

  quote = _core_extra_round_quote(str(payload.event_id), payload.audience or "everyone")
  if not quote:
    raise HTTPException(status_code=502, detail="could not resolve the round price - try again")
  price = float(quote.get("price_gross") or 0.0)
  if price <= 0:
    raise HTTPException(status_code=400, detail="this round requires no payment")

  access_token = secrets.token_urlsafe(32)
  with psycopg2.connect(
      host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"],
      password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
  ) as conn:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
      cur.execute(
          """
          INSERT INTO orders (status, plan, kind, event_id, event_name,
                              round_recipients, round_amount, access_token)
          VALUES (%s, %s, 'extra_round', %s, %s, %s, %s, %s)
          RETURNING order_id
          """,
          (
              "event_confirmed",
              quote.get("plan_id") or "extra_round",
              str(payload.event_id),
              quote.get("event_name") or "",
              int(quote.get("recipients") or 0),
              price,
              access_token,
          ),
      )
      order_id = cur.fetchone()["order_id"]
  return {"order_id": order_id, "access_token": access_token}


def _fetch_order(env: Dict[str, Any], order_id: uuid.UUID) -> Dict[str, Any]:
  with psycopg2.connect(
      host=env["DB_HOST"],
      port=env["DB_PORT"],
      user=env["DB_USER"],
      password=env["DB_PASSWORD"],
      dbname=env["DB_NAME"],
  ) as conn:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
      cur.execute(
          "SELECT * FROM orders WHERE order_id = %s",
          (str(order_id),),
      )
      row = cur.fetchone()
      if not row:
        raise HTTPException(status_code=404, detail="Order not found")
      return row


def _require_order_token(order_row: Dict[str, Any], provided: Optional[str]) -> None:
  """Object-level authorization for a pre-auth order: the caller must present the
  order's capability token (X-Order-Token header or ?token=). Constant-time
  compare; 403 on missing/mismatch. Legacy orders created before this column
  existed have no token - those are treated as locked (403) rather than open."""
  expected = (order_row or {}).get("access_token")
  if not expected:
    raise HTTPException(status_code=403, detail="This order cannot be accessed")
  if not provided or not hmac.compare_digest(str(provided), str(expected)):
    raise HTTPException(status_code=403, detail="Invalid or missing order token")


def _fetch_order_authorized(
    env: Dict[str, Any], order_id: uuid.UUID, token: Optional[str]
) -> Dict[str, Any]:
  """Fetch an order and enforce the capability token in one step."""
  order = _fetch_order(env, order_id)
  _require_order_token(order, token)
  return order


class IpnSecretMissing(RuntimeError):
  """No IPN signing secret configured."""


def _ipn_secret() -> bytes:
  """Secret for signing the iCount IPN callback URL. The IPN URL we hand iCount
  carries an HMAC over the order id; only a caller in possession of this secret
  (i.e. iCount replaying the URL we configured) can produce a valid signature,
  so a forged callback cannot trigger provisioning.

  Raises rather than falling back to an empty key. With `b""` the signature is
  HMAC over a publicly-known key, so anyone who learns an order id can forge a
  callback - and because the callback body is itself treated as payment
  evidence, that is a free-provisioning hole. Failing closed makes the
  misconfiguration loud instead of silently authenticating attackers.
  """
  secret = (
      os.getenv("ICOUNT_IPN_SECRET")
      or os.getenv("INTERNAL_API_SECRET")
      or os.getenv("JWT_SECRET")
      or ""
  )
  if not secret:
    raise IpnSecretMissing(
        "ICOUNT_IPN_SECRET / INTERNAL_API_SECRET / JWT_SECRET must be set to "
        "authenticate iCount IPN callbacks"
    )
  return secret.encode("utf-8")


def _order_ipn_sig(order_id: Any) -> str:
  return hmac.new(_ipn_secret(), f"icount-ipn:{order_id}".encode("utf-8"), hashlib.sha256).hexdigest()


@router.patch("/{order_id}/identity", response_model=OrderOut)
def update_order_identity(
    order_id: uuid.UUID = Path(..., description="Order ID"),
    payload: OrderIdentityUpdate = Body(...),
    x_order_token: Optional[str] = Header(None, alias="X-Order-Token"),
    token: Optional[str] = None,
) -> OrderOut:
  """
  Step 2 – Add buyer personal details.
  - Updates identity fields on existing order
  - Transitions status to 'identity_added'
  - Idempotent: multiple calls with same data are safe
  """
  env = get_env()
  ensure_orders_table(env)

  # Fetch current order + enforce the per-order capability token.
  order_row = _fetch_order_authorized(env, order_id, x_order_token or token)
  current_status = order_row["status"]

  # Only allow identity update in allowed states
  if current_status not in ("event_confirmed", "identity_added"):
    raise HTTPException(
        status_code=400,
        detail=f"Order status '{current_status}' does not allow identity update",
    )

  with psycopg2.connect(
      host=env["DB_HOST"],
      port=env["DB_PORT"],
      user=env["DB_USER"],
      password=env["DB_PASSWORD"],
      dbname=env["DB_NAME"],
  ) as conn:
    with conn.cursor() as cur:
      cur.execute(
          """
          UPDATE orders
          SET
              first_name = %s,
              last_name = %s,
              phone = %s,
              email = %s,
              status = %s,
              updated_at = NOW()
          WHERE order_id = %s
          """,
          (
              payload.first_name,
              payload.last_name,
              payload.phone,
              payload.email,
              "identity_added",
              str(order_id),
          ),
      )

  # Return updated order
  updated_row = _fetch_order(env, order_id)
  # Decode JSONB fields into proper Python structures
  if isinstance(updated_row.get("location"), str):
    import json
    try:
      updated_row["location"] = json.loads(updated_row["location"])
    except Exception:
      pass
  if isinstance(updated_row.get("inviters"), str):
    import json
    try:
      updated_row["inviters"] = json.loads(updated_row["inviters"])
    except Exception:
      pass
  if isinstance(updated_row.get("campaigns"), str):
    import json
    try:
      updated_row["campaigns"] = json.loads(updated_row["campaigns"])
    except Exception:
      pass

  return OrderOut(**updated_row)


@router.get("/{order_id}", response_model=OrderOut)
def get_order(
    order_id: uuid.UUID = Path(..., description="Order ID"),
    x_order_token: Optional[str] = Header(None, alias="X-Order-Token"),
    token: Optional[str] = None,
) -> OrderOut:
  """
  Retrieve an order by order_id.
  Used for checkout resume / abandonment recovery. Requires the per-order
  capability token (returned once from create_order) - orders hold buyer PII and
  are never readable by id alone.
  """
  env = get_env()
  ensure_orders_table(env)

  row = _fetch_order_authorized(env, order_id, x_order_token or token)
  # Attach the server-side price breakdown (net / VAT / gross, less any coupon)
  # so the checkout can show "before VAT" + discount consistently without ever
  # trusting a client amount.
  bd = _order_breakdown(row)
  row = {
      **row,
      "amount_subtotal": bd["subtotal"],
      "amount_discount": bd["discount"],
      "amount_gross": bd["gross"],
      "amount_net": bd["net"],
      "amount_vat": bd["vat"],
      "tax_rate": bd["tax_rate"],
      # How the client labels the negative line: 'coupon' (new purchase), 'credit'
      # (upgrade - remaining value of the current plan), or 'none'.
      "adjustment_kind": bd.get("adjustment_kind", "none"),
      # Only surface a coupon on a NEW PURCHASE that still yields a discount (an
      # invalid code, or an upgrade's credit, must not show as an "applied coupon").
      "coupon_code": row.get("coupon_code") if bd.get("adjustment_kind") == "coupon" else None,
  }
  # Decode JSONB if needed (psycopg2 usually returns proper Python types)
  return OrderOut(**row)


class CouponApply(BaseModel):
  code: str


def _persist_coupon(env: Dict[str, Any], order_id: uuid.UUID, code: Optional[str]) -> None:
  with psycopg2.connect(
      host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"],
      password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
  ) as conn:
    with conn.cursor() as cur:
      cur.execute(
          "UPDATE orders SET coupon_code = %s, updated_at = NOW() WHERE order_id = %s",
          (code, str(order_id)),
      )
      conn.commit()


@router.post("/{order_id}/coupon", response_model=OrderOut)
def apply_coupon(
    order_id: uuid.UUID = Path(..., description="Order ID"),
    payload: CouponApply = Body(...),
    x_order_token: Optional[str] = Header(None, alias="X-Order-Token"),
    token: Optional[str] = None,
) -> OrderOut:
  """Validate a coupon code against the order's plan price and, if valid,
  persist it. Returns the order with the refreshed (discounted) breakdown.
  422 if the code is unknown or yields no discount."""
  env = get_env()
  ensure_orders_table(env)
  tok = x_order_token or token
  order = _fetch_order_authorized(env, order_id, tok)
  # UPGRADE orders (existing paying customer) are credit-only - coupons never apply.
  if _is_upgrade(order):
    raise HTTPException(status_code=422, detail="קופונים אינם חלים על שדרוג מנוי")
  # NEW PURCHASE: validate against the full target-plan price.
  gross = _plan_amount(order.get("plan"))
  coupon = validate_coupon((payload.code or "").strip(), gross)
  if not coupon:
    raise HTTPException(status_code=422, detail="קוד הקופון אינו תקף")
  _persist_coupon(env, order_id, coupon["code"])
  return get_order(order_id, x_order_token=tok)


@router.delete("/{order_id}/coupon", response_model=OrderOut)
def remove_coupon(
    order_id: uuid.UUID = Path(..., description="Order ID"),
    x_order_token: Optional[str] = Header(None, alias="X-Order-Token"),
    token: Optional[str] = None,
) -> OrderOut:
  """Remove any applied coupon and return the order at full price."""
  env = get_env()
  ensure_orders_table(env)
  tok = x_order_token or token
  _fetch_order_authorized(env, order_id, tok)  # 404 if missing, 403 if bad token
  _persist_coupon(env, order_id, None)
  return get_order(order_id, x_order_token=tok)


class PaymentWebhookPayload(BaseModel):
  order_id: uuid.UUID


def _core_internal_post(path: str, payload: Dict[str, Any], *, timeout: float = 30.0) -> Dict[str, Any]:
  """POST to a core-service `/internal/*` endpoint with the shared secret.

  Entitlement changes (provisioning an event, changing its plan, granting round
  credits) MUST go through these internal endpoints rather than the public API.
  The public `POST /events` no longer accepts `plan_id`/`payment_status` at all -
  that is what stops a user forging the same request to get a free paid plan.
  """
  base = os.getenv("CORE_SERVICE_URL")
  secret = os.getenv("INTERNAL_API_SECRET")
  if not base:
    raise RuntimeError("CORE_SERVICE_URL not set; cannot reach core-service")
  if not secret:
    # Fail loudly: without the secret core rejects us with 503 and provisioning
    # would silently never complete for a customer who has already paid.
    raise RuntimeError("INTERNAL_API_SECRET not set; cannot provision")
  with httpx.Client(timeout=timeout) as client:
    r = client.post(
        f"{base.rstrip('/')}{path}",
        json=payload,
        headers={"X-Internal-Secret": secret},
    )
    r.raise_for_status()
    try:
      return r.json()
    except Exception:
      return {}


def _grant_round_allowance(event_id: str, delta: int = 1) -> None:
  """Grant paid extra-round credit(s) to an event via core's internal endpoint."""
  _core_internal_post(
      f"/internal/events/{event_id}/rounds-allowance", {"delta": delta}, timeout=15.0
  )
  print(f"[EXTRA_ROUND] granted {delta} round credit(s) to event {event_id}")


def _mask_phone(phone) -> str:
  """PII-safe log form of a phone: keep only the last 4 digits."""
  digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
  return f"***{digits[-4:]}" if digits else "(none)"


def _queue_assistant_intro(env, *, event_id: str, phone: str, first_name: str, event_name: str) -> None:
  """Queue the post-payment AI-assistant intro message (owner_notifications
  outbox, drained by scheduler-service). Idempotent per event via dedupe_key;
  best-effort - provisioning never fails because of it."""
  try:
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"],
        password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
      with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS owner_notifications (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                kind VARCHAR(40) NOT NULL,
                recipient_phone VARCHAR(32) NOT NULL,
                event_id UUID,
                params JSONB NOT NULL DEFAULT '{}',
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0,
                dedupe_key VARCHAR(160) UNIQUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                sent_at TIMESTAMPTZ
            )
            """
        )
        cur.execute(
            """
            INSERT INTO owner_notifications (kind, recipient_phone, event_id, params, dedupe_key)
            VALUES ('assistant_intro', %s, %s, %s::jsonb, %s)
            ON CONFLICT (dedupe_key) DO NOTHING
            """,
            (phone, str(event_id),
             json.dumps({"1": first_name or "חבר/ה", "2": event_name or "האירוע"}, ensure_ascii=False),
             f"assistant_intro:{event_id}"),
        )
        conn.commit()
    print(f"[PROVISION] Assistant intro queued for event {event_id}")
  except Exception as exc:
    print(f"[PROVISION] WARNING: assistant intro queue failed: {exc}")


def provision_order(order_id: uuid.UUID) -> Dict[str, Any]:
  """
  Provision order after payment confirmation.
  - Creates user if not exists (by phone)
  - Creates event in core-service with location as JSON string
  - Creates all campaigns from order.campaigns
  - Updates order status to 'paid'
  
  This function is separated from the webhook endpoint so it can be called
  from different payment providers in the future.
  """
  print(f"[PROVISION] Starting provision for order_id={order_id}")
  env = get_env()
  auth_env = get_auth_env()
  
  # Fetch order
  order_row = _fetch_order(env, order_id)
  print(f"[PROVISION] Fetched order: event_name={order_row.get('event_name')}, status={order_row.get('status')}")
  
  # Log location data
  location_raw = order_row.get("location")
  print(f"[PROVISION] Location raw type={type(location_raw)}, len={len(str(location_raw)) if location_raw else 0}")
  
  # Log campaigns data
  campaigns_raw = order_row.get("campaigns")
  print(f"[PROVISION] Campaigns raw type={type(campaigns_raw)}, count={len(campaigns_raw) if isinstance(campaigns_raw, list) else 'N/A'}")
  if campaigns_raw:
    print(f"[PROVISION] Campaigns raw items={len(campaigns_raw) if isinstance(campaigns_raw, list) else 0}")
  
  # ── Extra-round purchase: no user/event to create - just grant the event one
  #    paid round credit and mark paid. Runs before identity validation (an
  #    extra round is bought by the existing owner for an existing event). ─────
  if order_row.get("kind") == "extra_round":
    event_id = order_row.get("event_id")
    if not event_id:
      raise ValueError("extra-round order missing event_id")
    event_id = str(uuid.UUID(str(event_id)))
    _grant_round_allowance(event_id)
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"],
        password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
      with conn.cursor() as cur:
        cur.execute(
            "UPDATE orders SET status = %s, updated_at = NOW() WHERE order_id = %s",
            ("paid", str(order_id)),
        )
        conn.commit()
    result = {"order_id": str(order_id), "event_id": event_id, "status": "paid"}
    print(f"[PROVISION] Extra-round granted for event {event_id}: {json.dumps(result, default=str)}")
    return result

  # Validate order has required data
  if not order_row.get("phone"):
    raise ValueError("Order missing phone number")
  if not order_row.get("first_name") or not order_row.get("last_name"):
    raise ValueError("Order missing first_name or last_name")
  
  phone = order_row["phone"]
  first_name = order_row["first_name"]
  last_name = order_row["last_name"]
  email = order_row.get("email")
  print(f"[PROVISION] User: phone={_mask_phone(phone)} (name/email redacted)")
  
  # Ensure users table exists
  ensure_users_table(auth_env)
  
  # Check if user exists, create if not
  user_id: Optional[uuid.UUID] = None
  with psycopg2.connect(
      host=auth_env["DB_HOST"],
      port=auth_env["DB_PORT"],
      user=auth_env["DB_USER"],
      password=auth_env["DB_PASSWORD"],
      dbname=auth_env["DB_NAME"],
  ) as conn:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
      # Check if user exists
      cur.execute("SELECT id FROM users WHERE phone = %s", (phone,))
      user_row = cur.fetchone()
      
      if user_row:
        user_id = user_row["id"]
        print(f"[PROVISION] User exists: user_id={user_id}")
      else:
        # Create new user
        cur.execute(
            "INSERT INTO users (phone, email, first_name, last_name, is_verified) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (phone, email, first_name, last_name, True),  # Mark as verified since payment succeeded
        )
        user_id = cur.fetchone()["id"]
        conn.commit()
        print(f"[PROVISION] Created new user: user_id={user_id}")
  
  if not user_id:
    raise RuntimeError("Failed to get or create user")
  
  # Create JWT for the user
  jwt_exp_seconds = int(os.getenv("JWT_EXP_SECONDS", "86400"))  # Default 24 hours
  jwt_token = create_jwt({"user_id": str(user_id)}, jwt_exp_seconds)
  print(f"[PROVISION] Created JWT token for user_id={user_id}")

  # ── In-place plan change: the event already exists, so just update its plan
  #    and finish. No new event or campaigns are provisioned. ─────────────────
  existing_event_id = order_row.get("event_id")
  if existing_event_id:
    event_id = str(uuid.UUID(str(existing_event_id)))
    print(f"[PROVISION] Plan-change order → set event {event_id} plan to '{order_row.get('plan')}'")
    # Internal endpoint, not the public PUT /events: entitlement is backend-owned.
    _core_internal_post(
        f"/internal/provisioning/events/{event_id}/plan",
        {"plan_id": order_row.get("plan"), "order_id": str(order_id)},
    )
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"],
        password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
      with conn.cursor() as cur:
        cur.execute(
            "UPDATE orders SET status = %s, event_id = %s, updated_at = NOW() WHERE order_id = %s",
            ("paid", event_id, str(order_id)),
        )
        conn.commit()
    result = {"order_id": str(order_id), "user_id": str(user_id), "event_id": event_id, "status": "paid"}
    print(f"[PROVISION] Plan change completed: {json.dumps(result, default=str)}")
    return result


  # Prepare event data - save location as JSON string
  location_data = order_row.get("location")
  print(f"[PROVISION] Location from DB: type={type(location_data)}")
  
  # Keep location as JSON string (core-service stores as TEXT)
  location_str = None
  if location_data:
    if isinstance(location_data, dict):
      # Convert dict to JSON string
      location_str = json.dumps(location_data, ensure_ascii=False)
      print(f"[PROVISION] Location converted from dict to JSON string: {location_str[:200]}...")
    elif isinstance(location_data, str):
      # If already a string, try to parse and re-stringify to ensure it's valid JSON
      try:
        parsed = json.loads(location_data)
        location_str = json.dumps(parsed, ensure_ascii=False)
        print(f"[PROVISION] Location parsed and re-stringified from string: {location_str[:200]}...")
      except Exception as e:
        # If not valid JSON, use as-is
        location_str = location_data
        print(f"[PROVISION] Location kept as-is (not valid JSON): {e}, value={location_str[:200]}...")
    else:
      # Try to convert other types to JSON string
      try:
        location_str = json.dumps(location_data, ensure_ascii=False, default=str)
        print(f"[PROVISION] Location converted from {type(location_data)} to JSON string: {location_str[:200]}...")
      except Exception as e:
        print(f"[PROVISION] ERROR: Could not convert location to string: {e}")
        location_str = None
  else:
    print(f"[PROVISION] WARNING: location_data is None or empty!")
  
  print(f"[PROVISION] Final location_str: len={len(location_str) if location_str else 0}")
  
  inviters_data = order_row.get("inviters") or []
  if isinstance(inviters_data, str):
    try:
      inviters_data = json.loads(inviters_data)
    except Exception:
      inviters_data = []
  
  # Prepare event payload for core-service
  event_date = order_row.get("event_date")
  event_date_str = None
  if event_date:
    if isinstance(event_date, datetime):
      event_date_str = event_date.isoformat()
    elif isinstance(event_date, str):
      event_date_str = event_date
  
  event_payload = {
      # Idempotency key: replaying this order (duplicate IPN, retry after a
      # mid-provision crash) resolves to the SAME event instead of a second one.
      "order_id": str(order_id),
      "owner_user_id": str(user_id),
      # Entitlement, set by core from THIS verified order - never from a client.
      "plan_id": order_row.get("plan"),
      "name": order_row["event_name"],
      "description": order_row.get("event_description"),
      "event_date": event_date_str,
      "location": location_str,
      "inviters": inviters_data,
      # Carry the event type through so core-service drives the adaptive timeline
      # and template recommendations from it (was previously dropped here).
      "event_type": order_row.get("event_type"),
      # Carry the event-type-specific subjects so subject variables resolve at
      # delivery exactly as they did in the wizard preview.
      "subjects": order_row.get("subjects"),
  }
  print(f"[PROVISION] Event payload: name={event_payload['name']}, location={location_str[:100] if location_str else None}...")

  core_service_url = os.getenv("CORE_SERVICE_URL")
  print(f"[PROVISION] Provisioning event via core internal API")
  try:
    event_data = _core_internal_post("/internal/provisioning/events", event_payload)
    event_id_raw = event_data.get("id")
    if not event_id_raw:
      raise RuntimeError("Event provisioned but no event_id returned")
    event_id = str(uuid.UUID(str(event_id_raw)))
    if event_data.get("created") is False:
      print(f"[PROVISION] Order already provisioned; reusing event {event_id}")
    print(f"[PROVISION] Event ID: {event_id}")
  except httpx.HTTPError as e:
    print(f"[PROVISION] ERROR creating event: {e}")
    if hasattr(e, 'response') and e.response is not None:
      try:
        error_body = e.response.text
        print(f"[PROVISION] Error response body: {error_body}")
      except:
        pass
    raise RuntimeError(f"Failed to create event in core-service: {e}")
  
  # Create campaigns from order.campaigns - CREATE ALL CAMPAIGNS
  campaigns_data = order_row.get("campaigns") or []
  print(f"[PROVISION] Processing campaigns: raw type={type(campaigns_data)}")
  if isinstance(campaigns_data, str):
    try:
      campaigns_data = json.loads(campaigns_data)
      print(f"[PROVISION] Parsed campaigns from JSON string")
    except Exception as e:
      print(f"[PROVISION] Failed to parse campaigns JSON string: {e}")
      campaigns_data = []
  
  if campaigns_data and isinstance(campaigns_data, list):
    print(f"[PROVISION] Found {len(campaigns_data)} campaigns in order")
    campaign_items = []
    for idx, camp in enumerate(campaigns_data):
      if not isinstance(camp, dict):
        print(f"[PROVISION] Campaign[{idx}] skipped: not a dict")
        continue
      
      # Extract campaign fields
      label = camp.get("label") or camp.get("name") or "Campaign"
      template_id = camp.get("template_id")
      scheduled_at = camp.get("scheduled_at")
      custom_message = camp.get("custom_message")
      print(f"[PROVISION] Campaign[{idx}]: label={label}, template_id={template_id}, scheduled_at={scheduled_at}, custom={bool(custom_message)}")
      
      # Parse scheduled_at if it's a string
      schedule_time = None
      if scheduled_at:
        if isinstance(scheduled_at, str):
          try:
            schedule_time = datetime.fromisoformat(scheduled_at.replace("Z", "+00:00"))
            print(f"[PROVISION] Campaign[{idx}] parsed schedule_time: {schedule_time}")
          except Exception as e:
            print(f"[PROVISION] Campaign[{idx}] failed to parse schedule_time: {e}")
        elif isinstance(scheduled_at, datetime):
          schedule_time = scheduled_at
          print(f"[PROVISION] Campaign[{idx}] schedule_time already datetime: {schedule_time}")
      
      # Create campaign for ALL items with template_id
      if template_id:
        campaign_item = {
            "name": label,
            "template": template_id,
            "channel": "whatsapp",  # Default channel
            "status": "pending",
        }
        # Carry the user-written body so the custom copy is persisted (was dropped).
        if custom_message:
          campaign_item["custom_message"] = custom_message
        # Add schedule_time only if it exists
        if schedule_time:
          campaign_item["schedule_time"] = schedule_time.isoformat()
        campaign_items.append(campaign_item)
        print(f"[PROVISION] Campaign[{idx}] added to batch: {json.dumps(campaign_item, default=str)}")
      else:
        print(f"[PROVISION] Campaign[{idx}] skipped: no template_id")
    
    print(f"[PROVISION] Prepared {len(campaign_items)} campaign items to create")
    
    # Create campaigns in bulk if we have any
    if campaign_items:
      payload = {"items": campaign_items}
      print(f"[PROVISION] {payload}")
      try:
        with httpx.Client(timeout=30.0) as client:
          response = client.post(
              f"{core_service_url}/campaigns",
              params={"event_id": str(event_id)},
              json=payload,
              headers={"Authorization": f"Bearer {jwt_token}"},
          )
          print(f"[PROVISION] Campaigns creation response: status={response.status_code}")
          response.raise_for_status()
          campaigns_result = response.json()
          print(f"[PROVISION] Campaigns created: result={json.dumps(campaigns_result, default=str)}")
          if isinstance(campaigns_result, list):
            print(f"[PROVISION] Successfully created {len(campaigns_result)} campaigns")
          elif isinstance(campaigns_result, dict) and campaigns_result.get("id"):
            print(f"[PROVISION] Successfully created 1 campaign (single item response)")
      except httpx.HTTPError as e:
        # Log but don't fail - campaigns can be created later
        print(f"[PROVISION] ERROR: Failed to create campaigns: {e}")
        if hasattr(e, 'response') and e.response is not None:
          try:
            error_body = e.response.text
            print(f"[PROVISION] Error response body: {error_body}")
          except:
            pass
    else:
      print(f"[PROVISION] WARNING: No campaign items to create (all skipped or no template_id)")
  else:
    print(f"[PROVISION] WARNING: No campaigns data found in order or not a list")
  
  # Event is live and paid - queue the one-time AI-assistant intro WhatsApp
  # message to the owner (owner_notifications outbox; scheduler-service sends).
  _queue_assistant_intro(env, event_id=event_id, phone=phone,
                         first_name=first_name, event_name=order_row.get("event_name") or "")

  # Mark the order paid AND link the created event back to it, so the dashboard
  # can open exactly this event after payment (never a stale selection).
  print(f"[PROVISION] Updating order status to 'paid', linking event_id={event_id}")
  with psycopg2.connect(
      host=env["DB_HOST"],
      port=env["DB_PORT"],
      user=env["DB_USER"],
      password=env["DB_PASSWORD"],
      dbname=env["DB_NAME"],
  ) as conn:
    with conn.cursor() as cur:
      cur.execute(
          """
          UPDATE orders
          SET status = %s, event_id = %s, updated_at = NOW()
          WHERE order_id = %s
          """,
          ("paid", str(event_id), str(order_id)),
      )
      conn.commit()
  
  result = {
      "order_id": str(order_id),
      "user_id": str(user_id),
      "event_id": str(event_id),
      "status": "paid",
  }
  print(f"[PROVISION] Provision completed successfully: {json.dumps(result, default=str)}")
  return result


def _plan_amount(plan_id: Optional[str]) -> float:
  """Numeric charge amount for a plan, from the plans JSON config (price like '₪99')."""
  if not plan_id:
    return 0.0
  plan = get_plan_doc(plan_id)
  if not plan:
    return 0.0
  price_str = str(plan.get("price", "0"))
  digits = "".join(ch for ch in price_str.replace(",", "") if ch.isdigit() or ch == ".")
  try:
    return float(digits) if digits else 0.0
  except ValueError:
    return 0.0


def _is_paid_plan(plan_id: Optional[str]) -> bool:
  """True if a plan is a real PAID subscription (price > 0). Venue Edition and
  Free are access grants, not purchases, so they are NOT paid. Price-based (not a
  hardcoded name list) so new paid tiers are classified correctly automatically."""
  return _plan_amount(plan_id) > 0


def _is_upgrade(order: Dict[str, Any]) -> bool:
  """Purchase TYPE = intent, not account origin. An order is an UPGRADE when the
  customer already holds a paid subscription (their current plan, ``prev_plan``,
  is a paid tier). Everything else - direct signup, or a Venue Edition / Free
  owner buying their first plan - is a NEW PURCHASE.

      Venue Edition → Plus  = NEW PURCHASE   (prev_plan not paid)
      Starter/Basic → Plus  = UPGRADE        (prev_plan paid)
  """
  return _is_paid_plan(order.get("prev_plan"))


def _event_paid_total(event_id) -> float:
  """Money actually received for this event's PLAN purchases, VAT-inclusive.

  Upgrade credit must be backed by real revenue. It used to be
  `_plan_amount(prev_plan)` - the list price of whatever tier the event happened
  to be on - with no check that anyone ever paid it. A plan acquired for ₪0 (a
  100%-off coupon, or a comped/admin event) therefore generated a full-price
  credit against the next purchase, letting a customer reach a paid tier having
  funded none of it.

  Extra-round orders are excluded: they buy rounds, not plan tenure, and must not
  discount a later plan upgrade.
  """
  if not event_id:
    return 0.0
  env = get_env()
  try:
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"],
        password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
      with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT plan, coupon_code, prev_plan, kind FROM orders "
            "WHERE event_id = %s AND status = 'paid' AND COALESCE(kind, 'plan') <> 'extra_round'",
            (str(event_id),),
        )
        rows = cur.fetchall() or []
  except Exception as exc:
    # Fail CLOSED: an unreadable ledger yields no credit. Charging full price is
    # recoverable (support can refund); granting an unbacked credit is not.
    print(f"[BREAKDOWN] paid-total lookup failed for event {event_id}: {exc}")
    return 0.0

  total = 0.0
  for row in rows:
    # Value each past order the same way it was charged, so a discounted purchase
    # credits only what it actually cost.
    total += float(_order_breakdown_static(dict(row)).get("gross") or 0.0)
  return total


def _order_breakdown_static(order: Dict[str, Any]) -> Dict[str, Any]:
  """Breakdown WITHOUT the DB-backed upgrade credit.

  Used when valuing historical orders inside `_event_paid_total`, which would
  otherwise recurse: computing an order's credit requires reading paid orders,
  each of which would compute its own credit, and so on.
  """
  subtotal = _plan_amount(order.get("plan"))
  if _is_upgrade(order):
    return vat_breakdown(subtotal, 0.0)
  coupon = validate_coupon(order.get("coupon_code"), subtotal)
  return vat_breakdown(subtotal, coupon["discount"] if coupon else 0.0)


def _order_breakdown(order: Dict[str, Any]) -> Dict[str, Any]:
  """Authoritative price breakdown for an order, driven by purchase type.

  NEW PURCHASE: full plan price, less any valid coupon (marketing/partner).
  UPGRADE:      full plan price, less a credit for the current paid plan; coupons
                never apply. The credit is the sole adjustment (new − previous).

  Either way ``subtotal`` is the full target-plan price and ``discount`` the
  single negative adjustment, so the PayPage/invoice show price → adjustment →
  total. ``adjustment_kind`` tells the client how to label that line. Coupons are
  re-validated on every read so an expired code never lingers in the price."""
  # Extra-round purchase: a flat VAT-inclusive charge (no plan, no coupon/credit).
  if order.get("kind") == "extra_round":
    amount = float(order.get("round_amount") or 0.0)
    bd = vat_breakdown(amount, 0.0)
    bd["adjustment_kind"] = "none"
    return bd
  subtotal = _plan_amount(order.get("plan"))
  if _is_upgrade(order):
    # Credit for what the customer has ACTUALLY paid for this event, capped at
    # the new price. Derived from the paid-orders ledger, never from the list
    # price of `prev_plan` - see `_event_paid_total`.
    credit = min(_event_paid_total(order.get("event_id")), subtotal)
    bd = vat_breakdown(subtotal, credit)
    bd["adjustment_kind"] = "credit" if credit > 0 else "none"
    return bd
  coupon = validate_coupon(order.get("coupon_code"), subtotal)
  discount = coupon["discount"] if coupon else 0.0
  bd = vat_breakdown(subtotal, discount)
  bd["adjustment_kind"] = "coupon" if discount > 0 else "none"
  return bd


def _public_base(request: Request) -> str:
  """Public origin for building iCount URLs. Prefer PUBLIC_BASE_URL (must be reachable
  by iCount's servers for the IPN); fall back to the request origin for local-only use."""
  cfg = payments_icount.get_config()
  if cfg["public_base_url"]:
    return cfg["public_base_url"]
  return str(request.base_url).rstrip("/")


@router.post("/{order_id}/pay/icount", response_model=Dict[str, Any])
def pay_with_icount(
    order_id: uuid.UUID = Path(...),
    request: Request = None,
    x_order_token: Optional[str] = Header(None, alias="X-Order-Token"),
    token: Optional[str] = None,
) -> Dict[str, Any]:
  """Generate an iCount PayPage for the order and return the hosted-page `url`
  (rendered in an iframe by the frontend) plus the sale_id.

  Persists the iCount sale id on the order so the async IPN can verify and
  provision. Requires buyer identity (set via PATCH /identity) and a positive amount.
  The charge amount is loaded server-side from the plan config - never from the client.
  """
  if not payments_icount.is_configured():
    raise HTTPException(status_code=503, detail="iCount payments are not configured on the server")

  env = get_env()
  ensure_orders_table(env)
  order = _fetch_order_authorized(env, order_id, x_order_token or token)

  if not order.get("phone") or not order.get("first_name"):
    raise HTTPException(status_code=400, detail="Order is missing buyer identity (call /identity first)")

  # iCount adds VAT itself, so strip the VAT off the (discounted) price before
  # sending - the customer ends up paying the displayed VAT-inclusive amount.
  bd = _order_breakdown(order)
  amount = price_before_vat(bd["gross"])
  _obs_payment(order_id, provider="icount", status="started", order=order, amount=bd.get("gross"))
  _obs_log("payment.started", order_id=str(order_id), plan=order.get("plan"), gross=bd.get("gross"))
  if amount <= 0:
    # Nothing left to charge - the customer's existing credit already covers the
    # target plan (a downgrade, or an upgrade fully offset by what they have
    # paid). This used to raise 400, which left the order permanently stuck:
    # unpayable because it cost nothing, and unprovisionable because it was never
    # paid. Settle it directly instead; provisioning is idempotent and verifies
    # nothing is owed, so no payment is skipped that was actually due.
    print(f"[PAY] order {order_id} has nothing to charge (gross={bd['gross']}); provisioning directly")
    if not _claim_order_for_provisioning(env, order_id):
      return {"status": "already_in_progress", "order_id": str(order_id)}
    try:
      result = provision_order(order_id)
    except Exception as exc:
      _release_provisioning_claim(env, order_id)
      raise HTTPException(status_code=500, detail=f"could not apply the plan change: {exc}")
    return {"status": "paid", "no_payment_required": True, "order_id": str(order_id), "result": result}

  # Itemize the charge so the adjustment appears on the PayPage + invoice: a full
  # target-plan price line, plus one negative line (iCount v3 has no coupon field).
  # The kind of that negative line is set by the PURCHASE TYPE, not the origin:
  #   NEW PURCHASE → 'coupon' (marketing/partner discount)
  #   UPGRADE      → 'credit' (remaining value of the current paid plan)
  # Net of the two lines equals the amount charged.
  upgrade = _is_upgrade(order)
  event_label = order.get("event_name") or "אירוע"
  items: List[Dict[str, Any]] = [
      {
          "description": f"ShowUp · {event_label} ({order.get('plan')})",
          "unitprice": price_before_vat(bd["subtotal"]),
          "quantity": 1,
      }
  ]
  if bd["discount"] > 0:
    if upgrade:
      # Credit for the plan the customer already pays for.
      prev_label = order.get("prev_plan")
      neg_label = f"זיכוי על המנוי הנוכחי ({prev_label})" if prev_label else "זיכוי על המנוי הנוכחי"
    else:
      venue_name = None
      if order.get("event_id"):
        venue_name = _core_event_partner(str(order.get("event_id"))).get("venue_name")
      neg_label = f"הנחת שותף · {venue_name}" if venue_name else "הנחת שותף האולם"
    items.append({
        "description": neg_label,
        "unitprice": -price_before_vat(bd["discount"]),
        "quantity": 1,
    })

  full_name = " ".join(filter(None, [order.get("first_name"), order.get("last_name")]))
  base = _public_base(request)
  # PayPage is chosen by purchase type (UPGRADE vs NEW PURCHASE), never by channel.
  paypage_id = payments_icount.paypage_for("upgrade" if upgrade else "new_purchase")
  # Carry the order's capability token back to the checkout page after the iCount
  # redirect (so the returning page can re-read the order), and sign the IPN URL
  # so a forged callback can't trigger provisioning (see icount_callback).
  order_token = order.get("access_token") or ""
  ipn_sig = _order_ipn_sig(order_id)
  print(f"[PAY] order {order_id} type={'upgrade' if upgrade else 'new_purchase'} "
        f"paypage={paypage_id or '<legacy/unset>'} amount={amount}")
  try:
    result = payments_icount.generate_sale(
        order_id=str(order_id),
        items=items,
        full_name=full_name,
        phone=order.get("phone"),
        email=order.get("email"),
        success_url=f"{base}/payment?orderId={order_id}&paid=1&t={order_token}",
        cancel_url=f"{base}/payment?orderId={order_id}&canceled=1&t={order_token}",
        # iCount's paypage IPN does NOT echo custom fields, so carry our order id on
        # the IPN URL query string (preserved on the server-to-server POST). The
        # `sig` HMAC authenticates the callback as originating from the URL we handed
        # iCount - the callback rejects any request whose sig doesn't match.
        ipn_url=f"{base}/api/orders/icount/callback?orderId={order_id}&sig={ipn_sig}",
        paypage_id=paypage_id,
    )
  except Exception as e:
    raise HTTPException(status_code=502, detail=f"iCount error: {e}")

  # Persist the sale id + mark the order awaiting payment.
  with psycopg2.connect(
      host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"],
      password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
  ) as conn:
    with conn.cursor() as cur:
      cur.execute(
          "UPDATE orders SET icount_sale_id = %s, status = %s, updated_at = NOW() WHERE order_id = %s",
          (str(result.get("sale_id")), "payment_pending", str(order_id)),
      )
      conn.commit()

  return {"url": result.get("url"), "sale_id": result.get("sale_id")}


def _order_id_from_callback(env: Dict[str, Any], payload: Dict[str, Any]) -> Optional[uuid.UUID]:
  """Resolve our order from an iCount IPN: prefer the echoed custom field, else
  look up by the stored sale id."""
  # iCount may nest fields under `data`/`sale` and echoes custom fields; be liberal.
  data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
  sale = data.get("sale") if isinstance(data.get("sale"), dict) else data
  candidates = [
      sale.get("custom_order_id"),
      data.get("custom_order_id"),
      payload.get("custom_order_id"),
      # We pass our order id on the IPN URL query string (merged into payload).
      payload.get("orderId"),
      data.get("orderId"),
      sale.get("orderId"),
  ]
  for c in candidates:
    if c:
      try:
        return uuid.UUID(str(c))
      except (ValueError, TypeError):
        pass
  sale_id = sale.get("sale_id") or data.get("sale_id") or payload.get("sale_id")
  if sale_id:
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"],
        password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
      with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT order_id FROM orders WHERE icount_sale_id = %s", (str(sale_id),))
        row = cur.fetchone()
        if row:
          return row["order_id"]
  return None


# Statuses an order may hold while it has not yet been provisioned. Only these
# may be claimed - 'paid' and 'provisioning' are excluded so a claim can never
# re-run a completed or in-flight provisioning.
_CLAIMABLE_STATUSES = ("draft", "event_confirmed", "identity_added", "payment_pending", "underpaid")

# Tolerance when comparing the charged amount to our own breakdown, in ILS.
# Absorbs rounding between our VAT math and iCount's, without leaving room for a
# materially short payment.
_AMOUNT_TOLERANCE_ILS = 1.0


def _verify_paid_amount(order: Dict[str, Any], sale_info: Dict[str, Any]) -> tuple[bool, str]:
  """Check the charged amount covers what the order is worth.

  Returns (ok, detail). When iCount does not state an amount at all we accept -
  refusing would strand legitimate customers on a payload shape we cannot
  control - but the decision is logged so it is visible rather than implicit.
  """
  expected = float(_order_breakdown(order).get("gross") or 0.0)
  actual = payments_icount.paid_amount(sale_info)
  if actual is None:
    return True, f"amount not reported by iCount (expected {expected:.2f}); accepted"
  if actual + _AMOUNT_TOLERANCE_ILS < expected:
    return False, f"charged {actual:.2f} < expected {expected:.2f}"
  return True, f"charged {actual:.2f} >= expected {expected:.2f}"


def _mark_order_status(env, order_id, status: str) -> None:
  """Set an order's status (ops-visible states like 'underpaid')."""
  try:
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"],
        password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
      with conn.cursor() as cur:
        cur.execute(
            "UPDATE orders SET status = %s, updated_at = NOW() WHERE order_id = %s AND status <> 'paid'",
            (status, str(order_id)),
        )
        conn.commit()
  except Exception as exc:
    print(f"[ORDER] failed to set status={status} on {order_id}: {exc}")


def _claim_order_for_provisioning(env, order_id) -> bool:
  """Atomically claim an order for provisioning. True if THIS caller won.

  A conditional UPDATE is the whole mechanism: the database decides the winner,
  so concurrent IPN deliveries cannot both proceed. Previously the code did a
  non-locking `SELECT status` followed by an unguarded provision, so two retries
  arriving together each saw 'payment_pending' and both provisioned.
  """
  with psycopg2.connect(
      host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"],
      password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
  ) as conn:
    with conn.cursor() as cur:
      cur.execute(
          "UPDATE orders SET status = 'provisioning', updated_at = NOW() "
          "WHERE order_id = %s AND status = ANY(%s) RETURNING order_id",
          (str(order_id), list(_CLAIMABLE_STATUSES)),
      )
      claimed = cur.fetchone() is not None
      conn.commit()
  return claimed


def _release_provisioning_claim(env, order_id) -> None:
  """Return a failed claim to 'payment_pending' so it can be retried."""
  try:
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"],
        password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
      with conn.cursor() as cur:
        cur.execute(
            "UPDATE orders SET status = 'payment_pending', updated_at = NOW() "
            "WHERE order_id = %s AND status = 'provisioning'",
            (str(order_id),),
        )
        conn.commit()
  except Exception as exc:
    print(f"[ORDER] failed to release claim on {order_id}: {exc}")


@router.post("/icount/callback")
async def icount_callback(request: Request) -> JSONResponse:
  """Server-to-server IPN from iCount. Re-verifies the sale with iCount
  (authoritative) and provisions the order on success. Always 200 so iCount does not
  retry indefinitely; provisioning is idempotent on already-paid orders."""
  # Parse the IPN defensively from the RAW body + query string. iCount posts
  # form-urlencoded data (and sometimes echoes ids on the query string). We do NOT
  # rely on request.form() - it raises when python-multipart is absent and a bare
  # except would silently leave payload={}, which is exactly what skipped
  # provisioning before. parse_qs handles urlencoded without any extra dependency.
  payload: Dict[str, Any] = {}
  raw_body = b""
  ctype = (request.headers.get("content-type") or "").lower()
  try:
    raw_body = await request.body()
    text = raw_body.decode("utf-8", "ignore").strip()
    if text:
      if "json" in ctype or text.startswith("{"):
        try:
          payload = json.loads(text)
        except Exception:
          payload = {}
      if not payload:
        from urllib.parse import parse_qs
        payload = {k: (v[0] if len(v) == 1 else v) for k, v in parse_qs(text).items()}
  except Exception as e:
    print(f"[ICOUNT IPN] body parse error: {e}")
  if not isinstance(payload, dict):
    payload = {}
  # iCount may also pass identifiers on the query string - merge them in.
  query_params = dict(request.query_params)
  payload = {**query_params, **payload}

  # Log the raw IPN (body + content-type + query) so the field shape is never a
  # mystery again.
  # PII-safe: the IPN body carries buyer name/phone/email - log shape only.
  print(f"[ICOUNT IPN] ctype={ctype!r} body_len={len(raw_body)} keys={sorted(payload.keys()) if isinstance(payload, dict) else type(payload)}")

  env = get_env()
  ensure_orders_table(env)
  order_id = _order_id_from_callback(env, payload)
  if not order_id:
    return JSONResponse(status_code=200, content={"status": "ignored", "reason": "order not found"})

  # Authenticate the IPN: only iCount, replaying the signed URL we configured in
  # pay_with_icount, can present a valid HMAC over this order id. A forged callback
  # (attacker POSTing paid=1) is rejected here BEFORE any provisioning happens.
  provided_sig = str(payload.get("sig") or "")
  try:
    expected_sig = _order_ipn_sig(order_id)
  except IpnSecretMissing as exc:
    # Fail closed: without a signing secret we cannot distinguish iCount from an
    # attacker, so we refuse to provision rather than trust the callback body.
    print(f"[ICOUNT IPN] REFUSING callback for {order_id}: {exc}")
    return JSONResponse(status_code=200, content={"status": "ignored", "reason": "ipn auth not configured"})
  if not provided_sig or not hmac.compare_digest(provided_sig, expected_sig):
    print(f"[ICOUNT IPN] REJECTED: bad/missing sig for order {order_id} (possible forgery)")
    return JSONResponse(status_code=200, content={"status": "ignored", "reason": "bad signature"})

  order = _fetch_order(env, order_id)
  if order.get("status") == "paid":
    return JSONResponse(status_code=200, content={"status": "ok", "already_paid": True})

  # Verify the sale before provisioning. iCount's paypage API has no sale-info
  # lookup (get_sale_info => "bad_method"), so verify from the IPN payload, with a
  # server-side lookup only as a best-effort when it happens to be available.
  sale_id = order.get("icount_sale_id")
  sale_info: Dict[str, Any] = payload
  verified = payments_icount.is_paid(payload)
  if not verified and sale_id:
    try:
      sale_info = payments_icount.get_sale_info(sale_id)
      verified = payments_icount.is_paid(sale_info)
    except Exception as e:
      print(f"[ICOUNT IPN] get_sale_info unavailable ({e}); relying on IPN payload")
  if not verified:
    print(f"[ICOUNT IPN] sale not verified as paid for {order_id}; payload={payload}")
    return JSONResponse(status_code=200, content={"status": "not_approved"})

  # Verify HOW MUCH was charged, not just that a charge happened. Without this a
  # ₪1 sale against a ₪199 order provisions the full plan - `is_paid` returns
  # True on a bare confirmation_code.
  ok_amount, amount_detail = _verify_paid_amount(order, sale_info)
  if not ok_amount:
    print(f"[ICOUNT IPN] REJECTED underpayment for {order_id}: {amount_detail}")
    _mark_order_status(env, order_id, "underpaid")
    _obs_payment(order_id, provider="icount", status="underpaid", order=order)
    _obs_log("payment.failed", level="warning", order_id=str(order_id), reason=amount_detail)
    return JSONResponse(status_code=200, content={"status": "underpaid", "detail": amount_detail})

  # Claim the order before provisioning. iCount retries IPNs, so two deliveries
  # can arrive concurrently; the claim is a conditional UPDATE, so exactly one
  # wins and the loser is a no-op instead of a second provisioning run.
  if not _claim_order_for_provisioning(env, order_id):
    print(f"[ICOUNT IPN] order {order_id} already being provisioned; skipping duplicate")
    return JSONResponse(status_code=200, content={"status": "ok", "already_claimed": True})

  _obs_payment(order_id, provider="icount", status="verified", order=order)
  try:
    result = provision_order(order_id)
    _obs_log("payment.completed", order_id=str(order_id), event_id=result.get("event_id"))
    return JSONResponse(status_code=200, content={"status": "ok", "result": result})
  except Exception as e:
    # Release the claim so the next IPN retry (or reconciliation) can pick it up
    # again - otherwise a transient core-service failure would strand a paid
    # customer in 'provisioning' forever.
    _release_provisioning_claim(env, order_id)
    print(f"[ICOUNT IPN] provisioning failed for {order_id}: {e}")
    # Surface to the ops dashboard: a verified payment that failed to provision is
    # a customer stuck paid-but-eventless and needs an operator's eyes.
    try:
      import traceback
      from shared.ops.errors import record_error, SEVERITY_CRITICAL
      record_error("aub", f"provisioning failed after payment: {e}",
                   severity=SEVERITY_CRITICAL, error_type=type(e).__name__,
                   stack=traceback.format_exc(), context={"order_id": str(order_id)})
    except Exception:
      pass
    # ...and to Sentry (unexpected failure, with payment context on the scope).
    _obs_log("payment.failed", level="error", order_id=str(order_id), reason=str(e))
    _obs_capture(e, operation="provision_order", flow="payment", order_id=str(order_id))
    return JSONResponse(status_code=200, content={"status": "error", "detail": str(e)})


def reconcile_pending_orders(max_age_minutes: int = 15, limit: int = 50) -> Dict[str, Any]:
  """Recover orders whose IPN never arrived, or whose provisioning died midway.

  Why this exists: `pay_with_icount` moves an order to 'payment_pending' and,
  before this, nothing ever revisited it. If iCount's callback was dropped - our
  host briefly 502s, a network blip - the customer's card was charged and no
  event ever appeared, with no automated recovery at all.

  Two recoveries, both safe to run repeatedly:

  * 'provisioning' rows older than the cutoff are stale claims left by a crashed
    provisioning run; they are released so they can be retried.
  * 'payment_pending' rows older than the cutoff are re-verified against iCount
    and provisioned when the sale did in fact complete.

  Orders we cannot verify are reported, never guessed at - provisioning without
  a verified payment is exactly what this whole effort removes.
  """
  env = get_env()
  ensure_orders_table(env)
  cutoff_expr = f"NOW() - INTERVAL '{int(max_age_minutes)} minutes'"

  released = 0
  with psycopg2.connect(
      host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"],
      password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
  ) as conn:
    with conn.cursor() as cur:
      cur.execute(
          f"UPDATE orders SET status = 'payment_pending', updated_at = NOW() "
          f"WHERE status = 'provisioning' AND updated_at < {cutoff_expr}"
      )
      released = cur.rowcount or 0
      conn.commit()

  with psycopg2.connect(
      host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"],
      password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
  ) as conn:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
      cur.execute(
          f"SELECT order_id, icount_sale_id FROM orders "
          f"WHERE status = 'payment_pending' AND icount_sale_id IS NOT NULL "
          f"AND updated_at < {cutoff_expr} ORDER BY updated_at ASC LIMIT %s",
          (int(limit),),
      )
      candidates = cur.fetchall() or []

  provisioned, unverified, errors = [], [], []
  for row in candidates:
    order_id = str(row["order_id"])
    sale_id = row.get("icount_sale_id")
    try:
      sale_info = payments_icount.get_sale_info(sale_id)
    except Exception as exc:
      # get_sale_info is documented as unavailable on the paypage API; when it is
      # we simply cannot self-heal, so surface the order for ops rather than
      # provisioning an unverified payment.
      unverified.append({"order_id": order_id, "reason": f"lookup unavailable: {exc}"})
      continue
    if not payments_icount.is_paid(sale_info):
      unverified.append({"order_id": order_id, "reason": "sale not paid"})
      continue
    order = _fetch_order(env, order_id)
    ok_amount, detail = _verify_paid_amount(order, sale_info)
    if not ok_amount:
      _mark_order_status(env, order_id, "underpaid")
      unverified.append({"order_id": order_id, "reason": detail})
      continue
    if not _claim_order_for_provisioning(env, order_id):
      continue
    try:
      provision_order(uuid.UUID(order_id))
      provisioned.append(order_id)
    except Exception as exc:
      _release_provisioning_claim(env, order_id)
      errors.append({"order_id": order_id, "error": str(exc)})

  summary = {
      "checked": len(candidates),
      "stale_claims_released": released,
      "provisioned": provisioned,
      "unverified": unverified,
      "errors": errors,
  }
  if provisioned or errors or unverified:
    print(f"[RECONCILE] {json.dumps(summary, default=str)}")
  return summary


@router.post("/internal/reconcile", response_model=Dict[str, Any])
def internal_reconcile(
    payload: Dict[str, Any] = Body(default={}),
    x_internal_secret: Optional[str] = Header(None, alias="X-Internal-Secret"),
) -> Dict[str, Any]:
  """Internal: run payment reconciliation. Driven by scheduler-service's loop.

  Lives here rather than in the scheduler because iCount knowledge belongs to
  aub; the scheduler only owns *when* platform jobs run.
  """
  expected = os.getenv("INTERNAL_API_SECRET")
  if not expected:
    raise HTTPException(status_code=503, detail="internal auth not configured")
  if not x_internal_secret or not hmac.compare_digest(str(x_internal_secret), str(expected)):
    raise HTTPException(status_code=403, detail="forbidden")
  try:
    max_age = int(payload.get("max_age_minutes", 15))
  except (TypeError, ValueError):
    max_age = 15
  return reconcile_pending_orders(max_age_minutes=max_age)


@router.post("/webhook/payment", response_model=Dict[str, Any])
@router.put("/webhook/payment", response_model=Dict[str, Any])
def payment_webhook(
    payload: PaymentWebhookPayload = Body(...),
    x_internal_secret: Optional[str] = Header(None, alias="X-Internal-Secret"),
) -> Dict[str, Any]:
  """
  Internal/manual provisioning hook: provisions an order WITHOUT verifying payment,
  so it MUST be authenticated with the internal shared secret. Public payment
  confirmation goes through the signed iCount IPN (`/orders/icount/callback`), never
  here. Left available for internal ops / back-office re-provisioning.
  """
  expected = os.getenv("INTERNAL_API_SECRET")
  if not expected:
    print("[WEBHOOK] ERROR: INTERNAL_API_SECRET not set; refusing unauthenticated provisioning")
    raise HTTPException(status_code=503, detail="internal auth not configured")
  if not x_internal_secret or not hmac.compare_digest(str(x_internal_secret), str(expected)):
    raise HTTPException(status_code=403, detail="forbidden")
  try:
    result = provision_order(payload.order_id)
    return JSONResponse(status_code=200, content=result)
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e))
  except RuntimeError as e:
    raise HTTPException(status_code=500, detail=str(e))
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")
