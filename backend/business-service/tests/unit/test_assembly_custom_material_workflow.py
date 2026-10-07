import datetime
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.main import app
from app.database.session import session_scope
from app.modules.procurement.infrastructure.persistence.models import (
    MaterialModel,
    MaterialVariantModel,
)
from app.modules.storage.infrastructure.persistence.models import (
    AssemblyRequisitionModel,
    AssemblyRequisitionItemModel,
    StorageLocationModel,
)
from app.modules.store.infrastructure.persistence.models import (
    StoreModel,
    StoreZoneModel,
)


@pytest.mark.asyncio
async def test_assembly_custom_material_complete_workflow():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Seed test store & existing material
        async with session_scope() as session:
            # 1. Existing Store
            store_res = await session.execute(select(StoreModel).where(StoreModel.store_code == "STR-TEST-01"))
            store = store_res.scalar_one_or_none()
            if not store:
                store = StoreModel(
                    id=uuid.uuid4(),
                    store_code="STR-TEST-01",
                    store_name="Assembly Test Store",
                    warehouse_id="WH-TEST",
                    status="ACTIVE",
                )
                session.add(store)
                await session.flush()

            # 2. Existing Material Master (MAT-1001)
            mat_res = await session.execute(select(MaterialModel).where(MaterialModel.material_code == "MAT-1001"))
            mat_existing = mat_res.scalar_one_or_none()
            if not mat_existing:
                mat_existing = MaterialModel(
                    id=uuid.uuid4(),
                    material_code="MAT-1001",
                    material_name="Standard Hex Bolt M8",
                    category="Fasteners & Hardware",
                    base_uom="PCS",
                    status="Active",
                )
                session.add(mat_existing)
                await session.flush()
                var = MaterialVariantModel(
                    id=uuid.uuid4(),
                    material_id=mat_existing.id,
                    variant_code="MAT-1001-V1",
                    size="M8x30",
                    uom="PCS",
                )
                session.add(var)
                await session.flush()

        # =========================================================================
        # CASE 1: Standard Requisition (Existing Material MAT-1001)
        # =========================================================================
        headers_assembly = {"x-user-role": "ASSEMBLY_OPERATOR", "x-user-name": "assembly_tech"}
        req_standard_payload = {
            "department": "Mechanical Assembly",
            "requested_by": "assembly_tech",
            "priority": "HIGH",
            "required_date": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=2)).date().isoformat(),
            "remarks": "Standard bolt replenishment",
            "items": [
                {
                    "material_id": str(mat_existing.id),
                    "material_code": "MAT-1001",
                    "material_name": "Standard Hex Bolt M8",
                    "quantity": 50,
                    "uom": "PCS",
                    "is_custom": False,
                }
            ],
        }

        resp = await client.post("/api/v1/assembly-requisitions", json=req_standard_payload, headers=headers_assembly)
        assert resp.status_code == 201, resp.text
        std_req = resp.json()
        req_num = std_req.get("requisitionNumber") or std_req.get("requisition_number")
        assert req_num.startswith("AR-") or req_num.startswith("ARQ-")
        assert len(std_req["items"]) == 1
        item0 = std_req["items"][0]
        assert (item0.get("materialCode") or item0.get("material_code")) == "MAT-1001"
        assert item0.get("isCustom") is False or item0.get("is_custom") is False

        # =========================================================================
        # CASE 2: Custom Material Requisition (New Material "Special Impeller Shaft")
        # =========================================================================
        req_custom_payload = {
            "department": "Precision Assembly",
            "requested_by": "assembly_tech",
            "priority": "URGENT",
            "required_date": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3)).date().isoformat(),
            "remarks": "Custom prototype requirement for pump build",
            "items": [
                {
                    "is_custom": True,
                    "custom_material_name": "Special Impeller Shaft",
                    "quantity": 10,
                    "uom": "PCS",
                }
            ],
        }

        resp = await client.post("/api/v1/assembly-requisitions", json=req_custom_payload, headers=headers_assembly)
        assert resp.status_code == 201, resp.text
        custom_req = resp.json()
        req_id = custom_req["id"]
        custom_item = custom_req["items"][0]
        item_id = custom_item["id"]

        assert custom_item.get("isCustom") is True or custom_item.get("is_custom") is True
        assert (custom_item.get("customMaterialName") or custom_item.get("custom_material_name")) == "Special Impeller Shaft"
        assert (custom_item.get("materialCode") or custom_item.get("material_code")) == "CUSTOM"
        assert custom_item.get("materialId") is None and custom_item.get("material_id") is None
        assert float(custom_item.get("requestedQuantity") or custom_item.get("requested_quantity")) == 10.0

        # =========================================================================
        # CASE 3: Role Permission Check
        # Assembly user should NOT be able to call create-material directly
        # =========================================================================
        resp_forbidden = await client.post(
            f"/api/v1/assembly-requisitions/{req_id}/items/{item_id}/create-material",
            json={
                "material_name": "Special Impeller Shaft",
                "category": "Mechanical Components",
                "base_uom": "PCS",
            },
            headers=headers_assembly,
        )
        assert resp_forbidden.status_code == 403

        # =========================================================================
        # CASE 4: Warehouse Action - Create Material for Custom Item
        # =========================================================================
        headers_wh = {"x-user-role": "WAREHOUSE_MANAGER", "x-user-name": "wh_manager"}
        resp_create_mat = await client.post(
            f"/api/v1/assembly-requisitions/{req_id}/items/{item_id}/create-material",
            json={
                "material_name": "Special Impeller Shaft",
                "category": "Mechanical Components",
                "base_uom": "PCS",
                "description": "High-strength alloy impeller shaft for assembly prototype",
            },
            headers=headers_wh,
        )
        assert resp_create_mat.status_code == 200, resp_create_mat.text
        updated_req = resp_create_mat.json()
        updated_item = next(it for it in updated_req["items"] if it["id"] == item_id)

        # Verify Material Code was generated by existing Material Master logic (MAT-XXX)
        code = updated_item.get("materialCode") or updated_item.get("material_code")
        assert code.startswith("MAT-")
        assert code != "CUSTOM"
        assert (updated_item.get("materialId") or updated_item.get("material_id")) is not None
        assert updated_item.get("isCustom") is False or updated_item.get("is_custom") is False
        assert (updated_item.get("customMaterialName") or updated_item.get("custom_material_name")) == "Special Impeller Shaft"
        generated_code = code

        # Verify Material Master record was created in Material Master table
        async with session_scope() as session:
            mat_check = await session.execute(select(MaterialModel).where(MaterialModel.material_code == generated_code))
            mat_record = mat_check.scalar_one_or_none()
            assert mat_record is not None
            assert mat_record.material_name == "Special Impeller Shaft"
            assert mat_record.category == "Mechanical Components"
            assert mat_record.base_uom == "PCS"

        # =========================================================================
        # CASE 5: Mixed Requisition (Standard + Custom item in same request)
        # =========================================================================
        req_mixed_payload = {
            "department": "Electrical Assembly",
            "requested_by": "assembly_tech",
            "priority": "MEDIUM",
            "required_date": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=4)).date().isoformat(),
            "remarks": "Mixed assembly lines",
            "items": [
                {
                    "material_id": str(mat_existing.id),
                    "material_code": "MAT-1001",
                    "material_name": "Standard Hex Bolt M8",
                    "quantity": 25,
                    "uom": "PCS",
                    "is_custom": False,
                },
                {
                    "is_custom": True,
                    "custom_material_name": "Custom Armature Core 220V",
                    "quantity": 5,
                    "uom": "NOS",
                },
            ],
        }

        resp_mixed = await client.post("/api/v1/assembly-requisitions", json=req_mixed_payload, headers=headers_assembly)
        assert resp_mixed.status_code == 201, resp_mixed.text
        mixed_data = resp_mixed.json()
        assert len(mixed_data["items"]) == 2
        
        line_standard = next(it for it in mixed_data["items"] if (it.get("materialCode") or it.get("material_code")) == "MAT-1001")
        assert line_standard.get("isCustom") is False or line_standard.get("is_custom") is False
        assert float(line_standard.get("requestedQuantity") or line_standard.get("requested_quantity")) == 25.0

        line_custom = next(it for it in mixed_data["items"] if (line_standard.get("id") != it.get("id")))
        assert (line_custom.get("customMaterialName") or line_custom.get("custom_material_name")) == "Custom Armature Core 220V"
        assert (line_custom.get("materialCode") or line_custom.get("material_code")) == "CUSTOM"
        assert line_custom.get("materialId") is None and line_custom.get("material_id") is None
