# business-service

Complete architecture, API, workflow, security, operations, and production
guidance: [`TECHNICAL_DOCUMENTATION.md`](TECHNICAL_DOCUMENTATION.md).

Python (FastAPI) business backend for the AMS/WMS platform. Owns every
business module (inventory, warehouse, receiving, returns, ...) except
authentication/authorization, which stays in `auth-service` (Java).

## Layout

```
app/
  main.py              FastAPI app factory + lifespan (Kafka producer, outbox
                        relay job, notification consumer)
  config/               Settings (env-driven)
  database/              Async engine, DeclarativeBase, Unit of Work
  security/               Local JWT validation (JWKS) + RBAC dependency
  middleware/              Exception -> HTTP translation, request-id propagation
  events/                 Outbox model + helpers (write-side of the outbox pattern)
  kafka/                   Producer/consumer wrappers (the only modules that know Kafka exists)
  workers/                 Outbox relay (poll -> publish) and the notification Kafka consumer
  common/domain/            AggregateRoot, DomainEvent, domain exceptions
  modules/
    receiving/              Fully implemented (ported from warehouse-core/receiving)
    returns/                 Fully implemented (ported from logistics-returns/returns)
    notification/             Fully implemented (ported from platform/notification)
    quality, storage, assembly, dispatch, procurement, gate,
    disposition, shipment, traceability, masterdata, erp, approval
                               Placeholders - see each module's MIGRATION_NOTES.md
alembic/                     Migrations (0001-0004 create the schema for the three
                              implemented modules + the shared outbox table)
```

Every implemented module follows the same four-layer shape:
`domain/` (framework-free aggregate + rules) -> `application/` (use cases,
repository Protocol) -> `infrastructure/api/` (FastAPI router, Pydantic
schemas) -> `infrastructure/persistence/` (SQLAlchemy models, repository
implementation). Read `receiving` first - it has the most comments and is
the direct port of the original codebase's most complete example.

## Run locally

```bash
cp .env.example .env
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Point DATABASE_URL at a running Postgres, then:
alembic upgrade head

uvicorn app.main:app --reload
```

Requires Kafka reachable at `KAFKA_BOOTSTRAP_SERVERS` for the outbox relay
and notification consumer to start cleanly; see the root `docker-compose.yml`
for a full local stack (Postgres, Kafka, Redis, auth-service, this service).

## Try the flow

```bash
# 1. Get a token from auth-service (see backend/auth-service/README.md)
TOKEN=... 

# 2. Confirm a receipt against the seeded PO
curl -X POST localhost:8000/api/receiving/grn \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"po_id":"11111111-1111-1111-1111-111111111111","lines":[{"item_code":"ITEM-A","quantity":10}]}'

# 3. Within outbox_poll_interval_seconds, the notification consumer records
#    the GoodsReceivedEvent from Kafka - check the notification_log table.
```
