from decimal import Decimal
from datetime import datetime
from types import SimpleNamespace

from app.modules.assembly.infrastructure.api.router import (
    aggregate_requirements,
    build_material_issue_lines,
    calculate_assembly_progress,
    calculate_material_variance,
    default_assembly_steps,
    material_requirement_status,
    serialize_team,
    validate_quality_quantities,
    finished_good_code,
)


def test_aggregate_requirements_combines_duplicate_material_lines():
    requirements = aggregate_requirements([
        {"material_code": "PCB", "quantity": 60, "uom": "PCS"},
        {"material_code": "PCB", "quantity": "40", "uom": "PCS"},
        {"material_code": "", "quantity": 10},
        {"material_code": "WIRE", "quantity": 0},
    ])

    assert set(requirements) == {"PCB"}
    assert requirements["PCB"]["quantity"] == Decimal("100")


def test_material_issue_lines_report_requested_issued_pending_and_traceability():
    lines = build_material_issue_lines(
        [{"material_code": "PCB", "material_name": "Controller PCB", "quantity": 100, "uom": "PCS"}],
        [{
            "material_code": "PCB", "quantity": 60, "uom": "PCS",
            "allocations": [{"location": "WH-01-RM-A-05", "quantity": 60}],
        }],
        {"PCB": {"LOT-2026-08"}},
    )

    assert lines == [{
        "material_code": "PCB", "material_name": "Controller PCB",
        "requested_quantity": 100.0, "issued_quantity": 60.0, "pending_quantity": 40.0,
        "uom": "PCS", "batch_lot": ["LOT-2026-08"],
        "storage_locations": ["WH-01-RM-A-05"], "status": "PARTIALLY_ISSUED",
    }]


def test_material_requirement_status_identifies_available_shortage_and_reserved():
    assert material_requirement_status(Decimal("500"), Decimal("800"), Decimal("0")) == ("AVAILABLE", "Available ✅")
    assert material_requirement_status(Decimal("100"), Decimal("60"), Decimal("0")) == ("SHORTAGE", "Shortage ⚠️")
    assert material_requirement_status(Decimal("100"), Decimal("400"), Decimal("100")) == ("RESERVED", "Reserved ✅")


def test_default_assembly_work_order_has_six_ordered_steps():
    steps = default_assembly_steps()
    assert [step["name"] for step in steps] == [
        "Housing preparation", "PCB installation", "Cable connection",
        "Component installation", "Testing", "Final assembly",
    ]
    assert all(step["status"] == "NOT_STARTED" for step in steps)


def test_team_workload_is_calculated_from_active_assigned_orders():
    now = datetime.now()
    team = SimpleNamespace(id="00000000-0000-0000-0000-000000000001", name="Assembly Team A", team_leader="Lead",
                           workers=["A", "B", "C", "D", "E"], shift="Morning", workstation="WS-03",
                           active=True, created_at=now, updated_at=now)
    order = SimpleNamespace(id="00000000-0000-0000-0000-000000000002", assigned_team="Assembly Team A",
                            status="IN_PROGRESS", order_number="AO-2026-00125", product_name="Control Panel",
                            planned_quantity=Decimal("100"))
    result = serialize_team(team, [order])
    assert result["workers_count"] == 5
    assert result["current_workload"] == 1
    assert result["target_units"] == 100.0
    assert result["assigned_orders"][0]["order_number"] == "AO-2026-00125"


def test_assembly_progress_calculates_remaining_percentage_and_status():
    assert calculate_assembly_progress(Decimal("100"), Decimal("65"), "IN_PROGRESS") == {
        "target": 100.0, "completed": 65.0, "remaining": 35.0,
        "progress_percent": 65.0, "progress_status": "IN_PROGRESS",
    }
    assert calculate_assembly_progress(Decimal("100"), Decimal("65"), "ON_HOLD")["progress_status"] == "PAUSED"


def test_material_consumption_calculates_wastage_variance():
    assert calculate_material_variance(Decimal("2"), Decimal("50"), Decimal("105")) == {
        "expected_consumption": 100.0, "actual_consumption": 105.0,
        "variance_quantity": 5.0, "variance_percent": 5.0, "status": "OVER_CONSUMPTION",
    }


def test_quality_inspection_reconciles_produced_quantities():
    assert validate_quality_quantities(
        Decimal("100"), Decimal("94"), Decimal("4"), Decimal("2"), "REWORK_REQUIRED"
    ) == "REWORK_REQUIRED"


def test_quality_inspection_rejects_unreconciled_quantities():
    try:
        validate_quality_quantities(Decimal("100"), Decimal("94"), Decimal("4"), Decimal("1"), "FAILED")
        assert False, "Expected quantity validation to fail"
    except ValueError as exc:
        assert "must equal produced" in str(exc)


def test_finished_good_code_is_stable_and_inventory_safe():
    assert finished_good_code("Control Panel") == "FG-CONTROL-PANEL"
