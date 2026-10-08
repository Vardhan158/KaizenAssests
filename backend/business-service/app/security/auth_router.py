from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.config.settings import get_settings


router = APIRouter(prefix="/api/v1/procurement/auth", tags=["authentication"])


class SupplierLoginRequest(BaseModel):
    username: str
    password: str


@router.post("/supplier-login")
async def supplier_login(payload: SupplierLoginRequest) -> dict:
    settings = get_settings()
    if payload.username.strip() != settings.supplier_username or payload.password != settings.supplier_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid supplier username or password",
        )

    return {
        "token": "mock-jwt-supplier-token",
        "username": settings.supplier_username,
        "supplierId": None,
        "mustChangePassword": False,
    }
