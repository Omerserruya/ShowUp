"""
Orders API endpoints (pre-payment order flow)
"""
import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, Body, HTTPException, Path
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


router = APIRouter(prefix="/orders", tags=["orders"])


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


class CampaignItem(BaseModel):
  label: str
  template_id: Optional[str] = None
  scheduled_at: Optional[datetime] = None


class OrderCreate(BaseModel):
  plan: str
  event_name: str
  event_description: Optional[str] = None
  event_type: Optional[str] = None
  event_date: Optional[datetime] = None
  location: Optional[Dict[str, Any]] = None
  inviters: Optional[List[Dict[str, Any]]] = None
  campaigns: Optional[List[CampaignItem]] = None


class OrderIdentityUpdate(BaseModel):
  first_name: str
  last_name: str
  phone: str
  email: str


class OrderOut(BaseModel):
  order_id: uuid.UUID
  status: str
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


@router.post("", response_model=Dict[str, uuid.UUID])
def create_order(payload: OrderCreate = Body(...)) -> Dict[str, uuid.UUID]:
  """
  Step 1 – Create order after event approval.
  - Creates a new order row with status 'event_confirmed'
  - Returns the generated order_id
  """
  env = get_env()
  ensure_orders_table(env)

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
              event_name,
              event_description,
              event_type,
              event_date,
              location,
              inviters,
              campaigns
          )
          VALUES (
              %s,
              %s,
              %s,
              %s,
              %s,
              %s,
              %s::jsonb,
              %s::jsonb,
              %s::jsonb
          )
          RETURNING order_id
          """,
          (
              "event_confirmed",
              payload.plan,
              payload.event_name,
              payload.event_description,
              payload.event_type,
              payload.event_date,
              psycopg2.extras.Json(payload.location) if payload.location is not None else None,
              psycopg2.extras.Json(payload.inviters) if payload.inviters is not None else None,
              # Use Pydantic's JSON mode so datetimes become ISO strings before jsonb insert
              psycopg2.extras.Json(
                  [c.model_dump(mode="json") for c in payload.campaigns]
              ) if payload.campaigns else None,
          ),
      )
      row = cur.fetchone()
      order_id = row["order_id"]

  return {"order_id": order_id}


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


@router.patch("/{order_id}/identity", response_model=OrderOut)
def update_order_identity(
    order_id: uuid.UUID = Path(..., description="Order ID"),
    payload: OrderIdentityUpdate = Body(...),
) -> OrderOut:
  """
  Step 2 – Add buyer personal details.
  - Updates identity fields on existing order
  - Transitions status to 'identity_added'
  - Idempotent: multiple calls with same data are safe
  """
  env = get_env()
  ensure_orders_table(env)

  # Fetch current order and status
  order_row = _fetch_order(env, order_id)
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
def get_order(order_id: uuid.UUID = Path(..., description="Order ID")) -> OrderOut:
  """
  Retrieve an order by order_id.
  Used for checkout resume / abandonment recovery.
  """
  env = get_env()
  ensure_orders_table(env)

  row = _fetch_order(env, order_id)
  # Decode JSONB if needed (psycopg2 usually returns proper Python types)
  return OrderOut(**row)

