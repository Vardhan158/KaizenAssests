# Backend Setup Guide - AMS/WMS Platform

This guide covers the setup and execution of the backend services, including the Auth Service (Java) and Business Service (FastAPI).

## 1. Prerequisites
- **Python 3.12+**
- **Docker Desktop**
- **Java 17+** (optional if running Java services locally)

## 2. Infrastructure (Shared Services)
The backend requires PostgreSQL, Kafka, and Redis. These are managed via Docker Compose.

1. Navigate to the backend root:
   ```powershell
   cd D:\ams-wms-platform\backend
   ```
2. Start the infrastructure:
   ```powershell
   docker compose up -d
   ```
   *This command starts:*
   - `auth-db`: PostgreSQL for authentication data.
   - `business-db`: PostgreSQL (port 5433) for business data.
   - `redis`: For caching and background jobs.
   - `kafka`: For event-driven messaging.
   - `auth-service`: The Java-based authentication layer (port 8080).
   - `business-service`: The Python-based business logic layer (port 8000).

## 3. Business Service (Local Development)
To run the main Python backend locally for active development using **uv**:

1. Navigate to the business-service folder:
   ```powershell
   cd D:\ams-wms-platform\backend\business-service
   ```
2. Sync dependencies (installs everything into a `.venv` automatically):
   ```powershell
   uv sync
   ```
3. Configure Environment:
   - Create a `.env` file from `.env.example`:
     ```powershell
     Copy-Item .env.example .env
     ```
4. Run Database Migrations:
   ```powershell
   uv run alembic upgrade head
   ```
5. Start the Service:
   ```powershell
   uv run uvicorn app.main:app --reload
   ```

## 4. Backend Architecture Details
- **Auth Service (Java):** Handles JWT generation and JWKS endpoints.
- **Business Service (FastAPI):** Handles WMS/AMS workflows (Receiving, Gate Entry, etc.).
- **Database:** Uses SQLAlchemy (Async) with PostgreSQL.
- **Messaging:** Uses the Outbox pattern to publish events to Kafka.

## 5. API Endpoints
- **Base URL:** http://localhost:8000
- **Interactive Docs:** http://localhost:8000/docs
- **Health Check:** http://localhost:8000/health
- **Ready Check:** http://localhost:8000/health/ready
