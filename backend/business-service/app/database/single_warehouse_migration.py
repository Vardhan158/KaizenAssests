"""Data-preserving upgrade from the retired store hierarchy to one warehouse.

Run with scripts/migrate_single_warehouse.py before starting the updated service.
Historical Alembic revisions are deliberately not rewritten.
"""
from __future__ import annotations

import re
from sqlalchemy import inspect, text

TABLE_NAMES = {
    "store": "warehouse_configuration",
    "store_zone": "warehouse_zone",
    "store_bin": "warehouse_bin",
    "store_rack": "warehouse_rack",
    "store_manager_user": "user_account",
}


def column_name(name: str) -> str:
    return name.replace("store_manager", "warehouse_operator").replace("store_id", "warehouse_ref_id").replace("store_code", "warehouse_code").replace("store_name", "warehouse_name").replace("store_type", "warehouse_type")


def _shared_accounts(connection):
    """Staff accounts no longer need a per-location ownership assignment."""
    if not inspect(connection).has_table("user_account"):
        return
    columns = {c["name"]: c for c in inspect(connection).get_columns("user_account")}
    column = columns.get("warehouse_ref_id")
    if column and not column["nullable"]:
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        operations = Operations(MigrationContext.configure(connection))
        with operations.batch_alter_table("user_account") as batch:
            batch.alter_column("warehouse_ref_id", existing_type=column["type"], nullable=True)

    # These fields are part of admin-created staff accounts. SQLite does not
    # support the PostgreSQL `ADD COLUMN IF NOT EXISTS` startup DDL, so keep the
    # standalone migration authoritative for both databases.
    additions = {
        "shift_name": "VARCHAR(64)",
        "assembly_unit_code": "VARCHAR(64)",
        "page_permissions": (
            "JSON NOT NULL DEFAULT '{}'"
            if connection.dialect.name == "sqlite"
            else "JSONB NOT NULL DEFAULT '{}'::jsonb"
        ),
    }
    for name, definition in additions.items():
        if name not in columns:
            connection.exec_driver_sql(f'ALTER TABLE "user_account" ADD COLUMN "{name}" {definition}')


