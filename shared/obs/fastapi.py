"""FastAPI wiring - one call installs correlation + user context per request.

`install_fastapi_observability(app)` adds a middleware that, for every request:

* clears any leftover flow context (each request starts clean),
* adopts the inbound `X-Correlation-ID` (or mints one) and binds it to the
  contextvar + Sentry scope, and echoes it back on the response so the caller
  and logs can line up,
* best-effort tags the authenticated user (id + role) onto the Sentry scope by
  decoding the Bearer token - decode-only, purely for context, never trusted for
  auth (AuthMiddleware remains the authority).

Unhandled 5xx are captured by the Sentry FastAPI integration (auto-enabled);
handled 4xx / HTTPException are NOT, which is exactly the expected-vs-unexpected
split the spec asks for. So this helper adds context, not duplicate capture.
"""
from __future__ import annotations

import os

from .context import clear_context, set_user
from .correlation import CORRELATION_HEADER, bind


def _tag_user(request) -> None:
    # Prefer what AuthMiddleware already resolved.
    uid = getattr(getattr(request, "state", None), "user_id", None)
    role = None
    if uid is None:
        # Fall back to a decode-only peek at the Bearer token (context, not auth).
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            try:
                import jwt
                secret = os.getenv("JWT_SECRET") or ""
                claims = jwt.decode(auth.split(" ", 1)[1], secret, algorithms=["HS256"],
                                    options={"verify_signature": bool(secret)})
                uid = claims.get("user_id") or claims.get("sub")
                role = claims.get("role")
            except Exception:
                return
    if uid:
        set_user(user_id=uid, role=role)


def install_fastapi_observability(app) -> None:
    @app.middleware("http")
    async def _observability(request, call_next):
        clear_context()
        cid = bind(request.headers.get(CORRELATION_HEADER))
        try:
            _tag_user(request)
        except Exception:
            pass
        response = await call_next(request)
        try:
            response.headers[CORRELATION_HEADER] = cid
        except Exception:
            pass
        return response
