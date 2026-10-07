from __future__ import annotations

from decimal import Decimal
from sqlalchemy import select

from app.modules.procurement.infrastructure.persistence.models import MaterialStockModel
from app.modules.storage.infrastructure.persistence.models import InventoryLocationBalanceModel, StorageLocationModel


def _profile(material_name: str, uom: str, stock: MaterialStockModel | None) -> tuple[str, str, str]:
    text, normalized_uom = material_name.lower(), uom.upper()
    category, handling, rotation = (stock.category if stock else "Raw Material"), "STANDARD", "FIFO"
    if any(word in text for word in ("lubricant", "oil", "chemical", "paint", "solvent")) or normalized_uom in {"LTR", "L", "KL"}:
        return "Controlled Liquid", "LIQUID_CONTAINMENT", "FEFO"
    if any(word in text for word in ("pipe", "tube", "rod", "bar")):
        handling = "LONG_LOAD"
    elif any(word in text for word in ("sheet", "plate", "coil")):
        handling = "FLAT_LOAD"
    elif any(word in text for word in ("bolt", "nut", "screw", "fastener")):
        handling = "SMALL_PARTS"
    return category, handling, rotation


async def recommend_storage_location(session, *, warehouse_id: str, material_code: str,
                                     material_name: str, quantity: Decimal, uom: str):
    stock_result = await session.execute(select(MaterialStockModel).where(MaterialStockModel.material_code == material_code))
    stock = stock_result.scalar_one_or_none()
    category, handling, rotation = _profile(material_name, uom, stock)
    locations_result = await session.execute(select(StorageLocationModel).where(
        StorageLocationModel.warehouse_id == warehouse_id, StorageLocationModel.active.is_(True),
        StorageLocationModel.capacity - StorageLocationModel.occupied_quantity >= quantity,
    ))
    locations = locations_result.scalars().all()
    balances_result = await session.execute(select(InventoryLocationBalanceModel).where(
        InventoryLocationBalanceModel.warehouse_id == warehouse_id,
        InventoryLocationBalanceModel.material_code == material_code,
    ))
    existing_location_ids = {balance.storage_location_id for balance in balances_result.scalars().all()}
    scored = []
    for location in locations:
        descriptor = f"{location.zone} {location.rack} {location.bin}".lower()
        available = location.capacity - location.occupied_quantity
        score, reasons = 0.0, [f"Warehouse match: {warehouse_id}", f"Capacity available: {available}"]
        if location.id in existing_location_ids:
            score += 120; reasons.append("Existing stock of this material is already stored here")
        if category == "Raw Material" and any(token in descriptor for token in ("raw", "rm", "material")):
            score += 60; reasons.append("Zone supports Raw Material")
        if handling == "LIQUID_CONTAINMENT":
            if any(token in descriptor for token in ("liquid", "haz", "chemical", "oil")):
                score += 80; reasons.append("Liquid-compatible containment zone")
            if any(token in descriptor for token in ("food", "electrical", "paper")):
                score -= 200; reasons.append("Compatibility penalty applied")
        elif handling == "LONG_LOAD" and any(token in descriptor for token in ("raw", "long", "pipe", "rm")):
            score += 45; reasons.append("Rack is suitable for long material")
        elif handling == "FLAT_LOAD" and any(token in descriptor for token in ("raw", "flat", "sheet", "rm")):
            score += 45; reasons.append("Rack is suitable for flat material")
        elif handling == "SMALL_PARTS" and any(token in descriptor for token in ("small", "parts", "bin", "rm")):
            score += 45; reasons.append("Bin is suitable for small parts")
        score += float(quantity / available) * 30 if available else 0
        if rotation == "FEFO" and "fefo" in descriptor:
            score += 30; reasons.append("FEFO-enabled location")
        else:
            reasons.append(f"{rotation} stock rotation will apply")
        scored.append((score, location, reasons))
    if not scored:
        return None, {"category": category, "handling_requirement": handling, "rotation_policy": rotation,
                      "score": None, "reasons": ["No active compatible bin has sufficient capacity"]}
    score, location, reasons = max(scored, key=lambda item: (item[0], -float(item[1].capacity - item[1].occupied_quantity)))
    return location, {"category": category, "handling_requirement": handling, "rotation_policy": rotation,
                      "score": round(score, 2), "reasons": reasons}
