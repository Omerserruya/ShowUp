import os
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker


def _database_url() -> str:
    url = os.getenv("POSTGRES_URL") or os.getenv("DATABASE_URL")
    if url and url.startswith("postgresql://"):
        # Convert to async driver
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url
    # Build from environment variables
    db_host = os.getenv("DB_HOST", "postgres")
    db_port = os.getenv("DB_PORT", "5432")
    db_user = os.getenv("DB_USER", "postgres")
    db_password = os.getenv("DB_PASSWORD", "postgres")
    db_name = os.getenv("DB_NAME", "postgres")
    return f"postgresql+asyncpg://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"


engine: AsyncEngine = create_async_engine(_database_url(), pool_pre_ping=True, future=True)

AsyncSessionLocal = sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


