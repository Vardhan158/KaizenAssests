# AMS/WMS Business Service — Technical Documentation

## 1. Scope

`business-service` is the Python/FastAPI backend for AMS/WMS operations. It owns procurement, supplier management, gate entry, inbound receiving, storage/putaway, returns, notifications, dashboards, and transactional events. Identity is intended to come from the separate Java `auth-service`; local modes also provide development identities.

This document describes the code currently in this repository. FastAPI's `/docs` and `/openapi.json` are the definitive field-level API contracts.

## 2. System context

```text
React frontend (:8080)
    | HTTP + Bearer JWT
    v
FastAPI business-service (:8000) ---- JWKS ----> Java auth-service (:8080)
    |---- async SQLAlchemy ----------> PostgreSQL business DB (:5433)
    |---- transactional outbox ------> Kafka (:9092)
    |<--- notification consumer ------|
    +---- media files, SMTP, Gemini/OCR (when configured)
```

The parent [`docker-compose.yml`](../docker-compose.yml) defines PostgreSQL, Kafka, Redis, auth, and business services. Redis is configured but is not a primary persistence mechanism in current workflows.

## 3. Stack

| Concern | Technology |
|---|---|
| Runtime/API | Python 3.12–3.13, FastAPI 0.115, Uvicorn, Pydantic 2 |
| Data | PostgreSQL, SQLAlchemy 2 async, asyncpg, Alembic |
| Messaging/jobs | Kafka/aiokafka, APScheduler |
| Security | Bearer JWT, RS256/JWKS, python-jose |
| Observability | structured logging, request IDs, Prometheus, optional OpenTelemetry |
| Files/docs/vision | multipart, ReportLab, Pillow, Gemini, OpenCV/Tesseract adapters |
| Tests | pytest, pytest-asyncio, HTTPX |

Pinned packages are in `pyproject.toml` and `requirements.txt`.

## 4. Source architecture

```text
business-service/
├── app/
│   ├── main.py                 app factory, lifespan, router registration
│   ├── config/                 environment settings
│   ├── database/               async engine/session and base
│   ├── security/               JWT and authorization dependencies
│   ├── middleware/             request context and error translation
│   ├── common/domain/          aggregate, event, exception foundations
│   ├── events/                 outbox model/repository
│   ├── kafka/                  producer/consumer wrappers
│   ├── workers/                outbox and notification workers
│   └── modules/                bounded business modules
├── alembic/                    schema migrations
├── tests/                      unit and integration tests
├── scripts/                    administrative utilities
└── .env.example
```

The intended dependency direction is `infrastructure/API -> application/use cases -> domain`; persistence implementations satisfy application repository protocols. Receiving, returns, notification, and master data follow this separation closely. The active gate and procurement routers also contain significant orchestration and some direct persistence/reporting logic.

## 5. Lifecycle

`app.main:create_app()` installs request-context and CORS middleware, exception handlers, routers, static media, health checks, and optional Prometheus metrics.

Startup performs compatibility DDL, attempts to start Kafka, schedules the transactional-outbox relay, schedules an upcoming-arrival check every 60 seconds, and starts the notification consumer. Shutdown stops the scheduler, consumer, and producer. Kafka errors are handled defensively so local HTTP development can continue.

The startup `CREATE/ALTER TABLE IF NOT EXISTS` statements are legacy compatibility behavior, not a migration strategy. New schema work belongs in Alembic.

## 6. Module status

| Module | Status and responsibility |
|---|---|
| `procurement` | Active: material requests/stock, suppliers, RFQs, quotations, selection, POs, finance approval, ASNs, notifications, supplier login, search, PDFs/uploads |
| `gate` | Active: OCR/ANPR, entry/verification, docks, receiving checks, handling units, exit, GRN posting, inventory transactions |
| `storage` | Active: putaway tasks, locations, handling-unit lookup, task execution and balances |
| `receiving` | Active: domain-centric GRN confirmation and retrieval |
| `returns` | Active: return creation and retrieval |
| `notification` | Active: event webhook and Kafka-consumed notification log |
| `masterdata` | Implemented but its separate `/api/v1/suppliers` router is not mounted; UI uses procurement supplier routes |
| `approval`, `assembly`, `dispatch`, `disposition`, `erp`, `quality`, `shipment`, `traceability` | Skeletons; no mounted API |

Older migration notes and the original README predate parts of the active gate, procurement, and storage implementation.

## 7. API catalog

### Operations and shared

| Method/path | Purpose |
|---|---|
| `GET /health` | liveness |
| `GET /health/ready` | static readiness marker |
| `GET /metrics` | Prometheus metrics when enabled |
| `GET /docs`, `GET /openapi.json` | API documentation/schema |
| `GET /media/...` | process-local uploaded media |
| `POST /webhooks/events` | notification/integration-event ingestion |

### Receiving and returns

| Method/path | Purpose |
|---|---|
| `POST /api/receiving/grn` | confirm/create GRN from PO receipt lines |
| `GET /api/receiving/grn/{grn_id}` | GRN detail |
| `POST /api/returns` | create return request |
| `GET /api/returns/{return_id}` | return detail |

### Gate, dock, receiving, and exit

The `/api/gate-entries` family provides:

- multipart gate-entry creation, list/detail, OCR scan, verification, pass download, and development reset;
- inbound arrival queue and dock list/create/update;
- dock assignment, movement, and check-in;
- unloading, received quantity, material condition, and quality checks;
- handling-unit generation and receiving completion;
- dock release, warehouse exit approval, and final gate exit;
- GRN drafts/posting, inventory transactions, and quantity-verification policy.

`/api/gate` exposes PO lookup and OCR/ANPR preview aliases. `GET /api/dashboard/stats` aggregates warehouse dashboard data.

### Storage

