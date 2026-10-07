"""
FastAPI router for Material Master and Material Variant management.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.database.session import UnitOfWork, get_uow
from app.logging.logger import get_logger
from app.modules.procurement.infrastructure.api.material_schemas import (
    MaterialMasterCreate,
    MaterialMasterListResponse,
    MaterialMasterResponse,
    MaterialMasterUpdate,
    MaterialStatusUpdate,
    MaterialVariantCreate,
    MaterialVariantResponse,
    MaterialVariantStatusUpdate,
    MaterialVariantUpdate,
)
from app.modules.procurement.infrastructure.persistence.models import (
    MaterialModel,
    MaterialVariantModel,
    PurchaseOrderItemModel,
    MaterialRequestItemModel,
    RfqItemModel,
    QuotationLineModel,
    AsnLineModel,
    MaterialStockModel,
)
from app.modules.receiving.infrastructure.persistence.models import GrnLineModel
from app.security.dependencies import CurrentUser, get_current_user

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1/materials", tags=["material-master"])

STANDARD_UOMS = [
    "INGOT",
    "ROLL",
    "COIL",
    "LENGTH",
    "BUNDLE",
    "TON",
    "PCS",
    "MTR",
    "KG",
    "LTR",
    "BOX",
    "PKT",
    "ROL",
    "SQM",
    "SET",
    "NOS",
    "DRUM",
]

DEFAULT_CATEGORIES = [
    "Electrical",
    "Steel & Metals",
    "Raw Materials",
    "Packaging",
    "Fasteners & Hardware",
    "Chemicals & Coatings",
    "Pipes & Fittings",
    "Mechanical Components",
    "Consumables",
    "Finished Goods",
]


def _to_variant_response(v: MaterialVariantModel) -> MaterialVariantResponse:
    return MaterialVariantResponse(
        id=str(v.id),
        material_id=str(v.material_id),
        variant_code=v.variant_code,
        size=v.size,
        color=v.color,
        grade=v.grade,
        specification=v.specification,
        uom=v.uom,
        attributes=v.attributes or {},
        status=v.status,
        created_at=v.created_at,
        updated_at=v.updated_at,
    )


def _to_material_response(m: MaterialModel) -> MaterialMasterResponse:
    variants = [_to_variant_response(v) for v in (m.variants or [])]
    return MaterialMasterResponse(
        id=str(m.id),
        material_code=m.material_code,
        material_name=m.material_name,
        category=m.category,
        description=m.description,
        base_uom=m.base_uom,
        status=m.status,
        variant_count=len(variants),
        variants=variants,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


@router.get("/uoms", response_model=List[str])
async def list_standard_uoms() -> List[str]:
    """Return standard UOM options."""
    return STANDARD_UOMS


@router.get("/categories", response_model=List[str])
async def list_material_categories(uow: UnitOfWork = Depends(get_uow)) -> List[str]:
    """Return distinct material categories present in database plus standard options."""
    stmt = select(func.distinct(MaterialModel.category)).where(MaterialModel.category.isnot(None))
    result = await uow.session.execute(stmt)
    db_cats = [c for c in result.scalars().all() if c]
    combined = list(dict.fromkeys(db_cats + DEFAULT_CATEGORIES))
    return combined


def extract_variant_sequence(code: Optional[str]) -> Optional[int]:
    """
    Extract the numeric sequence from a variant code safely.
    Matches formats like 'MAT-005-V001', 'MAT-005-V1', 'MAT-005-v002', 'MAT-005-VAR-001', etc.
    Returns the integer sequence or None if unparseable or if it's not a variant code.
    """
    if not code or not isinstance(code, str):
        return None
    code_str = code.strip()
    match = re.search(r"[-_]?[vVsS](?:ar|pec)?[-_]?(\d+)$", code_str, re.IGNORECASE)
    if match:
        try:
            return int(match.group(1))
        except (ValueError, TypeError):
            return None
    return None


def generate_next_variant_code(material_code: str, existing_variant_codes: Any) -> str:
    """
    Inspects all existing variant codes for the material (Active, Inactive, etc.),
    finds the highest sequence number, and generates the next code as highest_sequence + 1.
    Never reuses an existing variant code.
    """
    clean_mat_code = material_code.strip().upper() if material_code else "MAT"
    max_seq = 0
    if existing_variant_codes:
        for code in existing_variant_codes:
            seq = extract_variant_sequence(code)
            if seq is not None and seq > max_seq:
                max_seq = seq
    next_seq = max_seq + 1
    return f"{clean_mat_code}-V{next_seq:03d}"


@router.get("/next-code")
async def get_next_material_code(
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    """Suggest the next sequential material code (e.g. MAT-001) and variant code (e.g. MAT-001-V001)."""
    stmt = select(MaterialModel.material_code)
    result = await uow.session.execute(stmt)
    codes = result.scalars().all()

    max_seq = 0
    for code in codes:
        if not code:
            continue
        # Strictly match standard MAT-XXX format (e.g. MAT-001, MAT-002, etc.)
        match = re.match(r"^MAT-(\d+)$", code.strip(), re.IGNORECASE)
        if match:
            try:
                seq = int(match.group(1))
                if seq > max_seq:
                    max_seq = seq
            except (ValueError, TypeError):
                pass

    next_code = f"MAT-{(max_seq + 1):03d}"
    return {
        "suggested_material_code": next_code,
        "suggested_variant_code": f"{next_code}-V001",
    }


@router.get("/{id}/next-variant-code")
async def get_next_variant_code(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
) -> dict:
    """Suggest the next sequential variant code for a specific material based on highest existing sequence."""
    try:
        mat_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid material UUID")

    stmt = select(MaterialModel).options(selectinload(MaterialModel.variants)).where(MaterialModel.id == mat_uuid)
    result = await uow.session.execute(stmt)
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")

    # Inspect all variant codes from database (Active, Inactive, etc.)
    all_var_stmt = select(MaterialVariantModel.variant_code).where(
        or_(
            MaterialVariantModel.material_id == mat_uuid,
            MaterialVariantModel.variant_code.ilike(f"{material.material_code}-%"),
        )
    )
    all_var_res = await uow.session.execute(all_var_stmt)
    existing_codes = set(all_var_res.scalars().all())
    for v in (material.variants or []):
        if v.variant_code:
            existing_codes.add(v.variant_code)

    suggested_code = generate_next_variant_code(material.material_code, existing_codes)
    return {
        "material_code": material.material_code,
        "suggested_variant_code": suggested_code,
    }


@router.get("", response_model=List[MaterialMasterResponse])
async def list_materials(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    uow: UnitOfWork = Depends(get_uow),
) -> List[MaterialMasterResponse]:
    """
    List all materials with optional filtering by search query, category, and status.
    Eagerly loads all variants for each material.
    """
    stmt = select(MaterialModel).options(selectinload(MaterialModel.variants)).order_by(MaterialModel.created_at.desc())

    if status and status.upper() != "ALL":
        clean_status = status.strip()
        var_status_subq = select(MaterialVariantModel.material_id).where(
            func.lower(MaterialVariantModel.status) == clean_status.lower()
        )
        stmt = stmt.where(
            or_(
                func.lower(MaterialModel.status) == clean_status.lower(),
                MaterialModel.id.in_(var_status_subq),
            )
        )

    if category and category.upper() != "ALL":
        stmt = stmt.where(MaterialModel.category == category)

    if search:
        search_term = f"%{search.strip()}%"
        var_search_subq = select(MaterialVariantModel.material_id).where(
            or_(
                MaterialVariantModel.variant_code.ilike(search_term),
                MaterialVariantModel.size.ilike(search_term),
                MaterialVariantModel.color.ilike(search_term),
                MaterialVariantModel.grade.ilike(search_term),
                MaterialVariantModel.specification.ilike(search_term),
            )
        )
        stmt = stmt.where(
            or_(
                MaterialModel.material_code.ilike(search_term),
                MaterialModel.material_name.ilike(search_term),
                MaterialModel.category.ilike(search_term),
                MaterialModel.description.ilike(search_term),
                MaterialModel.id.in_(var_search_subq),
            )
        )

    result = await uow.session.execute(stmt)
    materials = result.scalars().all()
    return [_to_material_response(m) for m in materials]


@router.get("/{id}", response_model=MaterialMasterResponse)
async def get_material_detail(
    id: str,
    uow: UnitOfWork = Depends(get_uow),
) -> MaterialMasterResponse:
    """Get material master details with all associated variants."""
    try:
        mat_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid material UUID")

    stmt = select(MaterialModel).options(selectinload(MaterialModel.variants)).where(MaterialModel.id == mat_uuid)
    result = await uow.session.execute(stmt)
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Material with ID '{id}' not found")

    return _to_material_response(material)


@router.post("", response_model=MaterialMasterResponse, status_code=status.HTTP_201_CREATED)
async def create_material(
    request: MaterialMasterCreate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> MaterialMasterResponse:
    """
    Create a new Base Material Master with one or multiple Variants.
    Enforces uniqueness of material_code and variant_code.
    Rejects duplicate variants with identical size/color/grade specifications.
    """
    clean_code = request.material_code.strip().upper()
    clean_name = request.material_name.strip()

    # 1. Check duplicate material_code
    existing_stmt = select(MaterialModel).where(func.upper(MaterialModel.material_code) == clean_code)
    existing_res = await uow.session.execute(existing_stmt)
    if existing_res.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Material with code '{clean_code}' already exists. Please use a unique Material Code."
        )

    # 1b. Check duplicate material_name (case-insensitive)
    existing_name_stmt = select(MaterialModel).where(func.lower(MaterialModel.material_name) == clean_name.lower())
    existing_name_res = await uow.session.execute(existing_name_stmt)
    existing_by_name = existing_name_res.scalar_one_or_none()
    if existing_by_name is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Material '{existing_by_name.material_name}' already exists (Code: {existing_by_name.material_code}). Please choose a unique Material Name."
        )

    # 2. Build variants list
    variants_to_create = request.variants or []
    if not variants_to_create:
        # Generate default variant if none provided
        variants_to_create = [
            MaterialVariantCreate(
                variant_code=f"{clean_code}-V001",
                uom=request.base_uom,
                status="Active",
            )
        ]

    # Validate variants for duplicates within the payload
    seen_variant_codes = set()
    seen_signatures = set()
    prepared_variants = []

    for idx, v in enumerate(variants_to_create, start=1):
        v_code = (v.variant_code.strip().upper()) if v.variant_code else f"{clean_code}-V{idx:03d}"

        if v_code in seen_variant_codes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Duplicate variant code '{v_code}' in creation payload."
            )
        seen_variant_codes.add(v_code)

        # Check existing variant_code in DB
        db_var_stmt = select(MaterialVariantModel).where(func.upper(MaterialVariantModel.variant_code) == v_code)
        db_var_res = await uow.session.execute(db_var_stmt)
        if db_var_res.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Variant code '{v_code}' is already in use by another material variant."
            )

        # Build duplicate signature (size, color, grade, specification)
        sig = (
            (v.size or "").strip().lower(),
            (v.color or "").strip().lower(),
            (v.grade or "").strip().lower(),
            (v.specification or "").strip().lower(),
        )
        if sig != ("", "", "", "") and sig in seen_signatures:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Duplicate variant defined with identical specifications: Size='{v.size}', Color='{v.color}', Grade='{v.grade}'."
            )
        seen_signatures.add(sig)

        prepared_variants.append((v_code, v))

    # 3. Create Base MaterialModel
    new_material = MaterialModel(
        id=uuid.uuid4(),
        material_code=clean_code,
        material_name=request.material_name.strip(),
        category=request.category.strip(),
        description=request.description.strip() if request.description else None,
        base_uom=request.base_uom.strip().upper(),
        status=request.status,
        created_at=datetime.now(),
        created_by=user.username if user else "SYSTEM",
        updated_at=datetime.now(),
        updated_by=user.username if user else "SYSTEM",
    )

    # 4. Attach variants
    for v_code, v in prepared_variants:
        variant_model = MaterialVariantModel(
            id=uuid.uuid4(),
            material_id=new_material.id,
            variant_code=v_code,
            size=v.size.strip() if v.size else None,
            color=v.color.strip() if v.color else None,
            grade=v.grade.strip() if v.grade else None,
            specification=v.specification.strip() if v.specification else None,
            uom=v.uom.strip().upper() if v.uom else new_material.base_uom,
            attributes=v.attributes or {},
            status=v.status,
            created_at=datetime.now(),
            created_by=user.username if user else "SYSTEM",
            updated_at=datetime.now(),
            updated_by=user.username if user else "SYSTEM",
        )
        new_material.variants.append(variant_model)

    uow.session.add(new_material)
    try:
        await uow.commit()
    except IntegrityError as ie:
        await uow.session.rollback()
        err_msg = str(ie.orig) if hasattr(ie, "orig") else str(ie)
        if "material_code" in err_msg.lower():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Material code '{clean_code}' is already registered.")
        if "variant_code" in err_msg.lower():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A variant code in the request is already registered.")
        if "defining_specs" in err_msg.lower() or "uq_material_variant" in err_msg.lower():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A variant with identical defining specifications already exists under this material.")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Database integrity conflict while creating material.")

    # Re-fetch with variants
    fetch_stmt = select(MaterialModel).options(selectinload(MaterialModel.variants)).where(MaterialModel.id == new_material.id)
    fetch_res = await uow.session.execute(fetch_stmt)
    saved_material = fetch_res.scalar_one()

    logger.info(
        f"Created Material Master '{saved_material.material_code}' ({saved_material.material_name}) with {len(saved_material.variants)} variants."
    )
    return _to_material_response(saved_material)


@router.put("/{id}", response_model=MaterialMasterResponse)
async def update_material(
    id: str,
    request: MaterialMasterUpdate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> MaterialMasterResponse:
    """Update base material attributes (name, category, description, base UOM, status)."""
    try:
        mat_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid material UUID")

    stmt = select(MaterialModel).options(selectinload(MaterialModel.variants)).where(MaterialModel.id == mat_uuid)
    result = await uow.session.execute(stmt)
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")

    if request.material_name is not None:
        clean_name = request.material_name.strip()
        if clean_name:
            name_check_stmt = select(MaterialModel).where(
                func.lower(MaterialModel.material_name) == clean_name.lower(),
                MaterialModel.id != mat_uuid,
            )
            name_check_res = await uow.session.execute(name_check_stmt)
            existing_by_name = name_check_res.scalar_one_or_none()
            if existing_by_name is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Material '{existing_by_name.material_name}' already exists (Code: {existing_by_name.material_code}). Please choose a unique Material Name.",
                )
            material.material_name = clean_name
    if request.category is not None:
        material.category = request.category.strip()
    if request.description is not None:
        material.description = request.description.strip() if request.description else None
    if request.base_uom is not None:
        material.base_uom = request.base_uom.strip().upper()
    if request.status is not None:
        material.status = request.status

    material.updated_at = datetime.now()
    material.updated_by = user.username if user else "SYSTEM"

    await uow.commit()
    await uow.session.refresh(material, attribute_names=["variants"])
    return _to_material_response(material)


@router.patch("/{id}/status", response_model=MaterialMasterResponse)
async def update_material_status(
    id: str,
    request: MaterialStatusUpdate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> MaterialMasterResponse:
    """Activate or deactivate a Material Master."""
    try:
        mat_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid material UUID")

    stmt = select(MaterialModel).options(selectinload(MaterialModel.variants)).where(MaterialModel.id == mat_uuid)
    result = await uow.session.execute(stmt)
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")

    material.status = request.status
    material.updated_at = datetime.now()
    material.updated_by = user.username if user else "SYSTEM"

    await uow.commit()
    await uow.session.refresh(material, attribute_names=["variants"])
    return _to_material_response(material)


@router.post("/{id}/variants", response_model=MaterialVariantResponse, status_code=status.HTTP_201_CREATED)
async def add_variant_to_material(
    id: str,
    request: MaterialVariantCreate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> MaterialVariantResponse:
    """Add a new variant to an existing material."""
    try:
        mat_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid material UUID")

    stmt = select(MaterialModel).options(selectinload(MaterialModel.variants)).where(MaterialModel.id == mat_uuid)
    result = await uow.session.execute(stmt)
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")

    # Inspect all existing variant codes for this material (Active, Inactive, etc.)
    all_var_stmt = select(MaterialVariantModel.variant_code).where(
        or_(
            MaterialVariantModel.material_id == mat_uuid,
            MaterialVariantModel.variant_code.ilike(f"{material.material_code}-%"),
        )
    )
    all_var_res = await uow.session.execute(all_var_stmt)
    existing_codes = set(all_var_res.scalars().all())
    for v in (material.variants or []):
        if v.variant_code:
            existing_codes.add(v.variant_code)

    # Generate variant code if not provided
    if request.variant_code and request.variant_code.strip():
        v_code = request.variant_code.strip().upper()
    else:
        v_code = generate_next_variant_code(material.material_code, existing_codes)

    # Check unique variant_code globally
    db_check = await uow.session.execute(
        select(MaterialVariantModel).where(func.upper(MaterialVariantModel.variant_code) == v_code)
    )
    if db_check.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Variant code '{v_code}' already exists."
        )

    # Check if duplicate variant attributes exist for this material
    req_sig = (
        (request.size or "").strip().lower(),
        (request.color or "").strip().lower(),
        (request.grade or "").strip().lower(),
        (request.specification or "").strip().lower(),
    )
    for existing_var in material.variants:
        cur_sig = (
            (existing_var.size or "").strip().lower(),
            (existing_var.color or "").strip().lower(),
            (existing_var.grade or "").strip().lower(),
            (existing_var.specification or "").strip().lower(),
        )
        if req_sig != ("", "", "", "") and cur_sig == req_sig:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"A variant with size '{request.size}', color '{request.color}', grade '{request.grade}' already exists for this material."
            )

    new_variant = MaterialVariantModel(
        id=uuid.uuid4(),
        material_id=material.id,
        variant_code=v_code,
        size=request.size.strip() if request.size else None,
        color=request.color.strip() if request.color else None,
        grade=request.grade.strip() if request.grade else None,
        specification=request.specification.strip() if request.specification else None,
        uom=request.uom.strip().upper() if request.uom else material.base_uom,
        attributes=request.attributes or {},
        status=request.status,
        created_at=datetime.now(),
        created_by=user.username if user else "SYSTEM",
        updated_at=datetime.now(),
        updated_by=user.username if user else "SYSTEM",
    )

    uow.session.add(new_variant)
    try:
        await uow.commit()
    except IntegrityError as ie:
        await uow.session.rollback()
        err_msg = str(ie.orig) if hasattr(ie, "orig") else str(ie)
        if "variant_code" in err_msg.lower():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Variant code '{v_code}' is already in use.")
        if "defining_specs" in err_msg.lower() or "uq_material_variant" in err_msg.lower():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A variant with identical defining specifications already exists under this material.")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Database integrity conflict while adding variant.")

    await uow.session.refresh(new_variant)
    return _to_variant_response(new_variant)


@router.put("/{id}/variants/{variant_id}", response_model=MaterialVariantResponse)
async def update_material_variant(
    id: str,
    variant_id: str,
    request: MaterialVariantUpdate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> MaterialVariantResponse:
    """Update variant specifications, UOM, extensible JSON attributes, or status."""
    try:
        mat_uuid = uuid.UUID(id)
        var_uuid = uuid.UUID(variant_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid material or variant UUID")

    stmt = select(MaterialVariantModel).where(
        MaterialVariantModel.id == var_uuid,
        MaterialVariantModel.material_id == mat_uuid,
    )
    result = await uow.session.execute(stmt)
    variant = result.scalar_one_or_none()
    if not variant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material variant not found")

    if request.size is not None:
        variant.size = request.size.strip() if request.size else None
    if request.color is not None:
        variant.color = request.color.strip() if request.color else None
    if request.grade is not None:
        variant.grade = request.grade.strip() if request.grade else None
    if request.specification is not None:
        variant.specification = request.specification.strip() if request.specification else None
    if request.uom is not None:
        variant.uom = request.uom.strip().upper()
    if request.attributes is not None:
        variant.attributes = request.attributes
    if request.status is not None:
        variant.status = request.status

    variant.updated_at = datetime.now()
    variant.updated_by = user.username if user else "SYSTEM"

    try:
        await uow.commit()
    except IntegrityError as ie:
        await uow.session.rollback()
        err_msg = str(ie.orig) if hasattr(ie, "orig") else str(ie)
        if "defining_specs" in err_msg.lower() or "uq_material_variant" in err_msg.lower():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Another variant with identical defining specifications already exists under this material.")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Database integrity conflict while updating variant.")

    await uow.session.refresh(variant)
    return _to_variant_response(variant)


@router.patch("/{id}/variants/{variant_id}/status", response_model=MaterialVariantResponse)
async def update_material_variant_status(
    id: str,
    variant_id: str,
    request: MaterialVariantStatusUpdate,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> MaterialVariantResponse:
    """Activate or deactivate a Material Variant."""
    try:
        mat_uuid = uuid.UUID(id)
        var_uuid = uuid.UUID(variant_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid material or variant UUID")

    stmt = select(MaterialVariantModel).where(
        MaterialVariantModel.id == var_uuid,
        MaterialVariantModel.material_id == mat_uuid,
    )
    result = await uow.session.execute(stmt)
    variant = result.scalar_one_or_none()
    if not variant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material variant not found")

    variant.status = request.status
    variant.updated_at = datetime.now()
    variant.updated_by = user.username if user else "SYSTEM"

    await uow.commit()
    await uow.session.refresh(variant)
    return _to_variant_response(variant)


@router.delete("/{id}/variants/{variant_id}", status_code=status.HTTP_200_OK)
async def delete_material_variant(
    id: str,
    variant_id: str,
    uow: UnitOfWork = Depends(get_uow),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Remove a variant from a material. A material must retain at least one variant."""
    try:
        mat_uuid = uuid.UUID(id)
        var_uuid = uuid.UUID(variant_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid material or variant UUID")

    parent_stmt = select(MaterialModel).options(selectinload(MaterialModel.variants)).where(MaterialModel.id == mat_uuid)
    parent_res = await uow.session.execute(parent_stmt)
    material = parent_res.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")

    if len(material.variants) <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot remove the only variant. A material must retain at least one variant."
        )

    stmt = select(MaterialVariantModel).where(
        MaterialVariantModel.id == var_uuid,
        MaterialVariantModel.material_id == mat_uuid,
    )
    result = await uow.session.execute(stmt)
    variant = result.scalar_one_or_none()
    if not variant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material variant not found")

    # Check transactional history across procurement and inventory tables
    refs = []

    # 1. Purchase Orders
    po_cnt_res = await uow.session.execute(
        select(func.count(PurchaseOrderItemModel.id)).where(
            or_(
                PurchaseOrderItemModel.material_variant_id == var_uuid,
                PurchaseOrderItemModel.variant_code == variant.variant_code
            )
        )
    )
    po_cnt = po_cnt_res.scalar() or 0
    if po_cnt > 0:
        refs.append(f"{po_cnt} Purchase Order line(s)")

    # 2. Material Requests
    mr_cnt_res = await uow.session.execute(
        select(func.count(MaterialRequestItemModel.id)).where(
            or_(
                MaterialRequestItemModel.material_variant_id == var_uuid,
                MaterialRequestItemModel.variant_code == variant.variant_code
            )
        )
    )
    mr_cnt = mr_cnt_res.scalar() or 0
    if mr_cnt > 0:
        refs.append(f"{mr_cnt} Material Request item(s)")

    # 3. RFQs
    rfq_cnt_res = await uow.session.execute(
        select(func.count(RfqItemModel.id)).where(
            or_(
                RfqItemModel.material_variant_id == var_uuid,
                RfqItemModel.variant_code == variant.variant_code
            )
        )
    )
    rfq_cnt = rfq_cnt_res.scalar() or 0
    if rfq_cnt > 0:
        refs.append(f"{rfq_cnt} RFQ item(s)")

    # 4. Quotations
    q_cnt_res = await uow.session.execute(
        select(func.count(QuotationLineModel.id)).where(
            or_(
                QuotationLineModel.material_variant_id == var_uuid,
                QuotationLineModel.variant_code == variant.variant_code
            )
        )
    )
    q_cnt = q_cnt_res.scalar() or 0
    if q_cnt > 0:
        refs.append(f"{q_cnt} Quotation line(s)")

    # 5. ASNs
    asn_cnt_res = await uow.session.execute(
        select(func.count(AsnLineModel.id)).where(
            or_(
                AsnLineModel.material_variant_id == var_uuid,
                AsnLineModel.variant_code == variant.variant_code
            )
        )
    )
    asn_cnt = asn_cnt_res.scalar() or 0
    if asn_cnt > 0:
        refs.append(f"{asn_cnt} ASN line(s)")

    # 6. GRNs
    grn_cnt_res = await uow.session.execute(
        select(func.count(GrnLineModel.id)).where(
            GrnLineModel.item_code == variant.variant_code
        )
    )
    grn_cnt = grn_cnt_res.scalar() or 0
    if grn_cnt > 0:
        refs.append(f"{grn_cnt} GRN line(s)")

    # 7. Material Stock
    stock_cnt_res = await uow.session.execute(
        select(func.count(MaterialStockModel.id)).where(
            or_(
                MaterialStockModel.material_variant_id == var_uuid,
                MaterialStockModel.variant_code == variant.variant_code
            )
        )
    )
    stock_cnt = stock_cnt_res.scalar() or 0
    if stock_cnt > 0:
        refs.append(f"{stock_cnt} Stock record(s)")

    if refs:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete variant '{variant.variant_code}' because it has active transactional history in: {', '.join(refs)}. Please deactivate or retire this variant instead."
        )

    await uow.session.delete(variant)
    await uow.commit()

    return {"status": "success", "message": f"Variant '{variant.variant_code}' removed successfully"}
