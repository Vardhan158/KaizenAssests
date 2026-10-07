"""
PDF / Print export generator for Purchase Orders.
Renders printable HTML / PDF document with CSS styling.
"""
from app.modules.procurement.domain.purchase_order import PurchaseOrder


class PurchaseOrderPdfGenerator:
    @staticmethod
    def generate_html(po: PurchaseOrder) -> str:
        """Renders an HTML template formatted for downloading or printing."""
        items_rows = ""
        for idx, item in enumerate(po.items, 1):
            items_rows += f"""
            <tr>
                <td>{idx}</td>
                <td><strong>{item.material_code}</strong></td>
                <td>{item.material_name or '-'}</td>
                <td>{item.category or '-'}</td>
                <td style="text-align: right;">{item.quantity:,.2f}</td>
                <td style="text-align: right;">${item.unit_price:,.2f}</td>
                <td style="text-align: right;"><strong>${item.line_total:,.2f}</strong></td>
            </tr>
            """

        supp = po.supplier_info
        deliv = po.delivery_details

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Purchase Order {po.po_number}</title>
    <style>
        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 40px;
            color: #1e293b;
            background: #fff;
            font-size: 14px;
        }}
        .header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 20px;
            margin-bottom: 24px;
        }}
        .title {{
            font-size: 26px;
            font-weight: 800;
            color: #0f172a;
            margin: 0;
            letter-spacing: 0.5px;
        }}
        .po-badge {{
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            padding: 6px 12px;
            border-radius: 6px;
            font-weight: 600;
        }}
        .section-title {{
            font-size: 16px;
            font-weight: 700;
            color: #0f172a;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 6px;
            margin-top: 24px;
            margin-bottom: 12px;
        }}
        .grid-2 {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
        }}
        .card {{
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px;
        }}
        .field-label {{
            font-size: 12px;
            color: #64748b;
            font-weight: 600;
            text-transform: uppercase;
        }}
        .field-val {{
            font-weight: 600;
            color: #0f172a;
            margin-bottom: 8px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 16px;
        }}
        th, td {{
            padding: 10px 12px;
            text-align: left;
            border-bottom: 1px solid #e2e8f0;
        }}
        th {{
            background: #f1f5f9;
            color: #475569;
            font-weight: 700;
            font-size: 12px;
            text-transform: uppercase;
        }}
        .summary-box {{
            margin-top: 24px;
            margin-left: auto;
            width: 320px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px;
        }}
        .summary-line {{
            display: flex;
            justify-content: space-between;
            padding: 6px 0;
        }}
        .summary-line.total {{
            border-top: 2px solid #0f172a;
            font-weight: 800;
            font-size: 16px;
            color: #0f172a;
            margin-top: 8px;
            padding-top: 10px;
        }}
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1 class="title">PURCHASE ORDER</h1>
            <div style="color: #64748b; margin-top: 4px;">Warehouse Management System</div>
        </div>
        <div class="po-badge">
            PO #: <span>{po.po_number}</span> | Date: <span>{po.po_date}</span>
        </div>
    </div>

    <div class="grid-2">
        <div class="card">
            <div class="section-title">1. Supplier Information</div>
            <div class="field-label">Supplier Name</div>
            <div class="field-val">{supp.supplier_name if supp and supp.supplier_name else po.supplier_id or 'N/A'}</div>
            <div class="field-label">Contact Person</div>
            <div class="field-val">{supp.contact_person if supp else 'N/A'}</div>
            <div class="field-label">Email & Phone</div>
            <div class="field-val">{supp.email if supp else ''} {supp.phone if supp else ''}</div>
            <div class="field-label">GST / Tax ID</div>
            <div class="field-val">{supp.gst_number if supp else 'N/A'}</div>
            <div class="field-label">Address</div>
            <div class="field-val">{supp.supplier_address if supp else 'N/A'}</div>
        </div>

        <div class="card">
            <div class="section-title">2. Delivery & Ship-To Details</div>
            <div class="field-label">Delivery Warehouse</div>
            <div class="field-val">{deliv.delivery_warehouse if deliv else po.warehouse_id or 'N/A'}</div>
            <div class="field-label">Delivery Address</div>
            <div class="field-val">{deliv.delivery_address if deliv else 'N/A'}</div>
            <div class="field-label">Expected Delivery Date</div>
            <div class="field-val">{po.expected_delivery_date or 'N/A'}</div>
            <div class="field-label">Transporter / Carrier</div>
            <div class="field-val">{deliv.transporter if deliv else 'N/A'}</div>
            <div class="field-label">Department / Buyer</div>
            <div class="field-val">{po.department or '-'} / {po.buyer or '-'}</div>
        </div>
    </div>

    <div class="section-title" style="margin-top: 32px;">3. Order Line Items</div>
    <table>
        <thead>
            <tr>
                <th>#</th>
                <th>Material Code</th>
                <th>Description</th>
                <th>Category</th>
                <th style="text-align: right;">Quantity</th>
                <th style="text-align: right;">Unit Price</th>
                <th style="text-align: right;">Line Total</th>
            </tr>
        </thead>
        <tbody>
            {items_rows if items_rows.strip() else '<tr><td colspan="7" style="text-align:center;">No order items added.</td></tr>'}
        </tbody>
    </table>

    <div class="summary-box">
        <h3 style="margin-top: 0; margin-bottom: 12px;">4. Order Summary</h3>
        <div class="summary-line"><span class="field-label">Total Material Items:</span> <span class="field-val">{po.total_items}</span></div>
        <div class="summary-line"><span class="field-label">Total Quantity:</span> <span class="field-val">{po.total_quantity:,.2f}</span></div>
        <div class="summary-line"><span class="field-label">Subtotal:</span> <span class="field-val">${po.subtotal:,.2f}</span></div>
        <div class="summary-line"><span class="field-label">GST / Tax ({int(po.tax_rate * 100)}%):</span> <span class="field-val">${po.tax_amount:,.2f}</span></div>
        <div class="summary-line total"><span>Grand Total:</span> <span>${po.grand_total:,.2f}</span></div>
    </div>
</body>
</html>
"""
        return html

    def generate_pdf(self, po: PurchaseOrder) -> bytes:
        return self.generate_html(po).encode("utf-8")
