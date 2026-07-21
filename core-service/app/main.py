from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from shared.auth.middleware import AuthMiddleware

from app.db import Base, engine
from app.migrations import apply_schema_patches
from app.routers.events import router as events_router
from app.routers.guests import router as guests_router
from app.routers.campaigns import router as campaigns_router
from app.routers.uploads import router as uploads_router
from app.routers.guest_imports import router as guest_imports_router
from app.routers.admin import router as admin_router
from app.routers.custom_fields import router as custom_fields_router
from app.routers.tags import router as tags_router
from app.routers.templates import router as templates_router
from app.routers.timeline import router as timeline_router
from app.routers.event_ops import router as event_ops_router
from app.routers.members import router as members_router
from app.routers.usage_router import router as usage_router
from app.routers.entitlements import router as entitlements_router
from app.routers.catalog import router as catalog_router
from app.routers.messaging_admin import router as messaging_admin_router
from app.routers.public_invite import router as public_invite_router
from app.routers.venues import router as venues_router
from app.routers.assistant import router as assistant_router
from app.routers.internal_provisioning import router as internal_provisioning_router
from app.routers.redeem import router as redeem_router, public_router as redeem_public_router
from app.routers.entitlements_admin import router as entitlements_admin_router
from app.routers.ops import router as ops_router
from app.plans_client import PlanLookupUnavailable


def create_app() -> FastAPI:
    app = FastAPI(
        title="core-service", 
        version="0.1.0",
        json_encoders={},  # Use Pydantic's default serialization
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Create tables on startup for dev; use migrations in production
    # Use checkfirst=True to avoid errors if tables already exist
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        # Check if tables already exist before trying to create them
        from sqlalchemy import inspect
        inspector = inspect(engine)
        existing_tables = inspector.get_table_names()
        
        # Only create tables that don't exist
        tables_to_create = []
        for table_name in Base.metadata.tables.keys():
            if table_name not in existing_tables:
                tables_to_create.append(table_name)
        
        if tables_to_create:
            logger.info(f"Creating missing tables: {tables_to_create}")
            Base.metadata.create_all(bind=engine, checkfirst=True)
        else:
            logger.info("All tables already exist, skipping creation")
        apply_schema_patches(engine)
    except Exception as e:
        # Log error but don't crash - tables might already exist or there might be schema conflicts
        # This can happen if there's a type conflict (e.g., composite type with same name as table)
        error_msg = str(e)
        if "duplicate key value violates unique constraint" in error_msg and "pg_type_typname_nsp_index" in error_msg:
            logger.warning(
                f"Type conflict detected (type with same name as table may exist). "
                f"Assuming tables are already created. Error: {error_msg}"
            )
        else:
            logger.warning(f"Could not create all tables (they may already exist): {e}")

    app.include_router(events_router)
    app.include_router(guests_router)
    app.include_router(campaigns_router)
    app.include_router(uploads_router)
    app.include_router(guest_imports_router)
    app.include_router(admin_router)
    app.include_router(custom_fields_router)
    app.include_router(tags_router)
    app.include_router(templates_router)
    app.include_router(timeline_router)
    app.include_router(event_ops_router)
    app.include_router(members_router)
    app.include_router(usage_router)
    app.include_router(entitlements_router)
    app.include_router(catalog_router)
    app.include_router(messaging_admin_router)
    app.include_router(public_invite_router)
    app.include_router(venues_router)
    app.include_router(assistant_router)
    app.include_router(internal_provisioning_router)
    app.include_router(redeem_public_router)
    app.include_router(redeem_router)
    app.include_router(entitlements_admin_router)
    app.include_router(ops_router)

    @app.exception_handler(PlanLookupUnavailable)
    async def _plan_lookup_unavailable(request, exc: PlanLookupUnavailable):
        """Capacity enforcement fails CLOSED (see app/plans_client.py).

        Handled once here so every write path that consults a plan limit reports
        the same honest 503 - "we cannot verify your plan right now" - instead of
        each route duplicating the translation, or worse, treating an unresolved
        limit as "unlimited".
        """
        logging.getLogger(__name__).error("plan lookup unavailable: %s", exc)
        return JSONResponse(
            status_code=503,
            content={"detail": "plan_limit_unavailable"},
        )

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    # Auth middleware. Public (unauthenticated) surfaces: health, the static
    # plan→feature entitlements matrix, and the public web invitation + RSVP pages.
    app.add_middleware(
        AuthMiddleware,
        allow_unauthenticated_paths=["/healthz", "/entitlements", "/catalog"],
        # `/internal/` is service-to-service (aub→core); each handler enforces the
        # shared X-Internal-Secret itself, so it bypasses the JWT middleware.
        allow_unauthenticated_prefixes=["/entitlements/", "/public/", "/internal/"],
    )

    # Arm Sentry + start the ops heartbeat (best-effort; never blocks boot).
    try:
        from shared.obs import bootstrap
        from shared.obs.fastapi import install_fastapi_observability
        bootstrap("core")
        install_fastapi_observability(app)
    except Exception as exc:
        logging.getLogger(__name__).warning("observability bootstrap failed: %s", exc)

    # Record request latency into the process-local ring the ops dashboard reads.
    import time as _time
    from app.ops_metrics import record_request

    @app.middleware("http")
    async def _latency_mw(request, call_next):
        start = _time.perf_counter()
        response = await call_next(request)
        record_request((_time.perf_counter() - start) * 1000.0)
        return response

    return app


app = create_app()