def migrate(connection) -> dict:
    """Rename physical tables/columns and merge warehouse ownership atomically."""
    tables = inspect(connection).get_table_names()
    if "store" not in tables:
        if "warehouse_configuration" not in tables:
            return {"changed": False, "reason": "No legacy warehouse configuration"}
        _shared_accounts(connection)
        return {"changed": False, "reason": "Already migrated"}
    rack_triggers = False
    if connection.dialect.name == "sqlite":
        rack_triggers = bool(connection.execute(text("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'rack_balance_%'")).scalar_one())
        for operation in ("insert", "update", "delete"):
            connection.exec_driver_sql(f"DROP TRIGGER IF EXISTS rack_balance_{operation}")
    if "warehouse_configuration" in tables:
        # An auto-reloading development server may have run create_all between
        # source updates and this explicit migration. Remove only empty shadow
        # tables; never choose between two populated versions of the data.
        shadows = [name for name in TABLE_NAMES.values() if name in tables]
        if any(connection.execute(text(f'SELECT count(*) FROM "{name}"')).scalar_one() for name in shadows):
            raise RuntimeError("Both legacy and new warehouse tables contain data; manual reconciliation is required")
        for name in ("warehouse_rack", "warehouse_bin", "warehouse_zone", "user_account", "warehouse_configuration"):
            if name in shadows:
                connection.execute(text(f'DROP TABLE "{name}"'))
        tables = inspect(connection).get_table_names()

    quote = connection.dialect.identifier_preparer.quote
    counts = {t: connection.execute(text(f"SELECT count(*) FROM {quote(t)}")).scalar_one() for t in tables}
    parents = connection.execute(text('SELECT id, store_name FROM "store" ORDER BY store_code, id')).all()
    if not parents:
        # Empty installations can configure their warehouse through initial setup.
        canonical = None
        label = "Main Warehouse"
    else:
        canonical, label = parents[0]

    # Make location codes unique before consolidating former organizational owners.
    # IDs, QR identifiers, balances and physical rack assignments are preserved.
    for table, code in (("store_zone", "zone_code"), ("store_bin", "bin_code")):
        if table not in tables:
            continue
        seen = set()
        rows = connection.execute(text(f'SELECT id, {code} FROM "{table}" ORDER BY id')).all()
        for identifier, value in rows:
            key = str(value).upper()
            if key in seen:
                new_code = str(value)[:48] + "-" + str(identifier).replace("-", "")[:12]
                connection.execute(text(f'UPDATE "{table}" SET {code}=:code WHERE id=:id'), {"code": new_code, "id": identifier})
                key = new_code.upper()
            seen.add(key)

    for table in tables:
        cols = [c["name"] for c in inspect(connection).get_columns(table)]
        if canonical is not None:
            for name in cols:
                if name == "store_id" or name.endswith("_store_id"):
                    connection.execute(text(f"UPDATE {quote(table)} SET {quote(name)}=:id"), {"id": canonical})
                elif name == "store_code" or name.endswith("_store_code"):
                    if table != "store":
                        connection.execute(text(f"UPDATE {quote(table)} SET {quote(name)}='WH-001'"))
                elif name == "store_name" or name.endswith("_store_name"):
                    if table != "store":
                        connection.execute(text(f"UPDATE {quote(table)} SET {quote(name)}=:name"), {"name": label})
        if "status" in cols:
            connection.execute(text(f"UPDATE {quote(table)} SET status='ASSIGNED_TO_WAREHOUSE' WHERE status='ASSIGNED_TO_STORE'"))
        if "role" in cols:
            connection.execute(text(f"UPDATE {quote(table)} SET role='WAREHOUSE_OPERATOR' WHERE upper(replace(role, ' ', '_')) IN ('STORE', 'STORE_MANAGER', 'STORE_KEEPER', 'STORE_OPERATOR')"))

    if canonical is not None:
        connection.execute(text('DELETE FROM "store" WHERE id<>:id'), {"id": canonical})
        connection.execute(text('UPDATE "store" SET store_code=\'WH-001\' WHERE id=:id'), {"id": canonical})

    # SQLite and PostgreSQL both update foreign-key targets on table/column renames.
    for old, new in TABLE_NAMES.items():
        if old in tables:
            connection.execute(text(f"ALTER TABLE {quote(old)} RENAME TO {quote(new)}"))
    for old_table in tables:
        table = TABLE_NAMES.get(old_table, old_table)
        for col in inspect(connection).get_columns(table):
            old, new = col["name"], column_name(col["name"])
            if old != new:
                connection.execute(text(f"ALTER TABLE {quote(table)} RENAME COLUMN {quote(old)} TO {quote(new)}"))

    connection.execute(text('ALTER TABLE warehouse_configuration ADD COLUMN singleton_key INTEGER NOT NULL DEFAULT 1 CHECK (singleton_key = 1)'))
    connection.execute(text('CREATE UNIQUE INDEX uq_single_warehouse ON warehouse_configuration (singleton_key)'))

    if "notification" in tables:
        cols = {c["name"] for c in inspect(connection).get_columns("notification")}
        if "link" in cols:
            connection.execute(text("UPDATE notification SET link='/inventory' WHERE link IN ('/my-store','/warehouse/stores')"))
        if "user_role" in cols:
            connection.execute(text("UPDATE notification SET user_role='WAREHOUSE_OPERATOR' WHERE user_role LIKE 'STR:%' OR user_role IN ('STORE_MANAGER','STORE_KEEPER','STORE')"))

    # Retire old index names as well as old data columns. Autoindexes retain their
    # engine-generated names and continue enforcing their original constraints.
    for table in inspect(connection).get_table_names():
        for idx in inspect(connection).get_indexes(table):
            old = idx["name"]
            if "store" not in old:
                continue
            new = column_name(old.replace("store_manager_user", "user_account").replace("store_zone", "warehouse_zone").replace("store_bin", "warehouse_bin").replace("store_rack", "warehouse_rack"))
            new = re.sub(r"(?<![a-z])store(?=_|$)", "warehouse", new)
            if connection.dialect.name == "postgresql":
                connection.execute(text(f"ALTER INDEX {quote(old)} RENAME TO {quote(new)}"))
            else:
                columns = ", ".join(quote(c) for c in idx["column_names"])
                unique = "UNIQUE " if idx["unique"] else ""
                connection.execute(text(f"DROP INDEX {quote(old)}"))
                connection.execute(text(f"CREATE {unique}INDEX {quote(new)} ON {quote(table)} ({columns})"))

    if rack_triggers:
        from app.modules.storage.application.rack_capacity import _install_sqlite
        _install_sqlite(connection)
    _shared_accounts(connection)
    after = {TABLE_NAMES.get(t, t): connection.execute(text(f"SELECT count(*) FROM {quote(TABLE_NAMES.get(t, t))}")).scalar_one() for t in tables}
    for old, count in counts.items():
        if old != "store" and after[TABLE_NAMES.get(old, old)] != count:
            raise RuntimeError(f"Row preservation check failed for {old}")
    return {"changed": True, "tables_renamed": TABLE_NAMES, "warehouse_count": after["warehouse_configuration"], "rows_preserved": sum(count for t, count in counts.items() if t != "store")}
