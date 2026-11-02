"""Targeted compatibility for local SQLite databases created before QC auditing."""
from sqlalchemy import inspect


def ensure_local_qc_audit_columns(connection) -> list[str]:
    if connection.dialect.name != "sqlite":
        return []
    inspector = inspect(connection)
    if not inspector.has_table("assembly_quality_inspection"):
        return []
    columns = {column["name"] for column in inspector.get_columns("assembly_quality_inspection")}
    additions = {
        "inspected_by_user_id": "VARCHAR(255)",
        "authorized_person_confirmed": "BOOLEAN NOT NULL DEFAULT 0",
    }
    added = []
    for name, definition in additions.items():
        if name not in columns:
            connection.exec_driver_sql(f"ALTER TABLE assembly_quality_inspection ADD COLUMN {name} {definition}")
            added.append(name)
    return added


def ensure_local_fg_section_columns(connection) -> list[str]:
    """Add FG transport and section fields needed by older local SQLite DBs."""
    if connection.dialect.name != "sqlite":
        return []

    inspector = inspect(connection)
    additions = {
        "assembly_finished_goods": {
            "section_supplier_id": "VARCHAR(64)",
            "section_main_id": "VARCHAR(128)",
        },
        "finished_goods_request": {
            "section_fg_id": "VARCHAR(36)",
            "transport_entries": "JSON",
            "expected_pickup_date": "DATE",
        },
    }
    added: list[str] = []
    for table_name, columns in additions.items():
        if not inspector.has_table(table_name):
            continue
        existing = {column["name"] for column in inspector.get_columns(table_name)}
        for name, definition in columns.items():
            if name not in existing:
                connection.exec_driver_sql(
                    f"ALTER TABLE {table_name} ADD COLUMN {name} {definition}"
                )
                added.append(f"{table_name}.{name}")

    # PostgreSQL uses the Alembic-created sequence. SQLite has no sequence
    # objects, so use a tiny AUTOINCREMENT table for equivalent local IDs.
    connection.exec_driver_sql(
        "CREATE TABLE IF NOT EXISTS fg_transport_main_number "
        "(number INTEGER PRIMARY KEY AUTOINCREMENT)"
    )
    return added


def ensure_local_assembly_traceability_column(connection) -> list[str]:
    """Add the assembly-order traceability flag to older local SQLite databases."""
    if connection.dialect.name != "sqlite":
        return []

    inspector = inspect(connection)
    if not inspector.has_table("assembly_order"):
        return []

    columns = {column["name"] for column in inspector.get_columns("assembly_order")}
    if "traceability_required" in columns:
        return []

    connection.exec_driver_sql(
        "ALTER TABLE assembly_order ADD COLUMN traceability_required BOOLEAN NOT NULL DEFAULT 0"
    )
    return ["assembly_order.traceability_required"]
