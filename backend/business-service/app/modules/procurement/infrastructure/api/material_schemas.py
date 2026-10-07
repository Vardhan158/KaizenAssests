"""
Pydantic schemas for Material Master and Material Variants.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator


class MaterialVariantCreate(BaseModel):
    variant_code: Optional[str] = Field(None, description="Optional custom variant code; auto-generated if omitted")
    size: Optional[str] = Field(None, max_length=128, description="e.g. 1.5 mm, 10 mm")
    color: Optional[str] = Field(None, max_length=64, description="e.g. Red, Blue, Black")
    grade: Optional[str] = Field(None, max_length=128, description="e.g. PVC, IS 2062")
    specification: Optional[str] = Field(None, description="Technical specification or notes")
    uom: str = Field("PCS", max_length=32, description="Unit of measurement")
    attributes: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Extensible JSON attributes")
    status: str = Field("Active", max_length=32)

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in ("Active", "Inactive"):
            raise ValueError("Status must be 'Active' or 'Inactive'")
        return v


class MaterialVariantUpdate(BaseModel):
    size: Optional[str] = None
    color: Optional[str] = None
    grade: Optional[str] = None
    specification: Optional[str] = None
    uom: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None
    status: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("Active", "Inactive"):
            raise ValueError("Status must be 'Active' or 'Inactive'")
        return v


class MaterialVariantResponse(BaseModel):
    id: str
    material_id: str
    variant_code: str
    size: Optional[str] = None
    color: Optional[str] = None
    grade: Optional[str] = None
    specification: Optional[str] = None
    uom: str = "PCS"
    attributes: Dict[str, Any] = Field(default_factory=dict)
    status: str = "Active"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class MaterialMasterCreate(BaseModel):
    material_code: str = Field(..., min_length=2, max_length=64, description="Unique material code, e.g. MAT-WIRE-001")
    material_name: str = Field(..., min_length=2, max_length=256, description="Material name, e.g. Wire")
    category: str = Field(..., min_length=1, max_length=128, description="Material category, e.g. Electrical, Steel")
    description: Optional[str] = Field(None, description="Detailed description")
    base_uom: str = Field("PCS", max_length=32, description="Base unit of measure")
    status: str = Field("Active", max_length=32)
    variants: Optional[List[MaterialVariantCreate]] = Field(default_factory=list, description="Initial list of variants")

    @field_validator("material_code")
    @classmethod
    def validate_material_code(cls, v: str) -> str:
        code = v.strip().upper()
        if not code:
            raise ValueError("Material code cannot be empty")
        return code

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in ("Active", "Inactive"):
            raise ValueError("Status must be 'Active' or 'Inactive'")
        return v


class MaterialMasterUpdate(BaseModel):
    material_name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    base_uom: Optional[str] = None
    status: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("Active", "Inactive"):
            raise ValueError("Status must be 'Active' or 'Inactive'")
        return v


class MaterialMasterResponse(BaseModel):
    id: str
    material_code: str
    material_name: str
    category: str
    description: Optional[str] = None
    base_uom: str = "PCS"
    status: str = "Active"
    variant_count: int = 0
    variants: List[MaterialVariantResponse] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class MaterialMasterListResponse(BaseModel):
    items: List[MaterialMasterResponse]
    total: int


class MaterialStatusUpdate(BaseModel):
    status: str = Field(..., description="'Active' or 'Inactive'")

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in ("Active", "Inactive"):
            raise ValueError("Status must be 'Active' or 'Inactive'")
        return v


class MaterialVariantStatusUpdate(BaseModel):
    status: str = Field(..., description="'Active' or 'Inactive'")

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in ("Active", "Inactive"):
            raise ValueError("Status must be 'Active' or 'Inactive'")
        return v
