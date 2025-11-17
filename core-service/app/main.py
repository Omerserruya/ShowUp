from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from shared.auth.middleware import AuthMiddleware

from app.db import Base, engine
from app.migrations import apply_schema_patches
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

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    # Auth middleware (currently passthrough; extend to validate JWTs)
    app.add_middleware(AuthMiddleware)

    return app


app = create_app()


