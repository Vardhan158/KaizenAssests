# Single warehouse model

There is one warehouse configuration. Zones, racks, bins and docks belong to that
warehouse. Operational accounts share it; there is no store master, store selector
or per-store user scope. Supplier ownership and role permissions remain separate.

The configuration table enforces `singleton_key = 1` with a unique constraint.
The setup endpoint rejects attempts to create a second warehouse. Former store
accounts become `WAREHOUSE_OPERATOR` accounts, retaining restricted operational
permissions rather than receiving administrator access.

## Upgrading an existing database

Before starting this version, from `backend/business-service` run:

```powershell
.venv/Scripts/python.exe scripts/migrate_single_warehouse.py
```

For the configured local SQLite database this creates a consistent backup under
`backups`, then runs the upgrade in an explicit transaction. Table and column
renames preserve record IDs, stock balances, QR identifiers, accounts and workflow
history. If legacy parents need consolidation, location-code collisions receive
stable suffixes while their IDs and QR identifiers remain intact. Capacity
triggers are reinstalled. Row counts, foreign keys and database integrity are
checked before commit. The command is safe to repeat.

The development server must not create a parallel empty schema before migration;
startup explicitly detects the legacy schema. If empty shadow tables already
exist from a reload, migration removes only those empty tables. If both schemas
contain records, it stops for reconciliation.

Historical Alembic files and database backups retain their original terminology
so old installations and backups can still be understood. The active models,
tables and columns use warehouse terminology. For a PostgreSQL deployment, take
an operational backup and invoke `app.database.single_warehouse_migration.migrate`
with a managed SQLAlchemy migration connection; the local CLI deliberately only
operates on the configured SQLite file.

## API and UI

`GET /api/v1/warehouse` returns a list containing the configured warehouse for
existing configuration readers. `GET /api/v1/warehouse/me` resolves the same
warehouse for any authenticated operational session. Configuration lookup by ID
uses `/api/v1/warehouse/configuration/{id}` to avoid masking the dock endpoints.
Zones and bins are managed under `/api/v1/zones`.

Dock allocation resolves the warehouse on the server. Putaway requires a zone,
rack/bin and quantity, without asking the operator to select a store or warehouse.
Assembly picking uses the same configuration automatically. Obsolete store and
finished-goods-store redirect routes have been removed.
