from __future__ import annotations

import uuid
from fastapi import Request, HTTPException, status


def get_current_user_id(request: Request) -> uuid.UUID:
    """
    Get user ID from request state (set by AuthMiddleware).
    JWT verification is handled in middleware, not here.
    """
    user_id = getattr(request.state, 'user_id', None)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not authenticated"
        )
    return user_id


