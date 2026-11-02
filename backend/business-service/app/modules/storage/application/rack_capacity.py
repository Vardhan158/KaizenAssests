"""Rack capacity is enforced at the stock-balance write boundary on both databases.

The rack row is an atomic reservation counter, maintained only by database
triggers. Existing bin counters are retained for compatibility, never used as
rack occupancy. Every delta also writes a transactionally consistent ledger.
"""
from decimal import Decimal
import math
import uuid
from fastapi import HTTPException
from sqlalchemy import select, func, insert
from app.modules.warehouse.infrastructure.persistence.models import WarehouseBinModel, WarehouseRackModel
from app.modules.storage.infrastructure.persistence.models import StorageLocationModel, InventoryLocationBalanceModel


def install_rack_capacity(connection):
    """Idempotent schema initialization, shared by Alembic and local startup."""
    from app.modules.warehouse.infrastructure.persistence.models import RackOccupancyEventModel
    WarehouseRackModel.__table__.create(connection, checkfirst=True)
    RackOccupancyEventModel.__table__.create(connection, checkfirst=True)
    groups = connection.execute(select(WarehouseBinModel.zone_id, func.upper(WarehouseBinModel.rack).label("rack"),
        func.sum(WarehouseBinModel.capacity).label("capacity")).where(WarehouseBinModel.rack.is_not(None))
        .group_by(WarehouseBinModel.zone_id, func.upper(WarehouseBinModel.rack))).all()
    for zone_id, rack, capacity in groups:
        exists = connection.scalar(select(WarehouseRackModel.id).where(WarehouseRackModel.zone_id == zone_id, WarehouseRackModel.rack_code == rack))
        if exists:
            continue
        occupied = connection.scalar(select(func.coalesce(func.sum(InventoryLocationBalanceModel.quantity), 0))
            .join(StorageLocationModel, StorageLocationModel.id == InventoryLocationBalanceModel.storage_location_id)
            .join(WarehouseBinModel, WarehouseBinModel.id == StorageLocationModel.bin_id)
            .where(WarehouseBinModel.zone_id == zone_id, func.upper(WarehouseBinModel.rack) == rack)) or 0
        connection.execute(insert(WarehouseRackModel).values(id=uuid.uuid4(), zone_id=zone_id, rack_code=rack,
            maximum_capacity=math.ceil(max(capacity or 0, occupied, 1)), occupied_quantity=occupied))
    if connection.dialect.name == "sqlite":
        _install_sqlite(connection)
    elif connection.dialect.name == "postgresql":
        _install_postgres(connection)
    else:
        raise RuntimeError("Rack capacity requires PostgreSQL or SQLite")


def _rack(record):
    return f"(SELECT r.id FROM warehouse_rack r JOIN warehouse_bin b ON b.zone_id=r.zone_id AND upper(b.rack)=r.rack_code JOIN storage_location l ON l.bin_id=b.id WHERE l.id={record}.storage_location_id)"


def _install_sqlite(c):
    for operation in ("INSERT", "UPDATE", "DELETE"):
        name = "rack_balance_" + operation.lower()
        c.exec_driver_sql(f"DROP TRIGGER IF EXISTS {name}")
        parts = []
        if operation != "DELETE":
            parts.append(f"SELECT CASE WHEN NEW.quantity < 0 OR NEW.available_quantity < 0 OR NEW.available_quantity > NEW.quantity THEN RAISE(ABORT, 'Rack inventory quantity cannot be negative or over-available') END;")
            # Enforce PCS on new stock, while allowing removal of legacy non-PCS balances.
            changed = "1" if operation == "INSERT" else "NEW.quantity > OLD.quantity OR NEW.storage_location_id <> OLD.storage_location_id"
            parts.append(f"SELECT CASE WHEN ({changed}) AND {_rack('NEW')} IS NOT NULL AND (upper(NEW.uom) <> 'PCS' OR NEW.quantity <> CAST(NEW.quantity AS INTEGER)) THEN RAISE(ABORT, 'Rack capacity requires whole PCS quantities') END;")
        if operation != "INSERT":
            parts += [f"UPDATE warehouse_rack SET occupied_quantity=occupied_quantity-OLD.quantity WHERE id={_rack('OLD')};",
                f"INSERT INTO rack_occupancy_event(rack_id,balance_id,quantity_delta,reason,actor) SELECT id,OLD.id,-OLD.quantity,'Stock balance {operation.lower()}','inventory_transaction' FROM warehouse_rack WHERE id={_rack('OLD')} AND OLD.quantity <> 0;"]
        if operation != "DELETE":
            parts += [f"SELECT CASE WHEN EXISTS(SELECT 1 FROM warehouse_rack WHERE id={_rack('NEW')} AND occupied_quantity+NEW.quantity>maximum_capacity) THEN RAISE(ABORT, 'Rack capacity exceeded. Refresh available capacity and reduce the quantity.') END;",
                f"UPDATE warehouse_rack SET occupied_quantity=occupied_quantity+NEW.quantity WHERE id={_rack('NEW')};",
                f"INSERT INTO rack_occupancy_event(rack_id,balance_id,quantity_delta,reason,actor) SELECT id,NEW.id,NEW.quantity,'Stock balance {operation.lower()}','inventory_transaction' FROM warehouse_rack WHERE id={_rack('NEW')} AND NEW.quantity <> 0;"]
        when = " WHEN NEW.quantity <> OLD.quantity OR NEW.storage_location_id <> OLD.storage_location_id" if operation == "UPDATE" else ""
        c.exec_driver_sql(f"CREATE TRIGGER {name} AFTER {operation} ON inventory_location_balance{when} BEGIN " + " ".join(parts) + " END")


