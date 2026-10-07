# AMS/WMS Backend Information and Flow

## 1) Project backend structure

This project has a layered backend setup:

- D:\ams-wms-platform
  - Root project folder

- D:\ams-wms-platform\backend
  - Main backend workspace
  - Contains Docker Compose, infrastructure, and service folders

- D:\ams-wms-platform\backend\business-service
  - Main Python application service
  - This is the primary business backend for operational WMS/AMS workflows

- D:\ams-wms-platform\backend\auth-service
  - Java authentication service
  - Handles login, tokens, and JWT validation

- D:\ams-wms-platform\backend\common
  - Shared backend code and generic utilities

## 2) What the backend actually does

The main backend service is the business layer of the platform. It handles:

- Receiving and inbound flow
- Returns processing
- Notification events
- Gate entry and vehicle arrival flow
- Procurement operations
- Dashboard and operational APIs
- Domain logic and persistence for warehouse operations

This is the service that handles business functionality, not user authentication.

## 3) Main backend service details

Service name:
- business-service

Framework:
- FastAPI

Language:
- Python 3.12+

Persistence:
- SQLAlchemy async ORM

Database:
- PostgreSQL

Messaging:
- Kafka

Cache/queue-support:
- Redis

Auth model:
- JWT via external auth-service and JWKS validation

Migration tool:
- Alembic

Entry point:
- D:\ams-wms-platform\backend\business-service\app\main.py

## 4) Important backend folders

Inside the main service:

- D:\ams-wms-platform\backend\business-service\app
  - Core application package

- D:\ams-wms-platform\backend\business-service\app\main.py
  - FastAPI app creation and startup lifecycle

- D:\ams-wms-platform\backend\business-service\app\modules
  - Domain modules like receiving, returns, gate, procurement, notification

- D:\ams-wms-platform\backend\business-service\app\database
  - Database setup, sessions, and unit-of-work patterns

- D:\ams-wms-platform\backend\business-service\app\config
  - Environment and settings configuration

- D:\ams-wms-platform\backend\business-service\app\kafka
  - Kafka producer/consumer wrappers

- D:\ams-wms-platform\backend\business-service\app\workers
  - Background jobs such as outbox relay and notification consumer

- D:\ams-wms-platform\backend\business-service\app\security
  - JWT validation and security dependencies

- D:\ams-wms-platform\backend\business-service\alembic
  - Database migration files

- D:\ams-wms-platform\backend\business-service\tests
  - Tests for service behavior

## 5) Runtime flow of the backend

The backend runtime follows a standard API lifecycle:

1. Application starts in app.main
   - FastAPI app is created in create_app()
   - Lifespan starts background services
   - Kafka producer starts
   - Outbox relay scheduler starts
   - Notification consumer task is created

2. Request enters the API
   - Client requests an endpoint like /api/receiving/grn or /health
   - RequestContextMiddleware adds per-request metadata
   - CORS is applied
   - Exception handlers are registered

3. Auth and security layer runs
   - Authentication is validated through the external auth-service
   - JWT is checked using JWKS
   - Roles and permissions are extracted
   - Local environment may override auth for development

4. Router dispatches to the relevant module
   - Example modules:
     - receiving
     - returns
     - gateway / gate entry
     - notification
     - procurement

5. Business logic executes
   - Domain objects and use cases decide what should happen
   - Rules are enforced inside service/domain logic
   - Validation happens before persisting data

6. Persistence runs
   - Repository or Unit of Work writes to PostgreSQL
   - SQLAlchemy handles async database transactions
   - Data is committed or rolled back based on result

7. Outbox pattern is used for integration events
   - Domain events are placed into the outbox table
   - Background relay job publishes them to Kafka
   - This keeps database writes and message publishing consistent

8. Kafka event consumers process notifications
   - Notification consumer listens for related messages
   - It records or forwards operational updates

9. Response is returned to the client
   - The API sends back the final HTTP result
   - Frontend receives data and updates UI state

## 6) End-to-end example: receiving flow

A typical receiving flow looks like this:

1. Frontend sends receiving request to business-service
2. The request hits the receiving router
3. Auth checks user role and permissions
4. Business rules validate the PO and shipment data
5. A database transaction creates or updates receiving records
6. Domain event is written to outbox
7. Outbox relay publishes that event to Kafka
8. Notification consumer reacts to the event
9. UI can show status updates or notifications

This is the main pattern used in the app: business logic -> persistence -> outbox/event -> downstream notification.

## 7) Startup and run commands

From the backend service folder:

```powershell
cd D:\ams-wms-platform\backend\business-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
pip install -r requirements.txt
```

If a local `.env` file is needed, create it from the sample:

```powershell
Copy-Item .env.example .env
```

Then start the backend:

```powershell
python -m uvicorn app.main:app --reload
```

Expected URL:
- http://localhost:8000

