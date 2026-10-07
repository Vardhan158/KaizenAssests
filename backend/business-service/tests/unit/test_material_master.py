"""
Unit tests for Material Master, Material Variants, Pydantic Schemas, and item linkages.
"""
import uuid
from decimal import Decimal
import pytest
from pydantic import ValidationError

from app.modules.procurement.infrastructure.api.material_schemas import (
    MaterialMasterCreate,
    MaterialMasterUpdate,
    MaterialVariantCreate,
    MaterialVariantUpdate,
)
from app.modules.procurement.infrastructure.persistence.models import (
    MaterialModel,
    MaterialVariantModel,
    MaterialRequestItemModel,
    PurchaseOrderItemModel,
)


def test_material_master_create_schema_valid():
    schema = MaterialMasterCreate(
        material_code="mat-wire-001",
        material_name="Industrial Copper Wire",
        category="Electrical",
        description="High grade electrical wiring",
        base_uom="MTR",
        status="Active",
        variants=[
            MaterialVariantCreate(
                variant_code="MAT-WIRE-001-V001",
                size="1.5 mm",
                color="Red",
                grade="PVC",
                specification="Insulated Copper",
                uom="MTR",
                attributes={"voltage": "440V", "conductor": "Copper"},
                status="Active",
            ),
            MaterialVariantCreate(
                variant_code="MAT-WIRE-001-V002",
                size="2.5 mm",
                color="Blue",
                grade="PVC",
                uom="MTR",
                attributes={"voltage": "1100V"},
                status="Active",
            ),
        ],
    )

    assert schema.material_code == "MAT-WIRE-001"  # Normalized to uppercase
    assert schema.material_name == "Industrial Copper Wire"
    assert len(schema.variants) == 2
    assert schema.variants[0].attributes == {"voltage": "440V", "conductor": "Copper"}


def test_material_master_create_invalid_status():
    with pytest.raises(ValidationError):
        MaterialMasterCreate(
            material_code="MAT-001",
            material_name="Test Item",
            category="General",
            status="INVALID_STATUS",
        )


def test_material_variant_invalid_status():
    with pytest.raises(ValidationError):
        MaterialVariantCreate(
            size="10mm",
            status="DELETED",
        )


def test_material_model_and_variants_relationship():
    mat_id = uuid.uuid4()
    mat = MaterialModel(
        id=mat_id,
        material_code="MAT-STEEL-001",
        material_name="Steel Reinforcement Bar",
        category="Steel & Metals",
        description="Construction grade rebar",
        base_uom="KG",
        status="Active",
    )

    var1 = MaterialVariantModel(
        id=uuid.uuid4(),
        material_id=mat_id,
        variant_code="MAT-STEEL-001-V001",
        size="8 mm",
        color="Grey",
        grade="IS 2062",
        specification="Standard TMT",
        uom="KG",
        attributes={"yield_strength": "500 MPa"},
        status="Active",
    )

    var2 = MaterialVariantModel(
        id=uuid.uuid4(),
        material_id=mat_id,
        variant_code="MAT-STEEL-001-V002",
        size="12 mm",
        color="Grey",
        grade="IS 2062",
        specification="High ductility",
        uom="KG",
        attributes={"yield_strength": "550 MPa"},
        status="Active",
    )

    mat.variants = [var1, var2]

    assert mat.material_code == "MAT-STEEL-001"
    assert mat.code == "MAT-STEEL-001"
    assert mat.name == "Steel Reinforcement Bar"
    assert len(mat.variants) == 2
    assert mat.variants[0].variant_code == "MAT-STEEL-001-V001"
    assert mat.variants[0].attributes["yield_strength"] == "500 MPa"
    assert mat.variants[1].variant_code == "MAT-STEEL-001-V002"


def test_material_request_item_variant_linkage():
    mat_id = uuid.uuid4()
    var_id = uuid.uuid4()
    req_id = uuid.uuid4()

    item = MaterialRequestItemModel(
        id=uuid.uuid4(),
        request_id=req_id,
        material_id=mat_id,
        material_variant_id=var_id,
        material_code="MAT-WIRE-001",
        variant_code="MAT-WIRE-001-V001",
        material_name="Industrial Copper Wire (1.5mm, Red, PVC)",
        quantity=Decimal("100.0000"),
        uom="MTR",
    )

    assert item.material_id == mat_id
    assert item.material_variant_id == var_id
    assert item.material_code == "MAT-WIRE-001"
    assert item.variant_code == "MAT-WIRE-001-V001"
    assert item.quantity == Decimal("100.0000")
    assert item.uom == "MTR"


def test_purchase_order_item_variant_linkage():
    mat_id = uuid.uuid4()
    var_id = uuid.uuid4()
    po_id = uuid.uuid4()

    item = PurchaseOrderItemModel(
        id=uuid.uuid4(),
        purchase_order_id=po_id,
        material_id=mat_id,
        material_variant_id=var_id,
        material_code="MAT-BOLT-001",
        variant_code="MAT-BOLT-001-V001",
        material_name="Hex Bolt M8x50mm",
        category="Fasteners & Hardware",
        quantity=Decimal("500.0000"),
        unit_price=Decimal("4.5000"),
        uom="PCS",
    )

    assert item.material_id == mat_id
    assert item.material_variant_id == var_id
    assert item.material_code == "MAT-BOLT-001"
    assert item.variant_code == "MAT-BOLT-001-V001"
    assert item.quantity == Decimal("500.0000")


