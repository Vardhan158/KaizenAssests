import urllib.request
import json
import sys

BASE_URL = 'http://localhost:8000/api/v1'

def api_get(endpoint):
    req = urllib.request.Request(f'{BASE_URL}{endpoint}')
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

def api_post(endpoint, payload):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        f'{BASE_URL}{endpoint}',
        data=data,
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

def main():
    print("=== PROMPT 5: SHORTAGE TO MATERIAL REQUEST HANDOFF ===")
    
    # 1. Verify before submission
    mrs_before = api_get('/procurement/material-requests')
    print(f"Material Requests before submission: {len(mrs_before)}")
    assert len(mrs_before) == 0, f"Expected 0 Material Requests before submission, found {len(mrs_before)}"

    # Check AR-2026-0002
    reqs = api_get('/assembly-requisitions')
    ar = next((r for r in reqs if (r.get('requisition_number') == 'AR-2026-0002' or r.get('requisitionNumber') == 'AR-2026-0002')), None)
    assert ar is not None, "AR-2026-0002 not found"
    ar_id = ar.get('id')
    ar_num = ar.get('requisitionNumber') or ar.get('requisition_number')
    print(f"Found {ar_num} ID: {ar_id}, status: {ar.get('status')}")

    # Check shortage quantity in AR
    items_list = ar.get('items', [])
    motor_item = next((it for it in items_list if 'MOTOR' in (it.get('material_code') or it.get('materialCode') or '').upper() or 'MOTOR' in (it.get('material_name') or it.get('materialName') or '').upper()), None)
    assert motor_item is not None, "Motor item not found in AR-2026-0002"
    
    req_qty = float(motor_item.get('required_quantity') or motor_item.get('requiredQuantity') or 0)
    res_qty = float(motor_item.get('reserved_quantity') or motor_item.get('reservedQuantity') or 0)
    shortage_qty = float(motor_item.get('shortageQuantity') or motor_item.get('shortage_quantity') or (req_qty - res_qty))
    print(f"Motor: Required={req_qty}, Reserved={res_qty}, Shortage={shortage_qty}")
    assert req_qty == 10.0, f"Expected required quantity 10, got {req_qty}"
    assert res_qty == 6.0, f"Expected reserved quantity 6, got {res_qty}"
    assert shortage_qty == 4.0, f"Expected shortage quantity 4, got {shortage_qty}"

    # Get Motor Material details
    motor_id = motor_item.get('material_id') or motor_item.get('materialId')

    # Supplier count check for Electrical category
    suppliers = api_get('/procurement/suppliers')
    active_sups_electrical = [
        s for s in suppliers 
        if s.get('status') == 'Active' and (
            'Electrical' in (s.get('category') or []) if isinstance(s.get('category'), list) else (s.get('category') or '') == 'Electrical'
        )
    ]
    print(f"Active suppliers count for category 'Electrical': {len(active_sups_electrical)}")

    # 2. Submit Material Request
    mr_payload = {
        "warehouse_id": "Main Warehouse",
        "department": "Assembly",
        "requested_by": "warehouse_user",
        "priority": "HIGH",
        "required_date": "2026-10-01",
        "remarks": f"Shortage fulfillment for Assembly Requisition AR-2026-0002 (Source FGR: FGR-20260924-0001)",
        "source_requisition_id": ar_id,
        "items": [
            {
                "material_id": motor_id,
                "material_code": "MAT-MOTOR-001",
                "material_name": "Motor",
                "category": "Electrical",
                "quantity": 4,
                "uom": "PCS",
                "notes": "Shortage of 4 Motors for PUMP-100 assembly"
            }
        ]
    }

    created_mr = api_post('/procurement/material-requests', mr_payload)
    print("Created Material Request:")
    print(f"  ID: {created_mr.get('id')}")
    print(f"  Request Number: {created_mr.get('request_number')}")
    print(f"  Status: {created_mr.get('status')}")

    # 3. After submission verification
    mrs_after = api_get('/procurement/material-requests')
    print(f"\nMaterial Requests after submission: {len(mrs_after)}")
    assert len(mrs_after) == 1, f"Expected exactly 1 Material Request, found {len(mrs_after)}"

    mr = mrs_after[0]
    print(f"Material Request Verification:")
    print(f"  ID: {mr.get('id')}")
    print(f"  Request Number: {mr.get('request_number')}")
    print(f"  Department: {mr.get('department')}")
    print(f"  Source Requisition ID: {mr.get('source_requisition_id')}")
    print(f"  Remarks: {mr.get('remarks')}")

    items = mr.get('items') or []
    assert len(items) == 1, f"Expected 1 item, got {len(items)}"
    item = items[0]
    mat_code = item.get('material_code') or item.get('materialCode')
    mat_name = item.get('material_name') or item.get('materialName')
    qty = float(item.get('quantity') or 0)
    uom_val = item.get('uom')
    cat_val = item.get('category')
    print(f"  Item Material Code: {mat_code}")
    print(f"  Item Material Name: {mat_name}")
    print(f"  Item Quantity: {qty}")
    print(f"  Item UOM: {uom_val}")
    print(f"  Item Category: {cat_val}")

    assert mat_code == 'MAT-MOTOR-001', f"Expected MAT-MOTOR-001, got {mat_code}"
    assert qty == 4.0, f"Expected quantity 4, got {qty}"
    assert uom_val == 'PCS', f"Expected UOM PCS, got {uom_val}"
    assert cat_val == 'Electrical', f"Expected category Electrical, got {cat_val}"
    assert 'AR-2026-0002' in str(mr.get('remarks')) or mr.get('source_requisition_id') == ar_id or mr.get('sourceRequisitionId') == ar_id, "Source Requisition ID does not match AR-2026-0002"

    # 4. Downstream isolation verification
    rfqs = api_get('/procurement/rfqs')
    print(f"Downstream RFQs: {len(rfqs)}")
    assert len(rfqs) == 0, f"Expected 0 RFQs, found {len(rfqs)}"

    pos = api_get('/procurement/purchase-orders')
    print(f"Downstream POs: {len(pos)}")
    assert len(pos) == 0, f"Expected 0 POs, found {len(pos)}"

    print("\n>>> ALL PROMPT 5 STEPS AND ASSERTIONS PASSED SUCCESSFULLY! <<<")

if __name__ == '__main__':
    main()
