import os
import time
import jwt


def _get_secret() -> str:
    secret = os.getenv("JWT_SECRET")
    if not secret:
        raise RuntimeError("JWT_SECRET is not set")
    return secret


def create_jwt(payload: dict, exp_seconds: int) -> str:
    now = int(time.time())
    to_encode = {**payload, "iat": now, "exp": now + int(exp_seconds)}
    token = jwt.encode(to_encode, _get_secret(), algorithm="HS256")
    return token


def verify_jwt(token: str) -> dict:
    decoded = jwt.decode(token, _get_secret(), algorithms=["HS256"])
    return decoded


