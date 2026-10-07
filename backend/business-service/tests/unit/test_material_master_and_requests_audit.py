import uuid
from decimal import Decimal
from datetime import date, datetime
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select, delete, or_
from app.main import app
from app.database.session import engine, AsyncSessionFactory
from app.modules.procurement.infrastructure.persistence.models import (
    MaterialModel,
    MaterialRequestModel,
)


@pytest.fixture(autouse=True)
async def cleanup_engine():
    yield
    async with AsyncSessionFactory() as session:
        # Clean test MRs
        test_mrs = (await session.execute(
            select(MaterialRequestModel).where(MaterialRequestModel.request_number.like("MR-AUD-%"))
        )).scalars().all()
        for mr in test_mrs:
            await session.delete(mr)

        # Clean test Materials
        test_mats = (await session.execute(
            select(MaterialModel).where(
                or_(
                    MaterialModel.material_code.like("MAT-AUD-%"),
                    MaterialModel.material_code.like("MAT-REQ-%"),
                )
            )
        )).scalars().all()
        for mat in test_mats:
            await session.delete(mat)
        await session.commit()
    await engine.dispose()


@pytest.mark.asyncio
async def test_material_master_code_and_variant_sequencing_audit():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers = {
            "X-User-Id": "00000000-0000-0000-0000-000000000001",
            "X-User-Name": "test_admin",
            "X-User-Roles": "ADMIN,WAREHOUSE_MANAGER,PROCUREMENT_OFFICER",
        }

        # 1. Test next-code generation
        res = await client.get("/api/v1/materials/next-code", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert "suggested_material_code" in data
        assert data["suggested_material_code"].startswith("MAT-")

        # 2. Create Material Master with initial variant
        mat_code = f"MAT-AUD-{uuid.uuid4().hex[:4].upper()}"
        create_res = await client.post(
            "/api/v1/materials",
            json={
                "material_code": mat_code,
                "material_name": "Audit Steel Beam",
                "category": "Structural",
                "description": "High tensile structural steel beam",
                "base_uom": "MTR",
                "status": "Active",
                "variants": [
                    {
                        "variant_code": f"{mat_code}-V001",
                        "size": "100 mm",
                        "color": "Grey",
                        "grade": "Fe 500",
                        "specification": "IS 2062 Grade A",
                        "uom": "MTR",
                        "status": "Active",
                    }
                ],
            },
            headers=headers,
        )
        assert create_res.status_code == 201
        mat_data = create_res.json()
        mat_id = mat_data["id"]
        v1_id = mat_data["variants"][0]["id"]
        assert mat_data["variants"][0]["variant_code"] == f"{mat_code}-V001"

        # 3. Duplicate material code rejection
        dup_res = await client.post(
            "/api/v1/materials",
            json={
                "material_code": mat_code,
                "material_name": "Unique Name",
                "category": "Structural",
                "base_uom": "MTR",
            },
            headers=headers,
        )
        assert dup_res.status_code == 409

        # 3b. Duplicate material name rejection (case-insensitive)
        dup_name_res = await client.post(
            "/api/v1/materials",
            json={
                "material_code": f"MAT-AUD-{uuid.uuid4().hex[:4].upper()}",
                "material_name": "audit steel beam",  # same name different casing
                "category": "Structural",
                "base_uom": "MTR",
            },
            headers=headers,
        )
        assert dup_name_res.status_code == 409
        assert "already exists" in dup_name_res.json()["detail"]

        # 4. Add second variant V002
        v2_res = await client.post(
            f"/api/v1/materials/{mat_id}/variants",
            json={
                "variant_code": f"{mat_code}-V002",
                "size": "200 mm",
                "color": "Grey",
                "grade": "Fe 500",
                "specification": "IS 2062 Grade B",
                "uom": "MTR",
                "status": "Active",
            },
            headers=headers,
        )
        assert v2_res.status_code == 201
        v2_data = v2_res.json()
        v2_id = v2_data["id"]

        # 5. Check next variant sequence suggestion (should be V003)
        next_var_res = await client.get(f"/api/v1/materials/{mat_id}/next-variant-code", headers=headers)
        assert next_var_res.status_code == 200
        assert next_var_res.json()["suggested_variant_code"] == f"{mat_code}-V003"

        # 6. Deactivate V001
        deact_res = await client.patch(
            f"/api/v1/materials/{mat_id}/variants/{v1_id}/status",
            json={"status": "Inactive"},
            headers=headers,
        )
        assert deact_res.status_code == 200
        assert deact_res.json()["status"] == "Inactive"

        # 7. Check next variant sequence after deactivation (still V003, no reuse of V001)
        next_var_res2 = await client.get(f"/api/v1/materials/{mat_id}/next-variant-code", headers=headers)
        assert next_var_res2.status_code == 200
        assert next_var_res2.json()["suggested_variant_code"] == f"{mat_code}-V003"

        # 8. Add third variant (auto-generated code)
        v3_res = await client.post(
            f"/api/v1/materials/{mat_id}/variants",
            json={
                "size": "300 mm",
                "color": "Grey",
                "grade": "Fe 500",
                "specification": "IS 2062 Grade C",
                "uom": "MTR",
                "status": "Active",
            },
            headers=headers,
        )
        assert v3_res.status_code == 201
        assert v3_res.json()["variant_code"] == f"{mat_code}-V003"


@pytest.mark.asyncio
async def test_material_request_validation_and_lifecycle_audit():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers = {
            "X-User-Id": "00000000-0000-0000-0000-000000000001",
            "X-User-Name": "test_admin",
            "X-User-Roles": "ADMIN,WAREHOUSE_MANAGER,PROCUREMENT_OFFICER",
        }

        # Setup Material A (Active)
        code_a = f"MAT-REQ-A-{uuid.uuid4().hex[:4].upper()}"
        mat_a = (
            await client.post(
                "/api/v1/materials",
                json={
                    "material_code": code_a,
                    "material_name": "Audit Cable",
                    "category": "Electrical",
                    "base_uom": "MTR",
                    "status": "Active",
                    "variants": [
                        {
                            "variant_code": f"{code_a}-V001",
                            "size": "4 mm",
                            "color": "Black",
                            "grade": "XLPE",
                            "uom": "MTR",
                            "status": "Active",
                        }
                    ],
                },
                headers=headers,
            )
        ).json()
        mat_a_id = mat_a["id"]
        var_a_id = mat_a["variants"][0]["id"]

        # Setup Material B (Active)
        code_b = f"MAT-REQ-B-{uuid.uuid4().hex[:4].upper()}"
        mat_b = (
            await client.post(
                "/api/v1/materials",
                json={
                    "material_code": code_b,
                    "material_name": "Audit Conduit",
                    "category": "Electrical",
                    "base_uom": "MTR",
                    "status": "Active",
                    "variants": [
                        {
                            "variant_code": f"{code_b}-V001",
                            "size": "25 mm",
                            "color": "White",
                            "grade": "PVC",
                            "uom": "MTR",
                            "status": "Active",
                        }
                    ],
                },
                headers=headers,
            )
        ).json()
        mat_b_id = mat_b["id"]
        var_b_id = mat_b["variants"][0]["id"]

        # Setup Material C (Inactive)
        code_c = f"MAT-REQ-C-{uuid.uuid4().hex[:4].upper()}"
        mat_c = (
            await client.post(
                "/api/v1/materials",
                json={
                    "material_code": code_c,
                    "material_name": "Obsolete Switch",
                    "category": "Electrical",
                    "base_uom": "PCS",
                    "status": "Inactive",
                    "variants": [
                        {
                            "variant_code": f"{code_c}-V001",
                            "size": "Standard",
                            "uom": "PCS",
                            "status": "Inactive",
                        }
                    ],
                },
                headers=headers,
            )
        ).json()
        mat_c_id = mat_c["id"]

        # 1. Reject zero quantity
        res_zero = await client.post(
            "/api/v1/procurement/material-requests",
            json={
                "warehouse_id": "Main Warehouse",
                "department": "Maintenance",
                "requested_by": "Operator 1",
                "required_date": "2026-09-15",
                "items": [
                    {
                        "material_id": mat_a_id,
                        "material_variant_id": var_a_id,
                        "material_name": "Audit Cable",
                        "quantity": 0,
                        "uom": "MTR",
                    }
                ],
            },
            headers=headers,
        )
        assert res_zero.status_code == 422

        # 2. Reject negative quantity
        res_neg = await client.post(
            "/api/v1/procurement/material-requests",
            json={
                "warehouse_id": "Main Warehouse",
                "department": "Maintenance",
                "requested_by": "Operator 1",
                "required_date": "2026-09-15",
                "items": [
                    {
                        "material_id": mat_a_id,
                        "material_variant_id": var_a_id,
                        "material_name": "Audit Cable",
                        "quantity": -5,
                        "uom": "MTR",
                    }
                ],
            },
            headers=headers,
        )
        assert res_neg.status_code == 422

        # 3. Reject empty items list
        res_empty = await client.post(
            "/api/v1/procurement/material-requests",
            json={
                "warehouse_id": "Main Warehouse",
                "department": "Maintenance",
                "requested_by": "Operator 1",
                "required_date": "2026-09-15",
                "items": [],
            },
            headers=headers,
        )
        assert res_empty.status_code == 422

        # 4. Reject mismatched variant (Material A with Variant B)
        res_mismatch = await client.post(
            "/api/v1/procurement/material-requests",
            json={
                "warehouse_id": "Main Warehouse",
                "department": "Maintenance",
                "requested_by": "Operator 1",
                "required_date": "2026-09-15",
                "items": [
                    {
                        "material_id": mat_a_id,
                        "material_variant_id": var_b_id,
                        "material_name": "Mismatched Item",
                        "quantity": 10,
                        "uom": "MTR",
                    }
                ],
            },
            headers=headers,
        )
        assert res_mismatch.status_code == 400
        assert "does not belong to Material" in res_mismatch.json()["detail"]

        # 5. Reject inactive material
        res_inact = await client.post(
            "/api/v1/procurement/material-requests",
            json={
                "warehouse_id": "Main Warehouse",
                "department": "Maintenance",
                "requested_by": "Operator 1",
                "required_date": "2026-09-15",
                "items": [
                    {
                        "material_id": mat_c_id,
                        "material_name": "Obsolete Switch",
                        "quantity": 2,
                        "uom": "PCS",
                    }
                ],
            },
            headers=headers,
        )
        assert res_inact.status_code == 400
        assert "Inactive" in res_inact.json()["detail"]

        # 6. Valid Material Request Creation
        mr_req_no = f"MR-AUD-{uuid.uuid4().hex[:5].upper()}"
        res_valid = await client.post(
            "/api/v1/procurement/material-requests",
            json={
                "request_number": mr_req_no,
                "warehouse_id": "Main Warehouse",
                "department": "Maintenance",
                "requested_by": "Lead Electrician",
                "required_date": "2026-09-20",
                "remarks": "Scheduled substation maintenance",
                "items": [
                    {
                        "material_id": mat_a_id,
                        "material_variant_id": var_a_id,
                        "material_name": "Audit Cable (4 mm, Black)",
                        "quantity": 50,
                        "uom": "MTR",
                    }
                ],
            },
            headers=headers,
        )
        assert res_valid.status_code == 201
        mr_created = res_valid.json()
        assert mr_created["status"] == "success"

        # 7. Reject duplicate request_number
        res_dup_mr = await client.post(
            "/api/v1/procurement/material-requests",
            json={
                "request_number": mr_req_no,
                "warehouse_id": "Main Warehouse",
                "department": "Maintenance",
                "requested_by": "Lead Electrician",
                "required_date": "2026-09-20",
                "items": [
                    {
                        "material_id": mat_a_id,
                        "material_variant_id": var_a_id,
                        "material_name": "Audit Cable",
                        "quantity": 10,
                        "uom": "MTR",
                    }
                ],
            },
            headers=headers,
        )
        assert res_dup_mr.status_code == 409

        # 8. Retrieve list and find the created MR
        list_mr = await client.get("/api/v1/procurement/material-requests", headers=headers)
        assert list_mr.status_code == 200
        all_mrs = list_mr.json()
        matched_mr = next(
            (
                m
                for m in all_mrs
                if (m.get("requestNumber") or m.get("request_number")) == mr_req_no
            ),
            None,
        )
        assert matched_mr is not None
        mr_id = matched_mr["id"]
        assert matched_mr["status"] == "PENDING"

        # 9. Add a second variant to Material A so it has > 1 variant, then verify V001 cannot be deleted because it is in an active MR
        await client.post(
            f"/api/v1/materials/{mat_a_id}/variants",
            json={
                "variant_code": f"{code_a}-V002",
                "size": "6 mm",
                "color": "Black",
                "grade": "XLPE",
                "uom": "MTR",
                "status": "Active",
            },
            headers=headers,
        )

        del_var_res = await client.delete(
            f"/api/v1/materials/{mat_a_id}/variants/{var_a_id}",
            headers=headers,
        )
        assert del_var_res.status_code == 400
        assert "Material Request item(s)" in del_var_res.json()["detail"]

        # 10. Update the pending MR
        update_res = await client.put(
            f"/api/v1/procurement/material-requests/{mr_id}",
            json={
                "warehouse_id": "Main Warehouse",
                "department": "Electrical Engineering",
                "requested_by": "Chief Engineer",
                "required_date": "2026-09-25",
                "remarks": "Updated specs",
                "items": [
                    {
                        "material_id": mat_a_id,
                        "material_variant_id": var_a_id,
                        "material_name": "Audit Cable (4 mm, Black)",
                        "quantity": 75,
                        "uom": "MTR",
                    }
                ],
            },
            headers=headers,
        )
        assert update_res.status_code == 200

        # 11. Process the MR
        process_res = await client.post(
            f"/api/v1/procurement/material-requests/{mr_id}/process",
            headers=headers,
        )
        assert process_res.status_code == 200

        # 12. Cannot re-process an already PROCESSED MR
        reprocess_res = await client.post(
            f"/api/v1/procurement/material-requests/{mr_id}/process",
            headers=headers,
        )
        assert reprocess_res.status_code == 400

        # 13. Cannot edit a PROCESSED MR (immutability check)
        edit_processed_res = await client.put(
            f"/api/v1/procurement/material-requests/{mr_id}",
            json={
                "warehouse_id": "Main Warehouse",
                "department": "Electrical Engineering",
                "requested_by": "Chief Engineer",
                "required_date": "2026-09-25",
                "items": [
                    {
                        "material_id": mat_a_id,
                        "material_variant_id": var_a_id,
                        "material_name": "Audit Cable",
                        "quantity": 100,
                        "uom": "MTR",
                    }
                ],
            },
            headers=headers,
        )
        assert edit_processed_res.status_code == 400
        assert "Cannot edit Material Request" in edit_processed_res.json()["detail"]
