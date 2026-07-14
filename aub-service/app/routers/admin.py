"""
Admin API endpoints – user management (aub-service).
All endpoints require admin role.
JWT validation is done inline since aub-service doesn't use shared AuthMiddleware.
"""
import os
import uuid

import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..token_utils import verify_jwt

router = APIRouter(prefix="/admin", tags=["admin"])


def _get_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", 5432)),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        dbname=os.getenv("DB_NAME"),
    )


def get_admin_user_id(authorization: str = Header(None)) -> str:
    """
    Extract user_id from JWT and verify the user has admin role.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    token = authorization.split(" ")[1]
    try:
        decoded = verify_jwt(token)
        user_id = decoded.get("user_id") or decoded.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token: missing user_id")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")

    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT role FROM users WHERE id = %s", (str(user_id),))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=401, detail="User not found")
            if row[0] != "admin":
                raise HTTPException(status_code=403, detail="Admin access required")

    return str(user_id)


# ---------------------------------------------------------------------------
# GET /admin/users – list all users (paginated, searchable)
# ---------------------------------------------------------------------------
@router.get("/users")
def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query("", alias="search"),
    admin_id: str = Depends(get_admin_user_id),
):
    offset = (page - 1) * page_size
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if search:
                like = f"%{search}%"
                cur.execute(
                    "SELECT COUNT(*) FROM users WHERE first_name ILIKE %s OR last_name ILIKE %s OR phone ILIKE %s OR email ILIKE %s",
                    (like, like, like, like),
                )
                total = cur.fetchone()["count"]
                cur.execute(
                    "SELECT id, phone, email, first_name, last_name, role, status, is_verified, last_login, created_at, updated_at "
                    "FROM users WHERE first_name ILIKE %s OR last_name ILIKE %s OR phone ILIKE %s OR email ILIKE %s "
                    "ORDER BY created_at DESC LIMIT %s OFFSET %s",
                    (like, like, like, like, page_size, offset),
                )
            else:
                cur.execute("SELECT COUNT(*) FROM users")
                total = cur.fetchone()["count"]
                cur.execute(
                    "SELECT id, phone, email, first_name, last_name, role, status, is_verified, last_login, created_at, updated_at "
                    "FROM users ORDER BY created_at DESC LIMIT %s OFFSET %s",
                    (page_size, offset),
                )
            rows = cur.fetchall()

    users = []
    for r in rows:
        users.append({
            "id": str(r["id"]),
            "phone": r["phone"],
            "email": r["email"] or "",
            "first_name": r["first_name"],
            "last_name": r["last_name"],
            "role": r["role"] or "user",
            "status": r.get("status") or "active",
            "is_verified": r["is_verified"],
            "last_login": r["last_login"].isoformat() if r["last_login"] else None,
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
        })

    return JSONResponse(content={"users": users, "total": total, "page": page, "page_size": page_size})


# ---------------------------------------------------------------------------
# POST /admin/users – create a new user
# ---------------------------------------------------------------------------
@router.post("/users", status_code=201)
def create_user(
    payload: dict = Body(...),
    admin_id: str = Depends(get_admin_user_id),
):
    phone = (payload.get("phone") or "").strip()
    first_name = (payload.get("first_name") or "").strip()
    last_name = (payload.get("last_name") or "").strip()
    email = (payload.get("email") or "").strip() or None
    role = (payload.get("role") or "user").strip()
    status = (payload.get("status") or "active").strip()

    if not phone:
        raise HTTPException(status_code=400, detail="phone is required")
    if not first_name:
        raise HTTPException(status_code=400, detail="first_name is required")
    if role not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="role must be 'user' or 'admin'")
    if status not in ("active", "suspended"):
        raise HTTPException(status_code=400, detail="status must be 'active' or 'suspended'")

    with _get_conn() as conn:
        conn.autocommit = True
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # phone is UNIQUE - reject duplicates with a clean 409.
            cur.execute("SELECT 1 FROM users WHERE phone = %s", (phone,))
            if cur.fetchone():
                raise HTTPException(status_code=409, detail="משתמש עם מספר טלפון זה כבר קיים")
            try:
                cur.execute(
                    "INSERT INTO users (phone, email, first_name, last_name, role, status) "
                    "VALUES (%s, %s, %s, %s, %s, %s) "
                    "RETURNING id, phone, email, first_name, last_name, role, status, is_verified, last_login, created_at, updated_at",
                    (phone, email, first_name, last_name, role, status),
                )
            except psycopg2.errors.UniqueViolation:
                raise HTTPException(status_code=409, detail="משתמש עם מספר טלפון זה כבר קיים")
            r = cur.fetchone()

    return JSONResponse(status_code=201, content={
        "id": str(r["id"]),
        "phone": r["phone"],
        "email": r["email"] or "",
        "first_name": r["first_name"],
        "last_name": r["last_name"],
        "role": r["role"] or "user",
        "status": r.get("status") or "active",
        "is_verified": r["is_verified"],
        "last_login": r["last_login"].isoformat() if r["last_login"] else None,
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
    })


# ---------------------------------------------------------------------------
# GET /admin/users/{user_id} – get single user
# ---------------------------------------------------------------------------
@router.get("/users/{user_id}")
def get_user(
    user_id: str,
    admin_id: str = Depends(get_admin_user_id),
):
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id, phone, email, first_name, last_name, role, status, is_verified, last_login, created_at, updated_at "
                "FROM users WHERE id = %s",
                (user_id,),
            )
            r = cur.fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="User not found")

    return JSONResponse(content={
        "id": str(r["id"]),
        "phone": r["phone"],
        "email": r["email"] or "",
        "first_name": r["first_name"],
        "last_name": r["last_name"],
        "role": r["role"] or "user",
        "status": r.get("status") or "active",
        "is_verified": r["is_verified"],
        "last_login": r["last_login"].isoformat() if r["last_login"] else None,
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
    })


# ---------------------------------------------------------------------------
# PUT /admin/users/{user_id} – update user
# ---------------------------------------------------------------------------
@router.put("/users/{user_id}")
def update_user(
    user_id: str,
    payload: dict = Body(...),
    admin_id: str = Depends(get_admin_user_id),
):
    allowed_fields = {"first_name", "last_name", "email", "role", "status"}
    updates = {k: v for k, v in payload.items() if k in allowed_fields and v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    if "role" in updates and updates["role"] not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="role must be 'user' or 'admin'")
    if "status" in updates and updates["status"] not in ("active", "suspended"):
        raise HTTPException(status_code=400, detail="status must be 'active' or 'suspended'")

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [user_id]

    with _get_conn() as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE users SET {set_clause}, updated_at = NOW() WHERE id = %s",
                values,
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="User not found")

    return JSONResponse(content={"status": "updated"})


# ---------------------------------------------------------------------------
# DELETE /admin/users/{user_id} – delete user (prevent self-deletion)
# ---------------------------------------------------------------------------
@router.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    admin_id: str = Depends(get_admin_user_id),
):
    if admin_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    with _get_conn() as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="User not found")

    return JSONResponse(content={"status": "deleted"})


# ---------------------------------------------------------------------------
# GET /admin/user-stats – user + subscription counts (aub side of the dashboard)
# (distinct path from core's /admin/stats so nginx can route each unambiguously)
# ---------------------------------------------------------------------------
@router.get("/user-stats")
def admin_user_stats(admin_id: str = Depends(get_admin_user_id)):
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT count(*) c, count(*) FILTER (WHERE role='admin') admins, "
                        "count(*) FILTER (WHERE status='suspended') suspended, "
                        "count(*) FILTER (WHERE is_verified) verified FROM users")
            u = cur.fetchone()
            orders = {}
            paid = 0
            try:
                cur.execute("SELECT status, count(*) c FROM orders GROUP BY status")
                orders = {row["status"]: row["c"] for row in cur.fetchall()}
                paid = orders.get("paid", 0)
            except Exception:
                pass
    return JSONResponse(content={
        "users": {"total": u["c"], "admins": u["admins"], "suspended": u["suspended"], "verified": u["verified"]},
        "subscriptions": {"paid": paid, "by_status": orders},
    })


# ---------------------------------------------------------------------------
# GET /admin/orders – subscriptions/orders overview (read-only)
# ---------------------------------------------------------------------------
@router.get("/orders")
def list_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    status: str = Query("", alias="status"),
    admin_id: str = Depends(get_admin_user_id),
):
    offset = (page - 1) * page_size
    where, params = "", []
    if status:
        where = "WHERE status = %s"
        params.append(status)
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            try:
                cur.execute(f"SELECT count(*) c FROM orders {where}", params)
                total = cur.fetchone()["c"]
                cur.execute(
                    "SELECT order_id, status, plan, prev_plan, coupon_code, event_id, event_name, "
                    "first_name, last_name, phone, order_date "
                    f"FROM orders {where} ORDER BY order_date DESC LIMIT %s OFFSET %s",
                    params + [page_size, offset],
                )
                rows = cur.fetchall()
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"orders unavailable: {e}")
    orders = [{
        "order_id": str(r["order_id"]),
        "status": r["status"],
        "plan": r["plan"],
        "prev_plan": r["prev_plan"],
        "coupon_code": r["coupon_code"],
        "event_id": str(r["event_id"]) if r["event_id"] else None,
        "event_name": r["event_name"],
        "buyer": (f"{r['first_name'] or ''} {r['last_name'] or ''}".strip() or None),
        "phone": r["phone"],
        "order_date": r["order_date"].isoformat() if r["order_date"] else None,
    } for r in rows]
    return JSONResponse(content={"orders": orders, "total": total, "page": page, "page_size": page_size})


# ---------------------------------------------------------------------------
# GET /admin/coupons – coupon catalogue (read-only; sourced from COUPONS_JSON)
# ---------------------------------------------------------------------------
@router.get("/coupons")
def list_coupons(admin_id: str = Depends(get_admin_user_id)):
    from app.pricing import load_coupons
    cat = load_coupons()
    coupons = [{
        "code": code,
        "type": meta.get("type"),
        "value": meta.get("value"),
        "label": meta.get("label"),
    } for code, meta in cat.items()]
    return JSONResponse(content={
        "coupons": coupons,
        "default_venue_coupon": os.getenv("DEFAULT_VENUE_COUPON"),
        "note": "Coupons are configured via the COUPONS_JSON env var (read-only here).",
    })


# ---------------------------------------------------------------------------
# Plans / editions management
#
# Read model composes three sources of truth (no duplication):
#   • plans.json (via plans_data)        → pricing, guest limit, marketing copy
#   • shared entitlements matrix (core)  → capabilities per plan
#   • plan_overrides table (this service)→ runtime enable/disable
# Editing is intentionally minimal for V1: enable/disable only. Everything else
# is catalogue config edited via deploy, so the console never has to change to
# add a new plan - a new plans.json entry shows up here automatically.
# ---------------------------------------------------------------------------

def _env() -> dict:
    return {
        "DB_HOST": os.getenv("DB_HOST"),
        "DB_PORT": int(os.getenv("DB_PORT", 5432)),
        "DB_USER": os.getenv("DB_USER"),
        "DB_PASSWORD": os.getenv("DB_PASSWORD"),
        "DB_NAME": os.getenv("DB_NAME"),
    }


def _capability_matrix() -> tuple[dict, list, bool]:
    """Fetch the plan→capabilities matrix + full feature catalogue from core's
    public /entitlements endpoint. Best-effort: returns ({}, [], False) if core
    is unreachable so the plans page still renders pricing/limits/toggle."""
    base = os.getenv("CORE_SERVICE_URL")
    if not base:
        return {}, [], False
    try:
        import httpx
        with httpx.Client(timeout=5.0) as client:
            r = client.get(f"{base.rstrip('/')}/entitlements")
            if r.status_code != 200:
                return {}, [], False
            data = r.json()
            return data.get("plans", {}) or {}, data.get("features", []) or [], True
    except Exception as exc:  # pragma: no cover
        print(f"[ADMIN_PLANS] capability matrix unavailable: {exc}")
        return {}, [], False


def _plan_view(plan: dict, overrides: dict, matrix: dict) -> dict:
    from app import plan_overrides as po
    pid = plan.get("id")
    ov = overrides.get(pid)
    return {
        "id": pid,
        "title": plan.get("title", ""),
        "subtitle": plan.get("subtitle", ""),
        "description": plan.get("description", ""),
        "price": plan.get("price", ""),
        "color": plan.get("color", ""),
        "count_limit": plan.get("count_limit"),          # None = unlimited
        "is_popular": bool(plan.get("is_popular", False)),
        "is_active_default": bool(plan.get("is_active", True)),
        "is_active": po.effective_is_active(plan, overrides),
        "is_overridden": ov is not None and ov.get("is_active") is not None,
        "overridden_by": ov.get("updated_by") if ov else None,
        "overridden_at": ov.get("updated_at") if ov else None,
        "features": plan.get("features", []),            # marketing bullets
        "capabilities": matrix.get(pid, []),             # entitlement feature keys (SSOT)
        "campaigns_count": len(plan.get("campaigns", []) or []),
    }


@router.get("/plans")
def list_plans(admin_id: str = Depends(get_admin_user_id)):
    """All plans/editions (including non-purchasable ones like starter/venue),
    enriched with capabilities + effective enable/disable state."""
    from app.plans_data import load_plans
    from app import plan_overrides as po
    overrides = po.get_overrides(_env())
    matrix, feature_catalogue, capabilities_available = _capability_matrix()
    plans = [_plan_view(p, overrides, matrix) for p in load_plans()]
    return JSONResponse(content={
        "plans": plans,
        "feature_catalogue": feature_catalogue,
        "capabilities_available": capabilities_available,
        "note": (
            "Pricing, limits and capabilities are catalogue config (edited via deploy). "
            "Enable/disable is editable here and persists in the database."
        ),
    })


class PlanActiveUpdate(BaseModel):
    is_active: bool


@router.put("/plans/{plan_id}")
def update_plan(plan_id: str, payload: PlanActiveUpdate = Body(...), admin_id: str = Depends(get_admin_user_id)):
    """Enable/disable a plan (the only editable field in V1). A disabled plan
    disappears from the public /plans listing; existing events on it keep working
    (single-plan lookups and pricing still resolve it)."""
    from app.plans_data import get_plan
    from app import plan_overrides as po
    if get_plan(plan_id) is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    row = po.set_active_override(_env(), plan_id, payload.is_active, admin_id)
    return JSONResponse(content=row)
