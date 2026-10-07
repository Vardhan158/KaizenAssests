"""
PDF / Print export generator for Gate Entry Passes.
Renders printable HTML document with CSS styling for gate passes.
"""
from datetime import timedelta, timezone

from app.modules.gate.domain.aggregate import GateEntry


IST = timezone(timedelta(hours=5, minutes=30), name="IST")


def _format_entry_time(created_at) -> str:
    """Format the UTC database timestamp as an unambiguous local gate time."""
    if created_at is None:
        return "N/A"
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return created_at.astimezone(IST).strftime("%d-%m-%Y %I:%M:%S %p IST")


class GatePassPdfGenerator:
    @staticmethod
    def generate_html(entry: GateEntry) -> str:
        """Renders an HTML template formatted for downloading or printing as a gate pass."""

        # Extract details for the pass
        ocr = entry.ocr_result
        po_number = entry.po_number or "N/A"
        vehicle_plate = entry.vehicle_plate or "N/A"
        supplier_name = (ocr.supplier_name if ocr else None) or "N/A"
        material = (ocr.material_description if ocr else None) or "N/A"
        quantity = f"{ocr.total_quantity:,.2f}" if ocr and ocr.total_quantity else "N/A"
        status_value = entry.status.value if hasattr(entry.status, "value") else str(entry.status)
        is_unscheduled = status_value == "UNSCHEDULED_ARRIVAL"

        shipment_detail_rows = "" if is_unscheduled else f"""
    <div class="field-row">
        <span class="field-label">Supplier:</span>
        <span class="field-val">{supplier_name}</span>
    </div>
    <div class="field-row">
        <span class="field-label">Material:</span>
        <span class="field-val">{material}</span>
    </div>
    <div class="field-row">
        <span class="field-label">Total Qty:</span>
        <span class="field-val">{quantity}</span>
    </div>"""

        created_at_str = _format_entry_time(entry.created_at)

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Gate Pass {entry.gate_entry_number}</title>
    <style>
        @page {{
            size: landscape;
            margin: 0;
        }}
        body {{
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            margin: 0;
            padding: 30px;
            color: #000;
            background: #fff;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }}
        .pass-container {{
            width: 700px;
            height: 380px;
            border: 2px solid #000;
            border-radius: 20px;
            padding: 25px;
            display: flex;
            flex-direction: column;
            position: relative;
            background: #fff;
            box-shadow: 0 10px 25px rgba(0,0,0,0.05);
        }}
        .watermark {{
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-30deg);
            font-size: 80px;
            color: rgba(0,0,0,0.03);
            font-weight: 900;
            z-index: 0;
            pointer-events: none;
            white-space: nowrap;
        }}
        .header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #000;
            padding-bottom: 15px;
            margin-bottom: 20px;
            z-index: 1;
        }}
        .brand {{
            text-align: left;
        }}
        .title {{
            font-size: 24px;
            font-weight: 900;
            margin: 0;
            letter-spacing: -0.5px;
        }}
        .subtitle {{
            font-size: 11px;
            color: #666;
            margin-top: 2px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }}
        .pass-id {{
            text-align: right;
        }}
        .pass-id-label {{
            font-size: 10px;
            font-weight: bold;
            color: #888;
            text-transform: uppercase;
        }}
        .pass-id-val {{
            font-family: 'Courier New', Courier, monospace;
            font-size: 18px;
            font-weight: bold;
        }}
        .main-content {{
            display: flex;
            gap: 40px;
            flex: 1;
            z-index: 1;
        }}
        .details-col {{
            flex: 1;
            display: grid;
            grid-template-columns: 1fr 1.5fr;
            gap: 12px 15px;
            align-content: start;
        }}
        .qr-col {{
            width: 180px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            border-left: 1px dashed #ddd;
            padding-left: 30px;
        }}
        .label {{
            font-size: 10px;
            color: #666;
            text-transform: uppercase;
            font-weight: bold;
            display: flex;
            align-items: center;
        }}
        .value {{
            font-size: 14px;
            font-weight: bold;
        }}
        .qr-placeholder {{
            width: 140px;
            height: 140px;
            background: #f9f9f9;
            border: 1px solid #eee;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            color: #999;
            text-align: center;
            padding: 10px;
        }}
        .footer {{
            margin-top: auto;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            padding-top: 20px;
            border-top: 1px solid #eee;
            z-index: 1;
        }}
        .terms {{
            font-size: 9px;
            color: #777;
            max-width: 300px;
            line-height: 1.4;
        }}
        .sigs {{
            display: flex;
            gap: 40px;
        }}
        .sig-box {{
            text-align: center;
        }}
        .sig-line {{
            width: 120px;
            border-bottom: 1px solid #000;
            margin-bottom: 5px;
            height: 30px;
        }}
        .sig-label {{
            font-size: 9px;
            font-weight: bold;
            text-transform: uppercase;
        }}
        @media print {{
            body {{ padding: 0; }}
            .no-print {{ display: none; }}
            .pass-container {{ box-shadow: none; border-width: 1px; }}
        }}
    </style>
</head>
<body>
    <div class="pass-container">
        <div class="watermark">NEXUS WMS</div>

        <div class="header">
            <div class="brand">
                <h1 class="title">GATE ENTRY PASS</h1>
                <div class="subtitle">Industrial Logistics Management</div>
            </div>
            <div class="pass-id">
                <div class="pass-id-label">Pass ID</div>
                <div class="pass-id-val">{entry.gate_entry_number}</div>
            </div>
        </div>

        <div class="main-content">
            <div class="details-col">
                <div class="label">Vehicle Plate</div>
                <div class="value">{vehicle_plate}</div>

                <div class="label">PO Number</div>
                <div class="value">{po_number}</div>

                <div class="label">Date & Time</div>
                <div class="value">{created_at_str}</div>

                <div class="label">Supplier</div>
                <div class="value">{supplier_name}</div>

                <div class="label">Entry Status</div>
                <div class="value" style="color: #059669;">{status_value.replace("_", " ").title()}</div>

                <div class="label">Officer</div>
                <div class="value">{entry.created_by}</div>
            </div>

            <div class="qr-col">
                <!-- QR placeholder to be replaced by frontend injector -->
                <div class="pass-number">
                    <div style="font-size: 10px; color: #999; text-align: center; border: 1px dashed #ccc; padding: 20px; border-radius: 12px;">
                        Digital Verification QR<br>
                        (Auto-generated)
                    </div>
                </div>
                <div style="font-size: 9px; margin-top: 10px; font-weight: bold; color: #888; text-transform: uppercase;">Scan to verify</div>
            </div>
        </div>

        <div class="footer">
            <div class="terms">
                This pass is valid for a single entry and unloading session at the Pune Distribution Centre.
                Please keep this document visible on the vehicle dashboard at all times while on premises.
            </div>
            <div class="sigs">
                <div class="sig-box">
                    <div class="sig-line"></div>
                    <div class="sig-label">Driver</div>
                </div>
                <div class="sig-box">
                    <div class="sig-line"></div>
                    <div class="sig-label">Security</div>
                </div>
            </div>
        </div>
    </div>

    <div class="no-print" style="position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);">
        <button onclick="window.print()" style="background: #000; color: #fff; border: none; padding: 12px 30px; border-radius: 10px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">Print Document</button>
    </div>
</body>
</html>
"""
        return html

    def generate_pdf(self, entry: GateEntry) -> bytes:
        """Returns the pass HTML encoded as bytes."""
        return self.generate_html(entry).encode("utf-8")
