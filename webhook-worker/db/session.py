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
    # Default to local compose
    return "postgresql+asyncpg://postgres:postgres@postgres:5432/showup"


engine: AsyncEngine = create_async_engine(_database_url(), pool_pre_ping=True, future=True)

AsyncSessionLocal = sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


