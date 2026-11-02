import sqlite3
import sys
import os

# Add app to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.database.base import Base
# Import all models to ensure they are registered with Base.metadata
from app.events import outbox_model  # noqa: F401
from app.common.persistence import models as common_models  # noqa: F401
from app.modules.gate.infrastructure.persistence import models as gate_models  # noqa: F401
from app.modules.receiving.infrastructure.persistence import models as receiving_models  # noqa: F401
from app.modules.returns.infrastructure.persistence import models as returns_models  # noqa: F401
from app.modules.storage.infrastructure.persistence import models as storage_models  # noqa: F401
from app.modules.warehouse.infrastructure.persistence import models as warehouse_models  # noqa: F401
from app.modules.assembly.infrastructure.persistence import models as assembly_models  # noqa: F401
from app.modules.dispatch.infrastructure.persistence import models as dispatch_models  # noqa: F401

def migrate_sqlite(db_path: str = "wms.db"):
    if not os.path.exists(db_path):
        print(f"Database {db_path} does not exist.")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    def get_col_sql(col):
        t = str(col.type).upper()
        if "INT" in t:
            sql_type = "INTEGER"
        elif "BOOL" in t:
            sql_type = "BOOLEAN"
        elif "NUM" in t or "DEC" in t or "FLOAT" in t:
            sql_type = "NUMERIC"
        elif "DATE" in t or "TIME" in t:
            sql_type = "TIMESTAMP"
        else:
            sql_type = "TEXT"

        # Check default value
        d_val = None
        if col.default is not None and col.default.arg is not None:
            if isinstance(col.default.arg, (str, int, float, bool)):
                d_val = f"'{col.default.arg}'" if isinstance(col.default.arg, str) else str(col.default.arg)
        elif col.server_default is not None:
            raw = str(col.server_default.arg)
            # clean up raw SQL functions or wrappers if needed
            if raw.startswith("'") and raw.endswith("'"):
                d_val = raw
            elif raw.isdigit() or raw in ("TRUE", "FALSE", "true", "false"):
                d_val = raw
            else:
                d_val = f"'{raw}'"

        default_clause = f" DEFAULT {d_val}" if d_val else ""
        return f"{col.name} {sql_type}{default_clause}"

    added = 0
    for table_name, table in Base.metadata.tables.items():
        cursor.execute(f"PRAGMA table_info({table_name})")
        existing_cols = {row[1] for row in cursor.fetchall()}
        if not existing_cols:
            continue
        for col in table.columns:
            if col.name not in existing_cols:
                col_def = get_col_sql(col)
                ddl = f"ALTER TABLE {table_name} ADD COLUMN {col_def}"
                print(f"Executing: {ddl}")
                try:
                    cursor.execute(ddl)
                    added += 1
                except Exception as e:
                    print(f"  Error on {ddl}: {e}")

    conn.commit()
    conn.close()
    print(f"Migration completed. Added {added} missing columns.")

if __name__ == "__main__":
    db_file = sys.argv[1] if len(sys.argv) > 1 else "wms.db"
    migrate_sqlite(db_file)