def _install_postgres(c):
    c.exec_driver_sql("""CREATE OR REPLACE FUNCTION maintain_rack_occupancy() RETURNS trigger AS $$
    DECLARE old_rack uuid; new_rack uuid; remaining numeric;
    BEGIN
      IF TG_OP='UPDATE' AND NEW.quantity=OLD.quantity AND NEW.storage_location_id=OLD.storage_location_id THEN RETURN NEW; END IF;
      IF TG_OP <> 'INSERT' THEN
        SELECT r.id INTO old_rack FROM warehouse_rack r JOIN warehouse_bin b ON b.zone_id=r.zone_id AND upper(b.rack)=r.rack_code JOIN storage_location l ON l.bin_id=b.id WHERE l.id=OLD.storage_location_id;
      END IF;
      IF TG_OP <> 'DELETE' THEN
        SELECT r.id INTO new_rack FROM warehouse_rack r JOIN warehouse_bin b ON b.zone_id=r.zone_id AND upper(b.rack)=r.rack_code JOIN storage_location l ON l.bin_id=b.id WHERE l.id=NEW.storage_location_id;
        IF NEW.quantity < 0 OR NEW.available_quantity < 0 OR NEW.available_quantity > NEW.quantity THEN RAISE EXCEPTION 'Rack inventory quantity cannot be negative or over-available'; END IF;
        IF new_rack IS NOT NULL AND (TG_OP='INSERT' OR NEW.quantity>OLD.quantity OR NEW.storage_location_id<>OLD.storage_location_id) AND (upper(NEW.uom)<>'PCS' OR NEW.quantity<>trunc(NEW.quantity)) THEN RAISE EXCEPTION 'Rack capacity requires whole PCS quantities'; END IF;
      END IF;
      PERFORM id FROM warehouse_rack WHERE id IN (old_rack,new_rack) ORDER BY id FOR UPDATE;
      IF old_rack IS NOT NULL THEN
        UPDATE warehouse_rack SET occupied_quantity=occupied_quantity-OLD.quantity WHERE id=old_rack;
        IF OLD.quantity<>0 THEN INSERT INTO rack_occupancy_event(rack_id,balance_id,quantity_delta,reason,actor) VALUES(old_rack,OLD.id::text,-OLD.quantity,'Stock balance '||lower(TG_OP),coalesce(nullif(current_setting('app.actor',true),''),current_user)); END IF;
      END IF;
      IF new_rack IS NOT NULL THEN
        SELECT maximum_capacity-occupied_quantity INTO remaining FROM warehouse_rack WHERE id=new_rack;
        IF NEW.quantity>remaining THEN RAISE EXCEPTION 'Rack capacity exceeded. Only % PCS can be stored.',remaining; END IF;
        UPDATE warehouse_rack SET occupied_quantity=occupied_quantity+NEW.quantity WHERE id=new_rack;
        IF NEW.quantity<>0 THEN INSERT INTO rack_occupancy_event(rack_id,balance_id,quantity_delta,reason,actor) VALUES(new_rack,NEW.id::text,NEW.quantity,'Stock balance '||lower(TG_OP),coalesce(nullif(current_setting('app.actor',true),''),current_user)); END IF;
      END IF;
      IF TG_OP='DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql""")
    c.exec_driver_sql("DROP TRIGGER IF EXISTS rack_balance_change ON inventory_location_balance")
    c.exec_driver_sql("CREATE TRIGGER rack_balance_change AFTER INSERT OR UPDATE OR DELETE ON inventory_location_balance FOR EACH ROW EXECUTE FUNCTION maintain_rack_occupancy()")


async def get_rack_capacity(session, bin_model, *, lock=False):
    query = select(WarehouseRackModel).where(WarehouseRackModel.zone_id == bin_model.zone_id,
        WarehouseRackModel.rack_code == str(bin_model.rack or "").upper()).execution_options(populate_existing=True)
    return await session.scalar(query.with_for_update() if lock else query)


async def validate_rack_capacity(session, bin_model, quantity, uom=None):
    rack = await get_rack_capacity(session, bin_model, lock=True)
    if rack is None:
        return  # Non-rack legacy locations retain existing bin validation.
    occupied = await session.scalar(select(func.coalesce(func.sum(InventoryLocationBalanceModel.quantity), 0))
        .join(StorageLocationModel, StorageLocationModel.id == InventoryLocationBalanceModel.storage_location_id)
        .where(StorageLocationModel.bin_id == bin_model.id))
    bin_model.occupied_quantity = occupied or Decimal("0")
    # Refresh legacy mirrors before putaway increments them. Assembly issues
    # change stock balances directly, so the physical rack can have free space
    # even when an older location counter still says it is full.
    locations = (await session.scalars(select(StorageLocationModel).where(StorageLocationModel.bin_id == bin_model.id))).all()
    if locations:
        totals = dict((await session.execute(select(InventoryLocationBalanceModel.storage_location_id,
            func.sum(InventoryLocationBalanceModel.quantity)).where(
                InventoryLocationBalanceModel.storage_location_id.in_([location.id for location in locations]))
            .group_by(InventoryLocationBalanceModel.storage_location_id))).all())
        for location in locations:
            location.occupied_quantity = totals.get(location.id, Decimal("0"))
            location.capacity = bin_model.capacity
    if quantity <= 0 or quantity != quantity.to_integral_value() or (uom and uom.upper() != "PCS"):
        raise HTTPException(422, "Rack capacity requires positive whole PCS quantities")
    remaining = Decimal(rack.maximum_capacity) - rack.occupied_quantity
    if quantity > remaining:
        raise HTTPException(409, f"Rack capacity exceeded. Only {remaining.normalize():f} PCS can be stored.")
    return rack
