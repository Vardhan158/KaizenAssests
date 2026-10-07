"""
Unit and integration tests for QR Scan Result lookup functionality.
"""
import pytest
from app.database.session import get_uow
from app.modules.receiving.infrastructure.api.router import lookup_qr_code
from app.security.dependencies import CurrentUser
from fastapi import HTTPException


@pytest.mark.asyncio
async def test_qr_lookup_good_stock_item():
    async for uow in get_uow():
        user = CurrentUser(
            subject="test_user",
            username="test_user",
            roles=["admin"],
            permissions=["receiving:read"],
            raw_claims={},
        )
        # MAT-001 in DB
        res = await lookup_qr_code(code="QR-MAT-MAT-001", uow=uow, _user=user)
        assert res.material_code == "MAT-001"
        assert res.stock_status == "AVAILABLE"
        assert res.inspection_status in ["COMPLETED", "PARTIAL"]
        assert res.supplier_name is not None
        assert res.uom in ["KG", "PCS"]
        assert "accepted and moved to" in res.summary
        break


@pytest.mark.asyncio
async def test_qr_lookup_material_with_color_variant():
    from app.modules.procurement.infrastructure.persistence.models import MaterialModel, MaterialVariantModel
    from sqlalchemy import select
    import uuid
    async for uow in get_uow():
        user = CurrentUser(
            subject="test_user",
            username="test_user",
            roles=["admin"],
            permissions=["receiving:read"],
            raw_claims={},
        )
        # Ensure MAT-1001 and MAT-1001-V002 exist in DB
        v_stmt = select(MaterialVariantModel).where(MaterialVariantModel.variant_code == "MAT-1001-V002")
        v = (await uow.session.execute(v_stmt)).scalar_one_or_none()
        if not v:
            m_stmt = select(MaterialModel).where(MaterialModel.material_code == "MAT-1001")
            mat = (await uow.session.execute(m_stmt)).scalar_one_or_none()
            if not mat:
                mat = MaterialModel(
                    id=uuid.uuid4(),
                    material_code="MAT-1001",
                    material_name="PVC Pipes",
                    category="Raw Materials",
                    base_uom="BUNDLE",
                    status="Active",
                )
                uow.session.add(mat)
                await uow.commit()
            v = MaterialVariantModel(
                id=uuid.uuid4(),
                material_id=mat.id,
                variant_code="MAT-1001-V002",
                color="red",
                size="32 mm x 3 m",
                grade="ISI",
                uom="BUNDLE",
                status="Active",
            )
            uow.session.add(v)
            await uow.commit()

        # MAT-1001-V002 has color 'red', size '32 mm x 3 m', grade 'ISI'
        res = await lookup_qr_code(code="MAT-1001-V002", uow=uow, _user=user)
        assert res.material_code == "MAT-1001"
        assert res.variant_code == "MAT-1001-V002"
        assert res.color == "red"
        assert res.grade == "ISI"
        assert res.stock_status in ["AVAILABLE", "QUARANTINED"]
        break


@pytest.mark.asyncio
async def test_qr_lookup_damage_payload():
    from app.modules.procurement.infrastructure.persistence.models import MaterialModel, MaterialVariantModel
    from sqlalchemy import select
    import uuid
    async for uow in get_uow():
        user = CurrentUser(
            subject="test_user",
            username="test_user",
            roles=["admin"],
            permissions=["receiving:read"],
            raw_claims={},
        )
        # Ensure MAT-1001 and MAT-1001-V001 exist in DB
        v_stmt = select(MaterialVariantModel).where(MaterialVariantModel.variant_code == "MAT-1001-V001")
        v = (await uow.session.execute(v_stmt)).scalar_one_or_none()
        if not v:
            m_stmt = select(MaterialModel).where(MaterialModel.material_code == "MAT-1001")
            mat = (await uow.session.execute(m_stmt)).scalar_one_or_none()
            if not mat:
                mat = MaterialModel(
                    id=uuid.uuid4(),
                    material_code="MAT-1001",
                    material_name="PVC Pipes",
                    category="Raw Materials",
                    base_uom="BUNDLE",
                    status="Active",
                )
                uow.session.add(mat)
                await uow.commit()
            v = MaterialVariantModel(
                id=uuid.uuid4(),
                material_id=mat.id,
                variant_code="MAT-1001-V001",
                color="White",
                size="25 mm × 3 m",
                grade="ISI",
                uom="BUNDLE",
                status="Active",
            )
            uow.session.add(v)
            await uow.commit()

        damage_payload = """Material Code: MAT-1001
Material Name: PVC Pipes
Material Category: Raw Materials
Material Variant Code: MAT-1001-V001
Batch: DMG-LOT-GRN-20260901-0028-MAT-1001
Size: 25 mm × 3 m
Color: White
Warehouse: Main Warehouse
Grade: ISI
UOM: BUNDLE
Inspection Status: PARTIAL
Batch Quantity: 50 BUNDLE"""
        res = await lookup_qr_code(code=damage_payload, uow=uow, _user=user)
        assert res.material_code == "MAT-1001"
        assert res.stock_status == "QUARANTINED"
        assert res.damaged_quantity > 0
        assert "damaged and moved to quarantine" in res.summary
        break


@pytest.mark.asyncio
async def test_qr_lookup_invalid_qr_returns_404():
    async for uow in get_uow():
        user = CurrentUser(
            subject="test_user",
            username="test_user",
            roles=["admin"],
            permissions=["receiving:read"],
            raw_claims={},
        )
        with pytest.raises(HTTPException) as exc_info:
            await lookup_qr_code(code="INVALID-UNREGISTERED-QR-CODE-12345", uow=uow, _user=user)
        assert exc_info.value.status_code == 404
        assert "This QR code is not registered in the system." in str(exc_info.value.detail)
        break
