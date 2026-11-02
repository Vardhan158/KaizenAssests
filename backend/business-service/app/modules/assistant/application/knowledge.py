"""Curated explanations and explicit limits for topics without detailed live retrieval."""
import re


GUIDES = (
    (r"\bfefo\b", "FEFO means first expired, first out: use the eligible batch with the earliest expiry first. FIFO uses receipt age instead. Check batch expiry and quality eligibility in the inventory workflow before picking."),
    (r"\b(?:bom|bill of materials)\b", "A bill of materials (BOM) lists the components and quantities needed for one finished product. Required component quantity depends on planned production quantity. Review the product BOM and material availability before submitting an assembly material request."),
    (r"\b(?:asn|advance shipping notice)\b", "An ASN tells the warehouse what a supplier plans to deliver. In the supplier ASN workflow, select the related purchase order, enter delivery lines, vehicle and expected arrival details, and submit the notice. Gate and receiving teams use it to verify the arrival."),
    (r"\b(?:reorder|low stock|safety stock|minimum stock)\b", "The reorder point is the stock threshold used to flag replenishment needs. Review demand, available inventory and open purchase orders before raising replenishment through the procurement workflow. Chat can find out-of-stock materials; a threshold-based replenishment report is not available here."),
    (r"\b(?:reserved|allocated|reservation)\b", "Reserved or allocated stock is set aside for an operation. Available stock is the portion free to use; on-hand is the recorded physical quantity. Review the related request before changing a reservation in its workflow."),
    (r"\b(?:packing|packaging)\b", "During packing, verify picked items, quantities and batch details against the dispatch order, then record the required package information in Picking & Packing. Complete the workflow checks before loading."),
    (r"\b(?:loading|gate out|gate-out)\b", "For outbound loading, verify the dispatch, packed goods, vehicle and required documents in the loading workflow. Gate out follows the dispatch and security checks. The assistant can report dispatch status but cannot release a vehicle."),
    (r"\b(?:qc|quality inspection|quality check|rework)\b", "Quality inspection records accepted, rejected or rework quantities and required evidence. Use the receiving or assembly quality workflow for the relevant record. Held or rejected stock must not be treated as available until the workflow permits it."),
    (r"\b(?:aging|ageing|expiry|expired)\b", "Stock ageing measures time since receipt; expiry identifies the batch's usable date limit. Review eligible batches and quality status before picking. The assistant's stock summary does not provide batch-level ageing or expiry reports."),
    (r"\b(?:damage|damaged|claims?|returns?|replacement|shortage|excess|discrepancy)\b", "Record the affected material, quantity, discrepancy and required evidence in receiving or quality inspection. Follow the damage-claim or return workflow for supplier response, replacement and closure. Claim details are available in that workflow."),
    (r"\b(?:cycle count|stock take|physical count|stock audit)\b", "A cycle count compares physically counted quantities with recorded stock for selected materials or locations. Investigate discrepancies and use the approved inventory adjustment workflow; the assistant cannot post stock adjustments."),
    (r"\b(?:finished goods|fg pickup|fg warehouse)\b", "Finished goods follow assembly completion and quality checks before storage or pickup. Suppliers use their finished-goods dispatch request workflow; gate staff verify the approved pickup, vehicle and exit requirements."),
)


def workflow_guide(query: str) -> str | None:
    return next((reply for pattern, reply in GUIDES if re.search(pattern, query, re.I)), None)


def unsupported_detail(query: str, category: str | None) -> str | None:
    """Do not present an order/stock summary as a report we did not actually query."""
    patterns = {
        "inventory": r"\b(?:quarantin\w*|quality hold|qc hold|expir\w*|ageing|aging|batches?|lots?|serial numbers?|ledger|movements?|cycle count|stock take|transfers?|adjustments?)\b",
        "assembly": r"\b(?:bom|bill of materials|material requests?|requisitions?|quality inspections?)\b",
        "purchase_orders": r"\b(?:quotations?|rfqs?)\b",
        "gate_entries": r"\b(?:damage claims?|grns?|goods receipts?|weighbridge)\b",
    }
    if category in patterns and re.search(patterns[category], query, re.I):
        guide = workflow_guide(query)
        return "I cannot retrieve that detailed report through chat yet. Open the relevant module for its records." + ("\n\n" + guide if guide else "")
    return None
