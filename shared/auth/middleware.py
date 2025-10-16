from __future__ import annotations

import os
import uuid
from typing import Callable

import jwt
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware


class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, allow_unauthenticated_paths: list[str] | None = None):
        super().__init__(app)
        self.allow_unauthenticated_paths = set(allow_unauthenticated_paths or ["/healthz", "/docs", "/openapi.json", "/redoc", "/events/test"])
        self.jwt_secret = os.getenv("JWT_SECRET")

    async def dispatch(self, request: Request, call_next: Callable[[Request], Response]) -> Response:
        # Skip auth for public endpoints
        if request.url.path in self.allow_unauthenticated_paths:
            return await call_next(request)

        # Extract and validate JWT token
        authorization = request.headers.get("Authorization")
        if not authorization or not authorization.startswith("Bearer "):
            return Response(
                content='{"detail": "Missing or invalid Authorization header. Expected: \'Bearer <token>\'"}',
                status_code=401,
                media_type="application/json"
            )
        
        token = authorization.split(" ")[1]
        
        try:
            # Verify JWT token
            payload = jwt.decode(token, self.jwt_secret, algorithms=["HS256"])

            # Accept either `user_id` or `sub` in the JWT payload.
            # If value is not a UUID, map it deterministically to a UUID using UUIDv5.
            raw_identity = payload.get("user_id") or payload.get("sub")
            if not raw_identity:
                return Response(
                    content='{"detail": "Invalid token: missing user_id/sub"}',
                    status_code=401,
                    media_type="application/json"
                )

            try:
                resolved_user_id = uuid.UUID(str(raw_identity))
            except ValueError:
                # Deterministically derive a UUID from the provided subject string
                resolved_user_id = uuid.uuid5(uuid.NAMESPACE_URL, f"showup:user:{raw_identity}")

            # Store user_id in request state for use in endpoints
            request.state.user_id = resolved_user_id
            
            # Continue to the endpoint
            return await call_next(request)
            
        except jwt.ExpiredSignatureError:
            return Response(
                content='{"detail": "Token expired"}',
                status_code=401,
                media_type="application/json"
            )
        except jwt.InvalidTokenError:
            return Response(
                content='{"detail": "Invalid token"}',
                status_code=401,
                media_type="application/json"
            )
        except ValueError as e:
            return Response(
                content=f'{{"detail": "Invalid user_id in token: {str(e)}"}}',
                status_code=401,
                media_type="application/json"
            )


