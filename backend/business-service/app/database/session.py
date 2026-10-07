"""
Async engine/session factory, and the Unit of Work implementation.

Unit of Work pattern: one UoW instance == one database transaction. Use
cases receive a UoW (via FastAPI DI), do their work through repositories
obtained from it, and either commit or roll back exactly once. This keeps
transaction boundaries in the application layer, matching where
@Transactional lived in the original Spring Boot use cases.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config.settings import get_settings

_settings = get_settings()

engine = create_async_engine(
    _settings.database_url,
    echo=_settings.database_echo,
    poolclass=NullPool,
)

AsyncSessionFactory = async_sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


class UnitOfWork:
    """
    One transaction. Repositories are created lazily against `self.session`
    by the code that needs them (see modules/*/infrastructure/persistence).
    `async with UnitOfWork() as uow:` commits on clean exit, rolls back on
    any exception - mirroring @Transactional semantics.
    """

    def __init__(self) -> None:
        self.session: AsyncSession | None = None

    async def __aenter__(self) -> "UnitOfWork":
        self.session = AsyncSessionFactory()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        assert self.session is not None
        try:
            if exc_type is None:
                await self.session.commit()
            else:
                await self.session.rollback()
        finally:
            await self.session.close()

    async def commit(self) -> None:
        assert self.session is not None
        await self.session.commit()

    async def rollback(self) -> None:
        assert self.session is not None
        await self.session.rollback()


async def get_uow() -> AsyncIterator[UnitOfWork]:
    """FastAPI dependency: yields a UnitOfWork scoped to one request."""
    async with UnitOfWork() as uow:
        yield uow


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: yields an AsyncSession scoped to one request."""
    async with AsyncSessionFactory() as session:
        yield session


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Plain session context manager for non-request contexts (workers, scripts)."""
    async with AsyncSessionFactory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
