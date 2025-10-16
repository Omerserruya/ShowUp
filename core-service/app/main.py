from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from shared.auth.middleware import AuthMiddleware

from app.db import Base, engine
from app.routers.events import router as events_router
from app.routers.guests import router as guests_router
from app.routers.campaigns import router as campaigns_router


def create_app() -> FastAPI:
    app = FastAPI(title="core-service", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Create tables on startup for dev; use migrations in production
    Base.metadata.create_all(bind=engine)

    app.include_router(events_router)
    app.include_router(guests_router)
    app.include_router(campaigns_router)

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    # Auth middleware (currently passthrough; extend to validate JWTs)
    app.add_middleware(AuthMiddleware)

    return app


app = create_app()


