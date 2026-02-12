from __future__ import annotations

import os
import uuid

import psycopg2
from fastapi import Request, HTTPException, status


def get_admin_user_id(request: Request) -> uuid.UUID:
    """
    Get user ID from request state (set by AuthMiddleware) and verify admin role.
    Raises 403 if user is not an admin.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not authenticated",
        )

    # Check admin role in DB
    db_host = os.getenv("DB_HOST")
    db_port = int(os.getenv("DB_PORT", 5432))
    db_user = os.getenv("DB_USER")
    db_password = os.getenv("DB_PASSWORD")
    db_name = os.getenv("DB_NAME")

    with psycopg2.connect(
        host=db_host, port=db_port, user=db_user, password=db_password, dbname=db_name,
    ) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT role FROM users WHERE id = %s", (str(user_id),))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not found",
                )
            if row[0] != "admin":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Admin access required",
                )

    return user_id
