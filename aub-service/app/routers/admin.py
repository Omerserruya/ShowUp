"""
Admin API endpoints – user management (aub-service).
All endpoints require admin role.
"""
import os
import uuid

import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from shared.auth.admin import get_admin_user_id

router = APIRouter(prefix="/admin", tags=["admin"])


def _get_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", 5432)),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        dbname=os.getenv("DB_NAME"),
    )


# ---------------------------------------------------------------------------
# GET /admin/users – list all users (paginated, searchable)
# ---------------------------------------------------------------------------
@router.get("/users")
def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query("", alias="search"),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
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
                    "SELECT id, phone, email, first_name, last_name, role, is_verified, last_login, created_at, updated_at "
                    "FROM users WHERE first_name ILIKE %s OR last_name ILIKE %s OR phone ILIKE %s OR email ILIKE %s "
                    "ORDER BY created_at DESC LIMIT %s OFFSET %s",
                    (like, like, like, like, page_size, offset),
                )
            else:
                cur.execute("SELECT COUNT(*) FROM users")
                total = cur.fetchone()["count"]
                cur.execute(
                    "SELECT id, phone, email, first_name, last_name, role, is_verified, last_login, created_at, updated_at "
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
            "is_verified": r["is_verified"],
            "last_login": r["last_login"].isoformat() if r["last_login"] else None,
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
        })

    return JSONResponse(content={"users": users, "total": total, "page": page, "page_size": page_size})


# ---------------------------------------------------------------------------
# GET /admin/users/{user_id} – get single user
# ---------------------------------------------------------------------------
@router.get("/users/{user_id}")
def get_user(
    user_id: str,
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id, phone, email, first_name, last_name, role, is_verified, last_login, created_at, updated_at "
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
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    allowed_fields = {"first_name", "last_name", "email", "role"}
    updates = {k: v for k, v in payload.items() if k in allowed_fields and v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    if "role" in updates and updates["role"] not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="role must be 'user' or 'admin'")

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
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    if str(admin_id) == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    with _get_conn() as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="User not found")

    return JSONResponse(content={"status": "deleted"})