`/api/storage/putaway-tasks` supports task listing, locations, inventory-location balances, handling-unit lookup, location assignment, start, and completion.

### Procurement

All paths use `/api/v1/procurement`:

| Family | Operations |
|---|---|
| `/health`, `/stats`, `/global-search` | health, metrics, cross-entity search |
| `/vendor-types`, `/supplier-categories`, `/raw-materials` | list/create reference data |
| `/material-requests` | next number, list/create/update/process |
| `/material-stock` | procurement inventory view |
| `/suppliers` | existence check, CRUD-like operations, block/unblock, upload documents |
| `/rfqs` | list/create/detail/send/decline/select supplier |
| `/quotations` | list/create/detail/update/reject/upload document |
| `/purchase-orders` | list/detail/by-number/PDF/approve/reject/resubmit/send |
| `/finance-approvals` | finance approval queue |
| `/asns` | next number, list/create/detail/update/attachment upload |
| `/arrival-notifications`, `/notifications` | list and read/read-all |
| `/auth/supplier-login`, `/auth/change-password`, `/auth/dev-login` | supplier and development authentication |

## 8. Core workflows

```text
Material request -> procurement process -> RFQ -> supplier quotation
-> supplier selection -> PO -> finance approve/reject/resubmit
-> PO sent -> supplier ASN -> arrival notification -> gate entry
```

```text
Gate entry + evidence -> OCR/ANPR/manual verification -> inbound queue
-> dock assignment/check-in -> unload -> quantity/condition/quality checks
-> handling units -> receiving complete -> GRN/inventory transaction
-> putaway assignment/start/complete -> exit approval -> gate exit
```

Domain/application changes can persist an outbox record in the same database transaction. `relay_once` publishes pending events to Kafka and marks them published; the notification consumer persists relevant notification records. This prevents a committed business change from losing its event during temporary broker failure.

## 9. Data and migrations

The schema covers GRNs/receipt lines, returns, notifications/outbox, suppliers/contacts/documents, material requests/stock, RFQs/items, quotations, POs/approval history, ASNs/arrivals, gate entries/docks/receiving details, handling units, putaway tasks, and location balances.

```powershell
cd D:\ams-wms-platform\backend\business-service
alembic upgrade head
alembic revision --autogenerate -m "describe change" # after model changes
```

Review generated migrations carefully: this history contains merged heads and legacy reconciliation. Scripts named `wipe_*` are destructive and require explicit approval, correct targeting, and a backup.

## 10. Authentication and authorization

Production intent is RS256 JWT validation against `JWT_JWKS_URL` with issuer and audience checks. `get_current_user` maps claims to `CurrentUser`; authorization helpers enforce roles/permissions where endpoints attach them.

Development is intentionally permissive:

- `local`, `test`, and `development` override `get_current_user` with a local ADMIN/PROCUREMENT identity;
- procurement exposes a development login;
- the frontend can produce mock tokens.

These paths must not be enabled in production. Route authorization needs a production audit because not every current router operation declares an explicit role dependency.

## 11. Configuration

Pydantic Settings reads environment variables and `.env`. Use `.env.example` as the template.

| Group | Variables |
|---|---|
| Runtime | `SERVICE_NAME`, `ENVIRONMENT`, `LOG_LEVEL`, `LOG_JSON` |
| Database | `DATABASE_URL`, pool size/overflow/echo |
| Auth | auth base URL, JWKS URL, issuer, audience, algorithm, cache TTL |
| Kafka/workers | bootstrap servers, client/group/topic/security, outbox interval/batch |
| HTTP/integration | `CORS_ALLOW_ORIGINS`, `REDIS_URL`, Gemini key/model |
| Observability | Prometheus and OTLP enablement/endpoint |
| Email | SMTP host/port/user/password/from name |
| Development | role-specific usernames/passwords |

Never commit populated `.env` files, credentials, keys, or SMTP/Gemini secrets.

## 12. Local development

Full infrastructure:

```powershell
cd D:\ams-wms-platform\backend
docker compose up -d
```

Service process:

```powershell
cd D:\ams-wms-platform\backend\business-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
alembic upgrade head
python -m uvicorn app.main:app --reload
```

Open `http://localhost:8000/docs`.

## 13. Tests and observability

```powershell
pytest
ruff check app tests
```

Tests currently cover receiving/return domain logic, gate domain/services/API, and supplier identity. Add domain/use-case tests for rules and integration tests for persistence, auth, and transitions.

Request middleware propagates/generates correlation information. Exception handlers translate domain/application errors. Prometheus is enabled by default; OpenTelemetry requires deployment initialization. `/health/ready` does not currently probe PostgreSQL, Kafka, or JWKS, so production monitoring must check those separately plus outbox lag.

## 14. Extension rules

1. Keep rules/events framework-free in `domain`.
2. Put commands, use cases, and repository protocols in `application`.
3. Implement persistence and API adapters under `infrastructure`.
4. Register routers in `create_app()` and add an Alembic migration.
5. Add domain and integration tests; avoid new startup DDL.
6. Update this overview and let OpenAPI document field-level contracts.

## 15. Known risks and production checklist

- Startup mutates schema and suppresses several DDL errors; migrate only through Alembic.
- Gate/procurement routers are very large and mix concerns; split into use cases/services.
- Local auth and mock login are unsafe outside development; default-deny them.
- Readiness is not dependency-aware; add DB, Kafka, and auth/JWKS probes.
- Media is process-local; use durable object storage and file validation/scanning.
- Several skeleton modules and stale notes obscure actual status; keep the status table current.
- Redis/telemetry use is incomplete; configure or remove unused paths.
- Enforce least privilege on every sensitive endpoint, TLS/restrictive CORS/Kafka security, backups, outbox alerts, and CI tests before production.