def test_material_stock_model_variant_linkage():
    from app.modules.procurement.infrastructure.persistence.models import MaterialStockModel

    mat_id = uuid.uuid4()
    var_id = uuid.uuid4()

    stock = MaterialStockModel(
        id=uuid.uuid4(),
        material_id=mat_id,
        material_variant_id=var_id,
        material_code="MAT-001",
        variant_code="MAT-001-V001",
        material_name="Industrial Copper Wire (1.5mm, Red)",
        category="Electrical",
        on_hand=Decimal("1500.0000"),
        allocated=Decimal("200.0000"),
        available=Decimal("1300.0000"),
        uom="MTR",
        warehouse_id="WH-MAIN-01",
    )

    assert stock.material_id == mat_id
    assert stock.material_variant_id == var_id
    assert stock.material_code == "MAT-001"
    assert stock.variant_code == "MAT-001-V001"
    assert stock.on_hand == Decimal("1500.0000")
    assert stock.warehouse_id == "WH-MAIN-01"


def test_extract_variant_sequence_cases():
    from app.modules.procurement.infrastructure.api.material_router import extract_variant_sequence

    assert extract_variant_sequence("MAT-005-V001") == 1
    assert extract_variant_sequence("MAT-005-V002") == 2
    assert extract_variant_sequence("MAT-005-V010") == 10
    assert extract_variant_sequence("MAT-005-v003") == 3
    assert extract_variant_sequence("MAT-005-V1") == 1
    assert extract_variant_sequence("MAT-005-VAR-004") == 4
    assert extract_variant_sequence("MAT-005_V005") == 5
    assert extract_variant_sequence("MAT-WIRE-001-V099") == 99
    assert extract_variant_sequence("MAT-005-SPECIAL") is None
    assert extract_variant_sequence("MAT-005") is None
    assert extract_variant_sequence("") is None
    assert extract_variant_sequence(None) is None


def test_generate_next_variant_code_scenarios():
    from app.modules.procurement.infrastructure.api.material_router import generate_next_variant_code

    # 1. Standard existing V001, V002 -> next = V003
    codes = ["MAT-005-V001", "MAT-005-V002"]
    assert generate_next_variant_code("MAT-005", codes) == "MAT-005-V003"

    # 2. Remove V001, V002 remains -> next = V003 (NEVER reuse V001 or duplicate V002)
    codes_v2_only = ["MAT-005-V002"]
    assert generate_next_variant_code("MAT-005", codes_v2_only) == "MAT-005-V003"

    # 3. Remove V002, V003 remains -> next = V004
    codes_v1_v3 = ["MAT-005-V001", "MAT-005-V003"]
    assert generate_next_variant_code("MAT-005", codes_v1_v3) == "MAT-005-V004"

    # 4. Only V003 remains -> next = V004
    codes_v3_only = ["MAT-005-V003"]
    assert generate_next_variant_code("MAT-005", codes_v3_only) == "MAT-005-V004"

    # 5. No variants -> next = V001
    assert generate_next_variant_code("MAT-005", []) == "MAT-005-V001"
    assert generate_next_variant_code("MAT-005", None) == "MAT-005-V001"

    # 6. Malformed or custom variants handled safely
    codes_custom = ["MAT-005-SPECIAL", "MAT-005-CUSTOM-A"]
    assert generate_next_variant_code("MAT-005", codes_custom) == "MAT-005-V001"


def test_user_exact_scenario_remove_deactivate_v001_generates_v003():
    """
    Exact User Scenario:
    - Material MAT-005 has variants MAT-005-V001 and MAT-005-V002
    - If V001 is removed or deactivated and V002 remains
    - Next generated variant code MUST be V003, NEVER V002.
    """
    from app.modules.procurement.infrastructure.api.material_router import generate_next_variant_code

    # Case A: V001 removed, only V002 in active list
    remaining_variants_after_delete = ["MAT-005-V002"]
    next_code = generate_next_variant_code("MAT-005", remaining_variants_after_delete)
    assert next_code == "MAT-005-V003", f"Expected MAT-005-V003 but got {next_code}"

    # Case B: V001 deactivated (status=Inactive), both still in DB
    variants_with_inactive = ["MAT-005-V001", "MAT-005-V002"]
    next_code_b = generate_next_variant_code("MAT-005", variants_with_inactive)
    assert next_code_b == "MAT-005-V003", f"Expected MAT-005-V003 but got {next_code_b}"


def test_variant_sequence_gaps_and_mixed_case():
    from app.modules.procurement.infrastructure.api.material_router import generate_next_variant_code

    # Gaps in sequences
    assert generate_next_variant_code("MAT-100", ["MAT-100-V001", "MAT-100-V005"]) == "MAT-100-V006"
    assert generate_next_variant_code("MAT-100", ["MAT-100-V010"]) == "MAT-100-V011"
    
    # Mixed cases
    assert generate_next_variant_code("mat-100", ["mat-100-v001", "MAT-100-V002"]) == "MAT-100-V003"
    
    # Empty material code fallback
    assert generate_next_variant_code("", ["V001", "V002"]) == "MAT-V003"


