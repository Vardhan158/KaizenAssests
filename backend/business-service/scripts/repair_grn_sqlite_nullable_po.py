"""Repair legacy SQLite GRNs for ASN receipts, preserving rows and schema objects.

Usage: python scripts/repair_grn_sqlite_nullable_po.py PATH_TO_DB [--apply]
Stop the backend while applying; a timestamped SQLite backup is created first.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
import re
import sqlite3
from contextlib import closing


def repair(database: Path, *, apply: bool = False) -> dict:
    database = database.resolve(strict=True)
    connection = sqlite3.connect(database.as_uri() + "?mode=rw", uri=True, timeout=10)
    try:
        columns = connection.execute('PRAGMA table_info("grn")').fetchall()
        if not columns:
            raise ValueError("The selected database has no grn table")
        targets = [row[1] for row in columns if row[1] in ("po_id", "po_number") and row[3]]
        result = {"database": str(database), "columns": targets, "changed": False}
        if not targets or not apply:
            return result
        ddl = connection.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='grn'").fetchone()[0]
        for column in targets:
            pattern = rf'((?:"{column}"|`{column}`|\[{column}\]|\b{column}\b)\s+[^,]*?)\bNOT\s+NULL\b'
            ddl, count = re.subn(pattern, r"\1", ddl, count=1, flags=re.I)
            if count != 1:
                raise ValueError(f"Cannot safely identify the {column} NOT NULL constraint")
        ddl, count = re.subn(r'^CREATE\s+TABLE\s+(?:"grn"|`grn`|\[grn\]|grn)\s*\(', 'CREATE TABLE "_grn_nullable_po" (', ddl, count=1, flags=re.I)
        if count != 1:
            raise ValueError("Cannot safely identify the grn table definition")
        backup = database.with_name(database.name + ".backup-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
        with closing(sqlite3.connect(backup)) as destination:
            connection.backup(destination)
        result["backup"] = str(backup)
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("BEGIN IMMEDIATE")
        try:
            before_violations = set(connection.execute("PRAGMA foreign_key_check").fetchall())
            objects = connection.execute("SELECT sql FROM sqlite_master WHERE tbl_name='grn' AND type IN ('index','trigger') AND sql IS NOT NULL").fetchall()
            names = ", ".join('"' + row[1].replace('"', '""') + '"' for row in columns)
            connection.execute(ddl)
            connection.execute(f'INSERT INTO "_grn_nullable_po" ({names}) SELECT {names} FROM "grn"')
            old_count = connection.execute('SELECT count(*) FROM "grn"').fetchone()[0]
            if connection.execute('SELECT count(*) FROM "_grn_nullable_po"').fetchone()[0] != old_count:
                raise ValueError("GRN row count changed during repair")
            connection.execute('DROP TABLE "grn"')
            connection.execute('ALTER TABLE "_grn_nullable_po" RENAME TO "grn"')
            for (sql,) in objects:
                connection.execute(sql)
            if set(connection.execute("PRAGMA foreign_key_check").fetchall()) != before_violations:
                raise ValueError("Foreign key checks changed during repair")
            if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("SQLite integrity check failed")
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        result.update(changed=True, preserved_rows=old_count)
        return result
    finally:
        connection.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("--apply", action="warehouse_true")
    args = parser.parse_args()
    print(repair(args.database, apply=args.apply))
