"""Back up the configured SQLite database, then upgrade to the single warehouse."""
from __future__ import annotations

import asyncio
from datetime import datetime
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from app.config.settings import get_settings
from app.database.single_warehouse_migration import migrate


async def main():
    url = make_url(get_settings().database_url)
    if url.get_backend_name() == "sqlite":
        source = Path(url.database).resolve()
        if not source.is_file():
            raise RuntimeError(f"Database does not exist: {source}")
        backups = source.parent / "backups"
        backups.mkdir(exist_ok=True)
        backup = backups / f"before-single-warehouse-{datetime.now():%Y%m%d-%H%M%S-%f}.db"
        with sqlite3.connect(source) as src, sqlite3.connect(backup) as dst:
            src.backup(dst)
        print(f"Backup: {backup}")
    else:
        raise RuntimeError("For PostgreSQL, take an operational backup and run migrate(connection) in a managed migration transaction")
    engine = create_async_engine(url)
    try:
        async with engine.begin() as connection:
            # SQLite otherwise starts DDL outside a transaction. Explicit BEGIN
            # makes the schema and data changes roll back together on failure.
            await connection.exec_driver_sql("BEGIN IMMEDIATE")
            result = await connection.run_sync(migrate)
            violations = (await connection.exec_driver_sql("PRAGMA foreign_key_check")).all()
            if violations:
                raise RuntimeError(f"Foreign-key validation failed: {violations}")
            integrity = (await connection.exec_driver_sql("PRAGMA integrity_check")).scalar_one()
            if integrity != "ok":
                raise RuntimeError(f"Integrity check failed: {integrity}")
        print(json.dumps(result))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
