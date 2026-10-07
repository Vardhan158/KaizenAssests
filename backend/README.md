# AMS/WMS Backend Platform

## How to Run the FastAPI Server

### Option 1: From `business-service` directory (Recommended)
```powershell
cd D:\KaizenAssests\backend\business-service
uv run uvicorn app.main:app --reload
```

### Option 2: From `backend` root directory
Specify `--app-dir business-service`:
```powershell
cd D:\KaizenAssests\backend
uv run uvicorn app.main:app --reload --app-dir business-service
```

### Option 3: Using `manage.py`
```powershell
cd D:\KaizenAssests\backend
python manage.py runserver
```

---

## Interactive API Documentation
* **Swagger UI**: http://localhost:8000/docs
* **Health Check**: http://localhost:8000/health