Docs URL:
- http://localhost:8000/docs

Health URL:
- http://localhost:8000/health

Ready URL:
- http://localhost:8000/health/ready

## 8) Environment variables

The service uses configuration values from `.env` and app config files. Example settings:

```env
ENVIRONMENT=local
LOG_LEVEL=INFO
LOG_JSON=false

DATABASE_URL=postgresql+asyncpg://ams_business:ams_business@localhost:5433/ams_business

AUTH_SERVICE_BASE_URL=http://localhost:8080
JWT_JWKS_URL=http://localhost:8080/.well-known/jwks.json
JWT_ISSUER=ams-auth-service
JWT_AUDIENCE=ams-business-service

KAFKA_BOOTSTRAP_SERVERS=localhost:9092
KAFKA_CLIENT_ID=business-service
KAFKA_TOPIC_PREFIX=ams
KAFKA_CONSUMER_GROUP=business-service-notification

REDIS_URL=redis://localhost:6379/0

CORS_ALLOW_ORIGINS=["http://localhost:8080","http://127.0.0.1:8080"]
```

Sample config file:
- D:\ams-wms-platform\backend\business-service\.env.example

## 9) Database and infrastructure setup

The root backend folder contains infrastructure services:
- D:\ams-wms-platform\backend\docker-compose.yml

This Docker stack includes:
- auth-db
- business-db
- redis
- kafka
- auth-service
- business-service

Startup command:

```powershell
cd D:\ams-wms-platform\backend
docker compose up -d
```

Main exposed ports:
- PostgreSQL business DB: localhost:5433
- Auth service: localhost:8080
- Business service: localhost:8000
- Kafka: localhost:9092
- Redis: localhost:6379

## 10) Database migrations

The backend uses Alembic migrations. Run them after the database is up:

```powershell
cd D:\ams-wms-platform\backend\business-service
.\.venv\Scripts\Activate.ps1
alembic upgrade head
```

Migration files live here:
- D:\ams-wms-platform\backend\business-service\alembic\versions

## 11) Backend modules and role mapping

The main modules are organized under app/modules and each module follows a business-service structure with domain, application, and infrastructure logic.

Examples:

- receiving
  - inbound and GRN-related processing

- returns
  - return authorization and processing flows

- notification
  - notification API and event processing

- gate
  - gate entry, arrival, and vehicle workflows

- procurement
  - procurement flow and related APIs

- dashboard
  - operational dashboard and status surfaces

## 12) How the app is initialized

When the service starts, app.main runs the following sequence:

1. configure_logging()
2. create FastAPI app
3. add request context middleware
4. add CORS middleware
5. register exception handlers
6. start Kafka producer
7. schedule outbox relay job
8. start notification consumer task
9. expose routes for modules
10. expose /health and /health/ready endpoints

## 13) Backend flow summary

The complete backend flow can be summarized as:

Frontend request
-> API route
-> auth validation
-> business module
-> domain/service logic
-> repository/database write
-> outbox event insert
-> background outbox relay
-> Kafka publish
-> notification consumer
-> final response to client

This is the core architectural pattern of the platform.

## 14) Common issues and fixes

### Issue: stale virtual environment path

This appears as:

```powershell
Fatal error in launcher: Unable to create process using ... .venv\Scripts\python.exe ...
The system cannot find the file specified.
```

Fix:

```powershell
cd D:\ams-wms-platform\backend\business-service
Remove-Item -Recurse -Force .venv
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

### Issue: database not running

Symptoms:
- connection errors
- app fails at startup
- migrations fail

Fix:

```powershell
cd D:\ams-wms-platform\backend
docker compose up -d
```

### Issue: auth-service not running

Symptoms:
- JWT validation fails
- unauthorized responses
- login or token issues

Fix:

```powershell
cd D:\ams-wms-platform\backend
docker compose up -d auth-service
```

## 15) Quick reference

Main backend folder:
- D:\ams-wms-platform\backend

Main service folder:
- D:\ams-wms-platform\backend\business-service

Main app file:
- D:\ams-wms-platform\backend\business-service\app\main.py

Start command:
```powershell
cd D:\ams-wms-platform\backend\business-service
python -m uvicorn app.main:app --reload
```

API docs:
- http://localhost:8000/docs

Health check:
- http://localhost:8000/health

Everything else in the backend revolves around this core pattern:
- API
- validation
- business logic
- persistence
- outbox events
- Kafka notification flow

## 16) Final architecture statement

The backend is not just a single REST API. It is a service-oriented business platform where the main Python service orchestrates operational workflows, interacts with PostgreSQL, emits business events through Kafka, and depends on the Java auth-service for identity and access control.

The runtime architecture is therefore:

Frontend -> auth-service -> business-service -> PostgreSQL + Kafka + Redis

This is the complete backend picture for this project.
